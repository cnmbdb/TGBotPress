import { randomUUID } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number }
type Trade = { rid: number; transferfrom_address: string; amount: string; coin_name: string; tx_hash: string; process_status: number }
type RechargeOrder = { rid: number; bot_rid: number; recharge_tg_uid: string; recharge_coin_name: string; recharge_pay_price: string; need_pay_price: string; comments: string | null }
type CloneOrder = { rid: number; master_bot_rid: number; pay_user_tg_uid: string }
type Outbox = { id: string; bot_token: string | null; chat_id: string; message_text: string; attempts: number; max_attempts: number }

export function normalizeRechargeAmount(value: unknown): string | null {
  const amount = String(value ?? '').trim()
  if (amount.length > 100 || !/^\d+(?:\.\d+)?$/.test(amount)) return null
  const [whole = '0', fraction = ''] = amount.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? normalizedWhole + '.' + normalizedFraction : normalizedWhole
}
function html(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function paidMessage(order: RechargeOrder, trade: Trade) {
  return '✅您的充值订单已成功！\n' + '➖➖➖➖➖➖➖➖\n' +
    '<b>订单号：</b>' + html(trade.rid) + '\n<b>充值币种：</b>' + html(trade.coin_name) + '\n<b>充值金额：</b>' + html(order.recharge_pay_price)
}
function clonePaidMessage(order: CloneOrder) {
  return '✅克隆/代理开户支付成功！\n订单号：<code>' + html(order.rid) + '</code>\n请在 15 分钟内发送机器人 token，完成开户。'
}
async function statusTrade(client: PoolClient, rid: number, status: number, comment: string) {
  await client.query('UPDATE t_fms_wallet_trade_list SET process_status=$2,process_comments=$3,process_time=now() WHERE rid=$1 AND process_status=1', [rid, status, comment])
}
async function addOutbox(client: PoolClient, trade: Trade, botRid: number, chatId: string, message: string) {
  await client.query(
    "INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) " +
    "VALUES('handlerechargeorder',$1,'recharge_trade',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",
    ['handlerechargeorder:' + trade.rid, String(trade.rid), botRid, chatId, message]
  )
}
async function findRecharge(client: PoolClient, trade: Trade, amount: string) {
  const result = await client.query<RechargeOrder>(
    'SELECT rid,bot_rid,recharge_tg_uid,recharge_coin_name,recharge_pay_price::text,need_pay_price::text,comments ' +
    'FROM t_fms_recharge_order WHERE recharge_coin_name=$1 AND need_pay_price=$2::numeric AND status=0 ORDER BY rid LIMIT 1 FOR UPDATE SKIP LOCKED',
    [trade.coin_name, amount]
  )
  return result.rows[0] ?? null
}
async function processClonePayment(client: PoolClient, trade: Trade, recharge: RechargeOrder, orderId: number) {
  const found = await client.query<CloneOrder>(
    "SELECT rid,master_bot_rid,pay_user_tg_uid::text FROM t_telegram_clone_proxy_order WHERE rid=$1 AND order_type='opening' AND status=0 FOR UPDATE",
    [orderId]
  )
  const clone = found.rows[0]
  if (!clone) {
    await client.query("UPDATE t_fms_recharge_order SET status=3,comments='克隆代理开户订单不存在或已处理',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [recharge.rid])
    await statusTrade(client, trade.rid, 7, '克隆代理开户订单不存在或已处理')
    return false
  }
  const paid = await client.query(
    'UPDATE t_fms_recharge_order SET status=1,complete_time=now(),tx_hash=$2,update_time=now() WHERE rid=$1 AND status=0',
    [recharge.rid, trade.tx_hash]
  )
  if (paid.rowCount !== 1) return false
  await client.query(
    "UPDATE t_telegram_clone_proxy_order SET status=1,payment_method='chain',need_pay_amount=$2,external_order_rid=$3,paid_time=now(),update_time=now(),comments='链上支付成功，等待提交机器人 token' WHERE rid=$1 AND status=0",
    [clone.rid, recharge.need_pay_price, recharge.rid]
  )
  await client.query(
    "INSERT INTO t_platform_cloneproxy_token_waiter(master_bot_rid,pay_user_tg_uid,clone_proxy_order_rid,expires_at) " +
    "VALUES($1,$2,$3,now()+interval '15 minutes') " +
    'ON CONFLICT(master_bot_rid,pay_user_tg_uid) DO UPDATE SET clone_proxy_order_rid=EXCLUDED.clone_proxy_order_rid,expires_at=EXCLUDED.expires_at,consumed_at=NULL',
    [clone.master_bot_rid, clone.pay_user_tg_uid, clone.rid]
  )
  await client.query(
    "UPDATE t_fms_wallet_trade_list SET process_status=9,process_comments='克隆代理开户支付成功',process_time=now(),recharge_order_rid=$2 WHERE rid=$1 AND process_status=1",
    [trade.rid, recharge.rid]
  )
  await addOutbox(client, trade, clone.master_bot_rid, clone.pay_user_tg_uid, clonePaidMessage(clone))
  return true
}
async function processOne(pool: Database, rid: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<Trade>(
      'SELECT rid,transferfrom_address,amount,coin_name,tx_hash,process_status FROM t_fms_wallet_trade_list WHERE rid=$1 AND process_status=1 FOR UPDATE SKIP LOCKED',
      [rid]
    )
    const trade = locked.rows[0]
    if (!trade) { await client.query('ROLLBACK'); return 'skipped' }
    const amount = normalizeRechargeAmount(trade.amount)
    if (!amount || !['trx', 'usdt'].includes(trade.coin_name.toLowerCase())) {
      await statusTrade(client, trade.rid, 7, '金额无对应套餐')
      await client.query('COMMIT')
      return 'unmatched'
    }
    const recharge = await findRecharge(client, trade, amount)
    if (!recharge) {
      await statusTrade(client, trade.rid, 7, '金额无对应套餐')
      await client.query('COMMIT')
      return 'unmatched'
    }
    const cloneMatch = /^__clone_proxy__:(\d{1,18})$/.exec(recharge.comments ?? '')
    if (cloneMatch) {
      const processed = await processClonePayment(client, trade, recharge, Number(cloneMatch[1]))
      await client.query('COMMIT')
      return processed ? 'clonePaid' : 'cloneMissing'
    }
    const users = await client.query<{ rid: number }>(
      'SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid::text=$2 FOR UPDATE',
      [recharge.bot_rid, recharge.recharge_tg_uid]
    )
    const user = users.rows[0]
    if (!user) {
      await statusTrade(client, trade.rid, 3, '找不到用户')
      await client.query('COMMIT')
      return 'userMissing'
    }
    const orderChanged = await client.query(
      'UPDATE t_fms_recharge_order SET status=1,complete_time=now(),tx_hash=$2,update_time=now() WHERE rid=$1 AND status=0',
      [recharge.rid, trade.tx_hash]
    )
    if (orderChanged.rowCount !== 1) { await client.query('ROLLBACK'); return 'skipped' }
    const coin = trade.coin_name.toLowerCase()
    const balanceColumn = coin === 'trx' ? 'cash_trx' : 'cash_usdt'
    const totalColumn = coin === 'trx' ? 'total_recharge_trx' : 'total_recharge_usdt'
    await client.query(
      'UPDATE t_telegram_bot_user SET ' + balanceColumn + '=' + balanceColumn + '+$2::numeric,' +
      totalColumn + '=' + totalColumn + '+$2::numeric WHERE rid=$1',
      [user.rid, recharge.recharge_pay_price]
    )
    await client.query('UPDATE t_fms_wallet_trade_list SET process_status=9,process_comments=$2,process_time=now(),recharge_order_rid=$3 WHERE rid=$1 AND process_status=1',
      [trade.rid, '充值成功', recharge.rid])
    await addOutbox(client, trade, recharge.bot_rid, recharge.recharge_tg_uid, paidMessage(recharge, trade))
    await client.query('COMMIT')
    return 'paid'
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}
async function sendOutbox(pool: Database, fetcher: typeof fetch, logger: Logger, shouldContinue: () => boolean) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return 0
  const owner = randomUUID(), claim = await pool.connect()
  let rows: Outbox[] = []
  try {
    await claim.query('BEGIN')
    const result = await claim.query<Outbox>(
      "WITH candidates AS (SELECT id,bot_rid FROM t_platform_job_outbox WHERE task_name='handlerechargeorder' AND " +
      "((status='pending' AND next_attempt_at<=now()) OR (status='processing' AND locked_until<=now())) ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED),claimed AS (" +
      "UPDATE t_platform_job_outbox o SET status='processing',attempts=o.attempts+1,lock_owner=$1,locked_until=now()+interval '60 seconds',updated_at=now() " +
      'FROM candidates c WHERE o.id=c.id RETURNING o.id::text,o.bot_rid,o.chat_id,o.message_text,o.attempts,o.max_attempts) ' +
      'SELECT c.id,b.bot_token,c.chat_id,c.message_text,c.attempts,c.max_attempts FROM claimed c LEFT JOIN t_telegram_bot b ON b.rid=c.bot_rid',
      [owner]
    )
    rows = result.rows
    await claim.query('COMMIT')
  } catch (error) {
    await claim.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { claim.release() }
  let sent = 0
  for (const item of rows) {
    if (!shouldContinue()) break
    let ok = false
    try {
      if (item.bot_token) {
        const response = await fetcher('https://api.telegram.org/bot' + item.bot_token + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: item.chat_id, text: item.message_text, parse_mode: 'HTML' }),
          redirect: 'error', signal: AbortSignal.timeout(12_000),
        })
        const payload = await response.json().catch(() => null) as { ok?: boolean } | null
        ok = response.ok && payload?.ok === true
      }
    } catch { }
    const client = await pool.connect()
    try {
      if (ok) {
        await client.query("UPDATE t_platform_job_outbox SET status='sent',sent_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2", [item.id, owner])
        sent++
      } else {
        const delay = Math.min(300, 5 * 2 ** Math.max(0, item.attempts - 1))
        await client.query(
          "UPDATE t_platform_job_outbox SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END," +
          "next_attempt_at=now()+($3*interval '1 second'),last_error_code='telegram_delivery_failed',updated_at=now(),lock_owner=NULL,locked_until=NULL " +
          "WHERE id=$1 AND status='processing' AND lock_owner=$2",
          [item.id, owner, delay]
        )
      }
    } finally { client.release() }
  }
  if (!shouldContinue()) {
    await pool.query(
      "UPDATE t_platform_job_outbox SET status='pending',attempts=GREATEST(attempts-1,0),next_attempt_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL " +
      "WHERE status='processing' AND lock_owner=$1", [owner]
    )
  }
  if (rows.length > sent) logger.error('handlerechargeorder Telegram outbox delivery incomplete')
  return sent
}
export async function syncRechargeOrders(options: Options = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_RECHARGE_ORDER_ACTIONS === 'true')) {
    return { skipped: true, scanned: 0, paid: 0, unmatched: 0, userMissing: 0, failed: 0, notificationsSent: 0 }
  }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const keepGoing = options.shouldContinue ?? (() => true), limit = Math.min(Math.max(options.batchSize ?? 100, 1), 100)
  if (!keepGoing()) return { skipped: true, scanned: 0, paid: 0, unmatched: 0, userMissing: 0, failed: 0, notificationsSent: 0 }
  const pending = await pool.query<{ rid: number }>('SELECT rid FROM t_fms_wallet_trade_list WHERE process_status=1 ORDER BY rid LIMIT $1', [limit])
  let scanned = 0, paid = 0, unmatched = 0, userMissing = 0, failed = 0
  for (const row of pending.rows) {
    if (!keepGoing()) break
    scanned++
    try {
      const result = await processOne(pool, row.rid)
      if (result === 'paid' || result === 'clonePaid') paid++
      else if (result === 'unmatched') unmatched++
      else if (result === 'userMissing') userMissing++
    } catch {
      failed++
      logger.error('handlerechargeorder failed for trade ' + row.rid)
    }
  }
  let notificationsSent = 0
  try { notificationsSent = await sendOutbox(pool, fetcher, logger, keepGoing) }
  catch { logger.error('handlerechargeorder outbox delivery failed') }
  return { skipped: false, scanned, paid, unmatched, userMissing, failed, notificationsSent }
}
