import { randomInt } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '@tgbotpress/plugin-sdk'

type Database = Pick<Pool, 'query' | 'connect'>
type Config = { is_enable: number; charge_enable: number; open_price: string; default_revenue_ratio: string; merchant_limit: number; bot_token: string | null; recharge_wallet_addr: string | null }
type Msg = { chat?: { id?: unknown; type?: unknown }; from?: { id?: unknown; username?: unknown; is_bot?: unknown }; text?: unknown }
type Update = { update_id?: unknown; message?: Msg; callback_query?: { id?: unknown; data?: unknown; from?: Msg['from']; message?: Msg } }

export const CLONE_PROXY_BUTTON = '克隆/代理'
export const telegramCloneProxyClaimPredicate = [
  "((u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,from,id}'=u.update_body #>> '{message,chat,id}'",
  "AND regexp_replace(trim(COALESCE(u.update_body #>> '{message,text}','')), '[[:space:]🤖]', '', 'g') IN ('克隆/代理','克隆/代理机器人','克隆代理机器人')",
  'AND EXISTS (SELECT 1 FROM t_telegram_clone_proxy_config c WHERE c.master_bot_rid=u.bot_rid))',
  "OR (u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND COALESCE(u.update_body #>> '{callback_query,data}','') LIKE 'cloneproxy:%')",
  ')',
].join('\n')

const privateId = (v: unknown) => /^\d{1,20}$/u.test(String(v ?? '')) ? String(v) : ''
const escapeHtml = (v: unknown) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const formatAmount = (v: unknown) => Number.isFinite(Number(v)) ? Number(v).toFixed(6).replace(/\.?0+$/u, '') : '0'
const entryText = (v: unknown) => ['克隆/代理', '克隆/代理机器人', '克隆代理机器人'].includes(String(v ?? '').replace(/[\s🤖]/gu, ''))

async function configFor(pool: Pick<Pool, 'query'>, botRid: number) {
  const result = await pool.query<Config>(
    'SELECT c.is_enable,c.charge_enable,c.open_price::text,c.default_revenue_ratio::text,c.merchant_limit,b.bot_token,b.recharge_wallet_addr ' +
    'FROM t_telegram_clone_proxy_config c JOIN t_telegram_bot b ON b.rid=c.master_bot_rid WHERE c.master_bot_rid=$1 LIMIT 1', [botRid])
  return result.rows[0] ?? null
}

export async function appendCloneProxyButton(pool: Pick<Pool, 'query'>, botRid: number, chatType: unknown, markup: unknown) {
  if (chatType !== 'private' || !markup || typeof markup !== 'object') return markup
  const value = markup as { keyboard?: unknown[] }
  if (!Array.isArray(value.keyboard)) return markup
  try {
    const result = await pool.query<{ enabled: number }>('SELECT is_enable AS enabled FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 LIMIT 1', [botRid])
    if (Number(result.rows[0]?.enabled) !== 1) return markup
    const hasEntry = value.keyboard.some(row => Array.isArray(row) && row.some(button => ['克隆/代理', '克隆/代理机器人', '克隆代理机器人'].includes(typeof button === 'string' ? button : String((button as { text?: unknown } | null)?.text ?? ''))))
    if (hasEntry) return markup
    const contactRow = value.keyboard.findIndex(row => Array.isArray(row) && row.some(button => (typeof button === 'string' ? button : String((button as { text?: unknown } | null)?.text ?? '')) === '👨联系客服'))
    const keyboard = value.keyboard.map((row, index) => index === contactRow ? [{ text: CLONE_PROXY_BUTTON }, ...(row as unknown[])] : row)
    return contactRow >= 0 ? { ...value, keyboard } : { ...value, keyboard: [...keyboard, [{ text: CLONE_PROXY_BUTTON }]] }
  } catch { return markup }
}

async function send(fetcher: typeof fetch, config: Config, chatId: string, text: string, markup?: Record<string, unknown>) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(String(config.bot_token ?? ''))) throw new Error('cloneproxy_bot_token_unavailable')
  const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true }
  if (markup) payload.reply_markup = markup
  const response = await fetcher('https://api.telegram.org/bot' + config.bot_token + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  const body = await response.json() as { ok?: boolean }
  if (!response.ok || body.ok !== true) throw new Error('cloneproxy_telegram_send_failed')
}

async function ack(fetcher: typeof fetch, config: Config, id: unknown) {
  if (!id) return
  await fetcher('https://api.telegram.org/bot' + config.bot_token + '/answerCallbackQuery', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: String(id) }),
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
}

function price(config: Pick<Config, 'charge_enable' | 'open_price'>) {
  return Number(config.charge_enable) === 1 ? Math.max(0, Number(config.open_price) || 0) : 0
}

async function offer(fetcher: typeof fetch, config: Config, chatId: string) {
  const amount = price(config)
  const text = '欢迎使用克隆代理机器人\n\n目前代理价位为：<b>' + escapeHtml(amount ? formatAmount(amount) + ' USDT' : '免费') +
    '</b>\n默认收益比例：<b>' + escapeHtml(formatAmount(config.default_revenue_ratio)) + '%</b>\n\n' +
    '开户要求：需先设置自己的 Telegram Username，且提交的 token 必须属于有效机器人。\n点击下方按钮后，按提示完成支付（如有费用）并发送机器人 token。'
  await send(fetcher, config, chatId, text, { inline_keyboard: [[{ text: amount ? '添加机器人（支付开户）' : '添加机器人', callback_data: 'cloneproxy:add' }]] })
}

async function promptToken(fetcher: typeof fetch, config: Config, chatId: string) {
  await send(fetcher, config, chatId, '请发送你的机器人 token。\n\n格式示例：<code>123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code>\n\nToken 只用于调用 Telegram Bot API，不会在用户界面回显。', {
    force_reply: true, input_field_placeholder: '请粘贴 BotFather token',
  })
}

async function expire(client: PoolClient, order: { rid: number; external_order_rid: number | null }) {
  await client.query("UPDATE t_telegram_clone_proxy_order SET status=3,comments='开户订单已过期',update_time=now() WHERE rid=$1 AND status=0", [order.rid])
  if (order.external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='克隆代理开户订单已过期',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [order.external_order_rid])
}

async function showPayment(fetcher: typeof fetch, config: Config, chatId: string, order: { rid: number; amount: string; need_pay_amount: string; external_order_rid: number | null }) {
  const wallet = String(config.recharge_wallet_addr ?? '').trim()
  let text = '开户订单已生成\n订单号：<code>' + order.rid + '</code>\n开户费用：<b>' + escapeHtml(formatAmount(order.amount)) + ' USDT</b>\n'
  text += wallet && order.external_order_rid
    ? '\n链上支付金额：<code>' + escapeHtml(formatAmount(order.need_pay_amount)) + '</code> USDT\n支付地址：<code>' + escapeHtml(wallet) + '</code>\n请在订单有效期内完成转账，到账后直接发送机器人 token。'
    : '\n管理员尚未配置充值地址，当前可使用下方余额支付。'
  await send(fetcher, config, chatId, text, { inline_keyboard: [
    [{ text: '余额支付', callback_data: 'cloneproxy:balance:' + order.rid }],
    [{ text: '取消订单', callback_data: 'cloneproxy:cancel:' + order.rid }],
  ] })
}

async function onboarding(pool: Database, fetcher: typeof fetch, config: Config, botRid: number, chatId: string, userId: string, username: string) {
  if (!username) {
    await send(fetcher, config, chatId, '请先在 Telegram 设置一个公开用户名（Username），再进行开户。设置完成后重新点击「克隆/代理机器人」。')
    return
  }
  const client = await pool.connect()
  let outcome: { type: 'active' | 'full' } | { type: 'token' } | { type: 'payment'; order: { rid: number; amount: string; need_pay_amount: string; external_order_rid: number | null } }
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('plugin:cloneproxy:lifecycle',0))")
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cloneproxy-open:' || $1 || ':' || $2,0))", [botRid, userId])
    const configResult = await client.query<Config>('SELECT is_enable,charge_enable,open_price::text,default_revenue_ratio::text,merchant_limit FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 FOR UPDATE', [botRid])
    const current = configResult.rows[0]
    if (!current || Number(current.is_enable) !== 1) { outcome = { type: 'full' }; await client.query('COMMIT') }
    else {
      const active = await client.query('SELECT 1 FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND owner_tg_uid=$2 AND status=1 LIMIT 1', [botRid, userId])
      if (active.rowCount) { outcome = { type: 'active' }; await client.query('COMMIT') }
      else {
        const pendingResult = await client.query<{ rid: number; status: number; amount: string; need_pay_amount: string; external_order_rid: number | null; expired: boolean }>(
          "SELECT rid,status,amount::text,need_pay_amount::text,external_order_rid,expire_time<now() AS expired FROM t_telegram_clone_proxy_order WHERE master_bot_rid=$1 AND pay_user_tg_uid=$2 AND order_type='opening' AND status IN (0,1) ORDER BY rid DESC LIMIT 1 FOR UPDATE", [botRid, userId])
        let pending: typeof pendingResult.rows[number] | undefined = pendingResult.rows[0]
        if (pending?.status === 0 && pending.expired) { await expire(client, pending); pending = undefined }
        if (pending) {
          await client.query('COMMIT')
          outcome = pending.status === 1 ? { type: 'token' } : { type: 'payment', order: pending }
        } else {
          const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND status=1', [botRid])
          if (Number(current.merchant_limit) > 0 && Number(count.rows[0]?.count ?? 0) >= Number(current.merchant_limit)) { outcome = { type: 'full' }; await client.query('COMMIT') }
          else {
            const amount = price(current)
            const orderResult = await client.query<{ rid: number }>(
              "INSERT INTO t_telegram_clone_proxy_order(master_bot_rid,order_type,source_type,pay_user_tg_uid,pay_user_tg_username,amount,need_pay_amount,coin_name,payment_method,status,revenue_ratio,comments,create_time,update_time,paid_time,expire_time) VALUES($1,'opening','opening',$2,$3,$4,$4,'usdt',$5,$6,$7,$8,now(),now(),CASE WHEN $6=1 THEN now() ELSE NULL END,CASE WHEN $6=0 THEN now()+interval '15 minutes' ELSE NULL END) RETURNING rid",
              [botRid, userId, username, amount, amount ? 'pending' : 'free', amount ? 0 : 1, current.default_revenue_ratio, amount ? '待支付开户' : '免费开户'])
            const orderId = Number(orderResult.rows[0].rid)
            let needPay = String(amount)
            let fmsId: number | null = null
            if (amount && String(config.recharge_wallet_addr ?? '').trim()) {
              for (let n = 0; n < 20; n++) {
                const candidate = await client.query<{ amount: string }>('SELECT round($1::numeric+$2::numeric/100,4)::text AS amount', [amount, randomInt(1, 100)])
                needPay = candidate.rows[0].amount
                const duplicate = await client.query('SELECT 1 FROM t_fms_recharge_order WHERE status=0 AND need_pay_price=$1 LIMIT 1', [needPay])
                if (!duplicate.rowCount) break
              }
              const fms = await client.query<{ rid: number }>(
                "INSERT INTO t_fms_recharge_order(bot_rid,recharge_tg_uid,recharge_tg_username,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments,create_time,expire_time) VALUES($1,$2,$3,'usdt',$4,$5,0,$6,now(),now()+interval '15 minutes') RETURNING rid",
                [botRid, userId, username, amount, needPay, '__clone_proxy__:' + orderId])
              fmsId = Number(fms.rows[0].rid)
              await client.query('UPDATE t_telegram_clone_proxy_order SET need_pay_amount=$2,external_order_rid=$3,update_time=now() WHERE rid=$1', [orderId, needPay, fmsId])
            }
            await client.query('COMMIT')
            const order = { rid: orderId, amount: String(amount), need_pay_amount: needPay, external_order_rid: fmsId }
            outcome = amount ? { type: 'payment', order } : { type: 'token' }
          }
        }
      }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  if (outcome.type === 'active') await send(fetcher, config, chatId, '您已经开通过代理机器人，无需重复开户。')
  else if (outcome.type === 'full') await send(fetcher, config, chatId, '当前代理商户名额已满或功能已关闭，请联系管理员。')
  else if (outcome.type === 'payment') await showPayment(fetcher, config, chatId, outcome.order)
  else await promptToken(fetcher, config, chatId)
}

async function pay(pool: Database, fetcher: typeof fetch, config: Config, botRid: number, chatId: string, userId: string, orderId: number) {
  const client = await pool.connect()
  let result: 'paid' | 'expired' | 'insufficient' | 'unavailable' = 'unavailable'
  try {
    await client.query('BEGIN')
    const found = await client.query<{ status: number; amount: string; external_order_rid: number | null; expired: boolean }>(
      "SELECT status,amount::text,external_order_rid,expire_time<now() AS expired FROM t_telegram_clone_proxy_order WHERE rid=$1 AND master_bot_rid=$2 AND pay_user_tg_uid=$3 AND order_type='opening' FOR UPDATE", [orderId, botRid, userId])
    const order = found.rows[0]
    if (order?.status === 1) result = 'paid'
    else if (order?.status === 0 && order.expired) { await expire(client, { rid: orderId, external_order_rid: order.external_order_rid }); result = 'expired' }
    else if (order?.status === 0) {
      const debited = await client.query('UPDATE t_telegram_bot_user SET cash_usdt=cash_usdt-$1::numeric WHERE bot_rid=$2 AND tg_uid=$3 AND cash_usdt >= $1::numeric RETURNING rid', [order.amount, botRid, userId])
      if (!debited.rowCount) result = 'insufficient'
      else {
        await client.query("UPDATE t_telegram_clone_proxy_order SET payment_method='balance',status=1,paid_time=now(),comments='余额支付成功，等待提交机器人 token',update_time=now() WHERE rid=$1 AND status=0", [orderId])
        if (order.external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='已使用余额支付开户',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [order.external_order_rid])
        result = 'paid'
      }
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
  if (result === 'paid') await promptToken(fetcher, config, chatId)
  else await send(fetcher, config, chatId, result === 'expired' ? '该开户订单已过期，请重新发起开户。' : result === 'insufficient' ? 'USDT余额不足，请先充值后再支付开户。' : '订单不存在、已支付或已失效，请重新发起开户。')
}

async function cancel(pool: Database, fetcher: typeof fetch, config: Config, botRid: number, chatId: string, userId: string, orderId: number) {
  const client = await pool.connect()
  let changed = false
  try {
    await client.query('BEGIN')
    const found = await client.query<{ external_order_rid: number | null }>("SELECT external_order_rid FROM t_telegram_clone_proxy_order WHERE rid=$1 AND master_bot_rid=$2 AND pay_user_tg_uid=$3 AND order_type='opening' AND status=0 FOR UPDATE", [orderId, botRid, userId])
    if (found.rowCount) {
      await client.query("UPDATE t_telegram_clone_proxy_order SET status=3,comments='用户取消开户订单',update_time=now() WHERE rid=$1 AND status=0", [orderId])
      if (found.rows[0].external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='用户取消克隆代理开户订单',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [found.rows[0].external_order_rid])
      changed = true
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
  await send(fetcher, config, chatId, changed ? '开户订单已取消。' : '订单不存在或已处理。')
}

export async function handleTelegramCloneProxyUpdate(options: { pool: Database; fetcher: typeof fetch; botRid: number; update: Update; shouldContinue?: () => boolean }) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || options.shouldContinue?.() === false) return false
  const callback = options.update.callback_query
  const message = callback?.message ?? options.update.message
  const chatId = privateId(message?.chat?.id)
  const from = callback?.from ?? options.update.message?.from
  const userId = privateId(from?.id)
  if (message?.chat?.type !== 'private' || !chatId || !userId || chatId !== userId || from?.is_bot === true) return false
  const data = String(callback?.data ?? '')
  if (callback ? !data.startsWith('cloneproxy:') : !entryText(options.update.message?.text)) return false
  const config = await configFor(options.pool, options.botRid)
  if (!config) return false
  if (callback) {
    await ack(options.fetcher, config, callback.id)
    const balance = /^cloneproxy:balance:(\d{1,18})$/u.exec(data)
    const cancelMatch = /^cloneproxy:cancel:(\d{1,18})$/u.exec(data)
    if (balance) await pay(options.pool, options.fetcher, config, options.botRid, chatId, userId, Number(balance[1]))
    else if (cancelMatch) await cancel(options.pool, options.fetcher, config, options.botRid, chatId, userId, Number(cancelMatch[1]))
    else if (Number(config.is_enable) !== 1) await send(options.fetcher, config, chatId, '克隆/代理机器人功能目前已关闭，请联系管理员。')
    else if (data === 'cloneproxy:open') await offer(options.fetcher, config, chatId)
    else if (data === 'cloneproxy:add') await onboarding(options.pool, options.fetcher, config, options.botRid, chatId, userId, String(from?.username ?? '').trim())
    else {
      await send(options.fetcher, config, chatId, '操作已失效，请重新点击「克隆/代理机器人」。')
    }
  } else if (Number(config.is_enable) !== 1) await send(options.fetcher, config, chatId, '克隆/代理机器人功能目前已关闭，请联系管理员。')
  else await offer(options.fetcher, config, chatId)
  return true
}
