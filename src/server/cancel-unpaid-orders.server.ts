import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'

type PremiumOrder = {
  rid: number
  bot_rid: number
  buy_tg_uid: string
  premium_tg_username: string
  premium_package_month: number
  need_pay_usdt: string
}
type RechargeOrder = {
  rid: number
  bot_rid: number
  recharge_tg_uid: string
  need_pay_price: string
  recharge_coin_name: string
  recharge_pay_price: string
}
type OutboxItem = { id: string; bot_token: string | null; chat_id: string; message_text: string; attempts: number; max_attempts: number }
export type ExpiredOrderResult = {
  premiumExpired: number
  rechargeExpired: number
  notificationsSent: number
  notificationsFailed: number
  notificationsQueued: number
}
export type TelegramOrderNotifier = (botToken: string, chatId: string, message: string) => Promise<boolean>
type Database = Pick<Pool, 'connect'>

function html(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
function premiumMessage(order: PremiumOrder) {
  return '您的会员订单已过期，请重新发起：\n' +
    '➖➖➖➖➖➖➖➖\n' +
    '<b>订单号：</b>' + html(order.rid) + '\n' +
    '<b>开通会员用户名：</b>' + html(order.premium_tg_username) + '\n' +
    '<b>开通会员月份：</b>' + html(order.premium_package_month) + '\n' +
    '<b>应支付USDT：</b>' + html(order.need_pay_usdt) + '\n\n' +
    '<b>请勿继续支付该订单！如已支付请联系客服！</b>'
}
function rechargeMessage(order: RechargeOrder) {
  return '⚠️您的充值订单已过期，请重新发起：\n' +
    '➖➖➖➖➖➖➖➖\n' +
    '<b>订单号：</b>' + html(order.rid) + '\n' +
    '<b>充值币种：</b>' + html(order.recharge_coin_name) + '\n' +
    '<b>充值金额：</b>' + html(order.recharge_pay_price) + '\n' +
    '<b>应支付金额：</b>' + html(order.need_pay_price) + '\n\n' +
    '<b>请勿继续支付该订单！如已支付请联系客服！</b>'
}
async function notifyTelegram(botToken: string, chatId: string, message: string) {
  try {
    const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return false
    const result = await response.json() as { ok?: boolean }
    return result.ok === true
  } catch {
    return false
  }
}
async function claimExpiredPremium(client: PoolClient) {
  const result = await client.query<PremiumOrder>(
    'SELECT a.rid,a.bot_rid,a.buy_tg_uid,a.premium_tg_username,a.premium_package_month,a.need_pay_usdt::text ' +
    'FROM t_premium_platform_order a JOIN t_telegram_bot b ON b.rid=a.bot_rid ' +
    'WHERE a.status=0 AND a.expire_time<=now() ORDER BY a.rid LIMIT 20 FOR UPDATE OF a SKIP LOCKED'
  )
  let count = 0
  for (const order of result.rows) {
    const changed = await client.query('UPDATE t_premium_platform_order SET status=3,update_time=now() WHERE rid=$1 AND status=0 AND expire_time<=now() RETURNING rid', [order.rid])
    if (!changed.rowCount) continue
    await client.query(
      "INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) " +
      "VALUES('cancelunpaidorder',$1,'premium_order',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",
      ['cancelunpaidorder:premium:' + order.rid, String(order.rid), order.bot_rid, order.buy_tg_uid, premiumMessage(order)]
    )
    count++
  }
  return count
}
async function claimExpiredRecharge(client: PoolClient) {
  const result = await client.query<RechargeOrder>(
    'SELECT a.rid,a.bot_rid,a.recharge_tg_uid,a.need_pay_price::text,a.recharge_coin_name,a.recharge_pay_price::text ' +
    'FROM t_fms_recharge_order a JOIN t_telegram_bot b ON b.rid=a.bot_rid ' +
    'WHERE a.status=0 AND a.expire_time<=now() ORDER BY a.rid LIMIT 20 FOR UPDATE OF a SKIP LOCKED'
  )
  let count = 0
  for (const order of result.rows) {
    const changed = await client.query('UPDATE t_fms_recharge_order SET status=2,update_time=now() WHERE rid=$1 AND status=0 AND expire_time<=now() RETURNING rid', [order.rid])
    if (!changed.rowCount) continue
    await client.query(
      "INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) " +
      "VALUES('cancelunpaidorder',$1,'recharge_order',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",
      ['cancelunpaidorder:recharge:' + order.rid, String(order.rid), order.bot_rid, order.recharge_tg_uid, rechargeMessage(order)]
    )
    count++
  }
  return count
}
async function claimOutbox(pool: Database, owner: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<OutboxItem>(
      'WITH candidates AS (' +
      "SELECT o.id,o.bot_rid FROM t_platform_job_outbox o WHERE ((o.status='pending' AND o.next_attempt_at<=now()) OR (o.status='processing' AND o.locked_until<=now())) " +
      "AND o.task_name=$1 ORDER BY o.id LIMIT 40 FOR UPDATE OF o SKIP LOCKED" +
      '), updated AS (' +
      "UPDATE t_platform_job_outbox o SET status='processing',attempts=o.attempts+1,lock_owner=$2,locked_until=now()+interval '300 seconds',updated_at=now() " +
      'FROM candidates c WHERE o.id=c.id RETURNING o.id,o.bot_rid,o.chat_id,o.message_text,o.attempts,o.max_attempts' +
      ') SELECT u.id::text,b.bot_token,u.chat_id,u.message_text,u.attempts,u.max_attempts FROM updated u LEFT JOIN t_telegram_bot b ON b.rid=u.bot_rid ORDER BY u.id',
      ['cancelunpaidorder', owner]
    )
    await client.query('COMMIT')
    return result.rows
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
async function settleOutbox(pool: Database, owner: string, item: OutboxItem, success: boolean) {
  const client = await pool.connect()
  try {
    if (success) {
      await client.query("UPDATE t_platform_job_outbox SET status='sent',sent_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL,last_error_code=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2", [item.id, owner])
      return
    }
    const retrySeconds = Math.min(300, 5 * (2 ** Math.max(0, item.attempts - 1)))
    await client.query(
      "UPDATE t_platform_job_outbox SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END," +
      "next_attempt_at=now()+($3 * interval '1 second'),updated_at=now(),lock_owner=NULL,locked_until=NULL,last_error_code='telegram_delivery_failed' " +
      "WHERE id=$1 AND status='processing' AND lock_owner=$2",
      [item.id, owner, retrySeconds]
    )
  } finally {
    client.release()
  }
}
async function releaseOutbox(pool: Database, owner: string) {
  await pool.connect().then(async client => {
    try {
      await client.query("UPDATE t_platform_job_outbox SET status='pending',attempts=GREATEST(attempts-1,0),next_attempt_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE status='processing' AND lock_owner=$1", [owner])
    } finally { client.release() }
  })
}
export async function expireUnpaidOrders(
  pool: Database = db,
  notifier: TelegramOrderNotifier = notifyTelegram,
  shouldContinue: () => boolean = () => true,
): Promise<ExpiredOrderResult> {
  if (!shouldContinue()) {
    return { premiumExpired: 0, rechargeExpired: 0, notificationsSent: 0, notificationsFailed: 0, notificationsQueued: 0 }
  }
  const client = await pool.connect()
  let premiumExpired = 0
  let rechargeExpired = 0
  try {
    await client.query('BEGIN')
    premiumExpired = await claimExpiredPremium(client)
    rechargeExpired = await claimExpiredRecharge(client)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  if (!shouldContinue()) {
    return { premiumExpired, rechargeExpired, notificationsSent: 0, notificationsFailed: 0, notificationsQueued: 0 }
  }

  const owner = randomUUID()
  const items = await claimOutbox(pool, owner)
  let notificationsSent = 0
  let notificationsFailed = 0
  try {
    for (const item of items) {
      if (!shouldContinue()) break
      const success = item.bot_token ? await notifier(item.bot_token, item.chat_id, item.message_text) : false
      await settleOutbox(pool, owner, item, success)
      if (success) notificationsSent++
      else notificationsFailed++
    }
  } finally {
    if (!shouldContinue()) await releaseOutbox(pool, owner)
  }
  return {
    premiumExpired,
    rechargeExpired,
    notificationsSent,
    notificationsFailed,
    notificationsQueued: items.length,
  }
}
