import type { DatabaseConnection as Pool } from './database.types'

type Database = Pick<Pool, 'query'>
type Message = Record<string, any> & { message_id?: number | string; text?: string; chat: { id: number | string; type: string; username?: string }; from?: { id?: number | string; is_bot?: boolean; username?: string } }
type Update = { rid: number; update_body: { message?: Message; callback_query?: { id?: number | string; data?: string; from?: { id?: number | string; is_bot?: boolean; username?: string }; message?: Message } } }
type Selected = { callback?: NonNullable<Update['update_body']['callback_query']>; message: Message; chatId: string; userId: string; packageRid: number; payment: 'trx' | 'usd'; action: 'select' | 'confirm' | 'other' | 'reply'; walletAddr?: string; promptMessageId?: string }
type TelegramResult = { ok?: boolean; result?: { message_id?: number } }

export const energyBalancePurchaseClaimPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND (u.update_body #>> '{callback_query,data}' ~ '^balancebuy(trx|usd)[1-9][0-9]{0,9}$' OR u.update_body #>> '{callback_query,data}' ~ '^balancebuyconf(trx|usd)[1-9][0-9]{0,9}$' OR u.update_body #>> '{callback_query,data}' ~ '^balancebuyother[1-9][0-9]{0,9}_(trx|usd)$')",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n')

export const energyBalancePurchaseReplyClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND u.update_body #>> '{message,chat,id}'=u.update_body #>> '{message,from,id}'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s',
  ' WHERE s.bot_rid=u.bot_rid AND s.chat_id::text=u.update_body #>> \'{message,chat,id}\' AND s.user_id::text=u.update_body #>> \'{message,from,id}\'',
  " AND s.state='energy_buy_other_address' AND s.expires_at>now()",
  " AND s.prompt_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}')",
].join('\n')

export function energyBalancePurchaseCallback(update: Update['update_body']): Selected | null {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^(balancebuy|balancebuyconf)(trx|usd)([1-9][0-9]{0,9})$/u.exec(data)
  const other = /^balancebuyother([1-9][0-9]{0,9})_(trx|usd)$/u.exec(data)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || (!match && !other)) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return {
    callback, message, chatId, userId,
    packageRid: Number(match?.[3] ?? other?.[1]),
    payment: (match?.[2] ?? other?.[2]) as 'trx' | 'usd',
    action: other ? 'other' : match![1] === 'balancebuy' ? 'select' : 'confirm',
  }
}

async function energyBalancePurchaseReply(pool: Database, botRid: number, update: Update['update_body']): Promise<Selected | null> {
  const message = update?.message
  const chatId = String(message?.chat?.id ?? ''), userId = String(message?.from?.id ?? '')
  const promptMessageId = String(message?.reply_to_message?.message_id ?? '')
  if (!message || message.chat?.type !== 'private' || message.from?.is_bot || userId !== chatId || !/^\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(promptMessageId)) return null
  const state = await pool.query<{ context: Record<string, unknown> | string | null }>(`SELECT context FROM t_platform_telegram_conversation_state
    WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='energy_buy_other_address' AND prompt_message_id=$4 AND expires_at>now() LIMIT 1`, [botRid, chatId, userId, promptMessageId])
  const raw = state.rows[0]?.context
  let context: Record<string, unknown> | null = null
  if (typeof raw === 'string') { try { context = JSON.parse(raw) as Record<string, unknown> } catch { context = null } }
  else if (raw && typeof raw === 'object') context = raw
  const packageRid = Number(context?.packageRid), payment = context?.payment
  if (!Number.isSafeInteger(packageRid) || packageRid <= 0 || (payment !== 'trx' && payment !== 'usd')) return null
  return { message, chatId, userId, packageRid, payment, action: 'reply', walletAddr: String(message.text ?? '').trim(), promptMessageId }
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function decimalUnits(value: unknown, scale = 6): bigint | null {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,6}))?$/u.exec(String(value ?? '').trim())
  if (!match || (match[2]?.length ?? 0) > scale) return null
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? '').padEnd(scale, '0') || '0')
}

function compactDecimal(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1')
}

async function telegram(fetcher: typeof fetch, token: string, method: string, payload: Record<string, unknown>): Promise<TelegramResult> {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(token)) return { ok: false }
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    return await response.json() as TelegramResult
  } catch { return { ok: false } }
}

async function send(pool: Database, fetcher: typeof fetch, botRid: number, chatId: string, text: string, keyboard?: unknown) {
  const bot = await pool.query<{ bot_token: string | null }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = bot.rows[0]?.bot_token
  if (!token) throw new Error('energy_balance_purchase_bot_missing')
  const sent = await telegram(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(keyboard ? { reply_markup: keyboard } : {}) })
  if (!sent.ok) throw new Error('energy_balance_purchase_reply_failed')
  return sent.result?.message_id == null ? null : String(sent.result.message_id)
}

function menuKeyboard(packageRid: number, payment: 'trx' | 'usd', supportName: string | null) {
  const other = payment === 'trx' ? 'usd' : 'trx'
  const support = String(supportName ?? '').replace(/^@/u, '')
  const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
    [{ text: '☑️确定购买', callback_data: `balancebuyconf${payment}${packageRid}` }],
    [{ text: payment === 'trx' ? '↔️USDT 余额购买' : '↔️TRX 余额购买', callback_data: `balancebuy${other}${packageRid}` }, { text: '🔄重新选择套餐', callback_data: '/buyenergy' }],
    [{ text: '❓地址不对? 更换绑定钱包', callback_data: 'userbindaddress' }, { text: '🟣给其他地址购买', callback_data: `balancebuyother${packageRid}_${payment}` }],
  ]
  if (/^[A-Za-z0-9_]{5,32}$/u.test(support)) keyboard[2].push({ text: '👨联系客服', url: `https://t.me/${support}` })
  return { inline_keyboard: keyboard }
}

export async function handleEnergyBalancePurchaseCallback(options: { pool: Database; fetcher: typeof fetch; botRid: number; update: Update }) {
  const { pool, fetcher, botRid, update } = options
  const selected = energyBalancePurchaseCallback(update.update_body) ?? await energyBalancePurchaseReply(pool, botRid, update.update_body)
  if (!selected) {
    if (update.update_body.message?.reply_to_message && process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true') {
      const prior = await pool.query<{ chat_id: string; response_text: string; response_markup: unknown }>('SELECT chat_id::text,response_text,response_markup FROM t_platform_telegram_energy_balance_purchase WHERE update_rid=$1 AND bot_rid=$2 LIMIT 1', [update.rid, botRid])
      if (prior.rows[0]) {
        await send(pool, fetcher, botRid, prior.rows[0].chat_id, prior.rows[0].response_text, prior.rows[0].response_markup)
        return true
      }
    }
    return false
  }
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = bot.rows[0]?.bot_token
  if (!token) throw new Error('energy_balance_purchase_bot_missing')
  const purchaseDisabled = selected.action !== 'select' && process.env.PLATFORM_ENERGY_ORDER_ACTIONS !== 'true'
  if (selected.callback?.id != null) {
    // Callback acknowledgements expire quickly; a retry must still replay the durable receipt.
    await telegram(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id), ...(purchaseDisabled ? { text: '余额购买功能当前未启用', show_alert: true } : {}) })
  }
  if (purchaseDisabled) {
    if (!selected.callback) await send(pool, fetcher, botRid, selected.chatId, '余额购买功能当前未启用。')
    return true
  }

  if (selected.action === 'select') {
    const [user, pkg] = await Promise.all([
      pool.query<{ bind_trc_wallet_addr: string | null }>('SELECT bind_trc_wallet_addr FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.userId]),
      pool.query<{ package_name: string; energy_amount: number; trx_price: string; usdt_price: string }>(`SELECT p.package_name,p.energy_amount,p.trx_price::text,p.usdt_price::text
        FROM t_energy_platform_package p JOIN t_energy_platform_bot b ON b.bot_rid=p.bot_rid
        WHERE p.rid=$1 AND p.bot_rid=$2 AND p.status=0 AND b.status=0 LIMIT 1`, [selected.packageRid, botRid]),
    ])
    let text: string
    let keyboard: unknown
    const supportName = bot.rows[0]?.bot_admin_username ?? null
    if (!user.rows[0]) {
      text = '用户信息为空，请发送 /start 初始化用户，然后再进行快捷购买能量'
      keyboard = { inline_keyboard: supportName ? [[{ text: '👨联系客服', url: `https://t.me/${String(supportName).replace(/^@/u, '')}` }]] : [] }
    } else if (!user.rows[0].bind_trc_wallet_addr) {
      text = '🔴<b>请点击下方按钮，先绑定您的钱包地址</b>'
      keyboard = { inline_keyboard: [[{ text: '绑定波场钱包', callback_data: 'userbindaddress' }, ...(supportName ? [{ text: '👨联系客服', url: `https://t.me/${String(supportName).replace(/^@/u, '')}` }] : [])]] }
    } else if (!pkg.rows[0]) {
      text = '<b>您好！该套餐已暂停购买，请选择其他套餐！</b>'
      keyboard = { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] }
    } else {
      const item = pkg.rows[0]
      const price = selected.payment === 'trx' ? item.trx_price : item.usdt_price
      text = `🟢<b>购买地址：</b><code>${escapeHtml(user.rows[0].bind_trc_wallet_addr)}</code>\n购买套餐：${escapeHtml(item.package_name)}\n购买能量：${item.energy_amount}\n支付方式：${escapeHtml(price)} ${selected.payment.toUpperCase()}\n\n🔶如果给其他地址购买能量，请点击下方按钮《给其他地址购买》`
      keyboard = menuKeyboard(selected.packageRid, selected.payment, supportName)
    }
    await send(pool, fetcher, botRid, selected.chatId, text, keyboard)
    return true
  }

  if (selected.action === 'other') {
    const pkg = await pool.query<{ package_name: string }>(`SELECT p.package_name
      FROM t_energy_platform_package p JOIN t_energy_platform_bot b ON b.bot_rid=p.bot_rid
      WHERE p.rid=$1 AND p.bot_rid=$2 AND p.status=0 AND b.status=0 LIMIT 1`, [selected.packageRid, botRid])
    if (!pkg.rows[0]) {
      await send(pool, fetcher, botRid, selected.chatId, '该套餐已暂停购买，请重新选择套餐。', { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] })
      return true
    }
    const promptMessageId = await send(pool, fetcher, botRid, selected.chatId, `请回复要购买能量的 TRON 地址（套餐：${escapeHtml(pkg.rows[0].package_name)}，支付：${selected.payment.toUpperCase()}）。`, { force_reply: true, selective: true })
    if (!promptMessageId) throw new Error('energy_balance_purchase_prompt_id_missing')
    await pool.query(`INSERT INTO t_platform_telegram_conversation_state
      (bot_rid,chat_id,user_id,state,prompt_message_id,context,expires_at,updated_at)
      VALUES($1,$2,$3,'energy_buy_other_address',$4,$5::jsonb,now()+interval '2 minutes',now())
      ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state=EXCLUDED.state,prompt_message_id=EXCLUDED.prompt_message_id,context=EXCLUDED.context,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [botRid, selected.chatId, selected.userId, promptMessageId, JSON.stringify({ packageRid: selected.packageRid, payment: selected.payment })])
    return true
  }

  if (selected.action === 'reply' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(String(selected.walletAddr ?? ''))) {
    await send(pool, fetcher, botRid, selected.chatId, 'TRON 地址格式不正确，请回复一个有效的 T 开头地址。')
    return true
  }

  type Receipt = { update_rid: number; outcome: 'purchased' | 'user_missing' | 'wallet_missing' | 'package_unavailable' | 'unsupported_price' | 'insufficient_balance'; response_text: string; response_markup: unknown }
  const client = await (pool as Pool).connect()
  let receipt: Receipt | undefined
  try {
    await client.query('BEGIN')
    const idempotencyKey = selected.callback?.id == null ? `update:${update.rid}` : `callback:${String(selected.callback.id)}`
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-energy-balance-purchase:' || $1,0))", [idempotencyKey])
    const prior = await client.query<Receipt>('SELECT update_rid,outcome,response_text,response_markup FROM t_platform_telegram_energy_balance_purchase WHERE update_rid=$1 OR ($2::text IS NOT NULL AND callback_query_id=$2) LIMIT 1 FOR UPDATE', [update.rid, selected.callback?.id == null ? null : String(selected.callback.id)])
    if (prior.rows[0]) {
      receipt = prior.rows[0]
      await client.query('COMMIT')
    } else {
      let replyStateValid = true
      if (selected.action === 'reply') {
        const state = await client.query<{ context: Record<string, unknown> | string | null }>(`SELECT context FROM t_platform_telegram_conversation_state
          WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='energy_buy_other_address' AND prompt_message_id=$4 AND expires_at>now() FOR UPDATE`,
        [botRid, selected.chatId, selected.userId, selected.promptMessageId])
        const context = typeof state.rows[0]?.context === 'string' ? JSON.parse(String(state.rows[0].context)) as Record<string, unknown> : state.rows[0]?.context
        replyStateValid = Boolean(context && Number(context.packageRid) === selected.packageRid && context.payment === selected.payment)
        if (replyStateValid) await client.query(`DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='energy_buy_other_address' AND prompt_message_id=$4`, [botRid, selected.chatId, selected.userId, selected.promptMessageId])
      }
      const save = async (outcome: Receipt['outcome'], response: string, markup: unknown, price: string | null = null, orderRid: number | null = null) => {
        const saved = await client.query<Receipt>(`INSERT INTO t_platform_telegram_energy_balance_purchase
          (update_rid,callback_query_id,bot_rid,chat_id,package_rid,payment_type,pay_price,outcome,quick_order_rid,response_text,response_markup)
          VALUES($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10,$11::jsonb)
          ON CONFLICT DO NOTHING
          RETURNING update_rid,outcome,response_text,response_markup`,
        [update.rid, selected.callback?.id == null ? null : String(selected.callback.id), botRid, selected.chatId, selected.packageRid, selected.payment, price, outcome, orderRid, response, JSON.stringify(markup)])
        receipt = saved.rows[0] ?? (await client.query<Receipt>('SELECT update_rid,outcome,response_text,response_markup FROM t_platform_telegram_energy_balance_purchase WHERE update_rid=$1 OR ($2::text IS NOT NULL AND callback_query_id=$2) LIMIT 1 FOR UPDATE', [update.rid, selected.callback?.id == null ? null : String(selected.callback.id)])).rows[0]
      }
      if (!replyStateValid) {
        await client.query('ROLLBACK')
        await send(pool, fetcher, botRid, selected.chatId, '购买地址请求已过期，请重新选择套餐。', { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] })
        return true
      }
      const user = await client.query<{ rid: number; bind_trc_wallet_addr: string | null; cash_trx: string; cash_usdt: string }>('SELECT rid,bind_trc_wallet_addr,cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1 FOR UPDATE', [botRid, selected.userId])
      if (!user.rows[0]) {
        await save('user_missing', '用户信息为空，请发送 /start 初始化用户，然后再进行快捷购买能量。', { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] })
      } else if (selected.action === 'confirm' && !user.rows[0].bind_trc_wallet_addr) {
        await save('wallet_missing', '请先绑定波场钱包，再购买能量套餐。', { inline_keyboard: [[{ text: '绑定波场钱包', callback_data: 'userbindaddress' }]] })
      } else {
        const pkg = await client.query<{ rid: number; package_name: string; energy_amount: number; energy_day: number; trx_price: string; usdt_price: string }>(`SELECT p.rid,p.package_name,p.energy_amount,p.energy_day,p.trx_price::text,p.usdt_price::text
          FROM t_energy_platform_package p JOIN t_energy_platform_bot b ON b.bot_rid=p.bot_rid
          WHERE p.rid=$1 AND p.bot_rid=$2 AND p.status=0 AND b.status=0 LIMIT 1 FOR SHARE OF p,b`, [selected.packageRid, botRid])
        const item = pkg.rows[0]
        if (!item) {
          await save('package_unavailable', '您好！该套餐已暂停购买，请重新选择套餐。', { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] })
        } else {
          const rawPrice = selected.payment === 'trx' ? item.trx_price : item.usdt_price
          const units = decimalUnits(rawPrice)
          const price = units == null ? null : compactDecimal(String(rawPrice))
          if (units == null || units <= 0n || !price || !Number.isSafeInteger(item.energy_amount) || item.energy_amount <= 0 || ![0, 1, 3].includes(item.energy_day)) {
            await save('unsupported_price', '套餐价格或能量配置无效，请联系客服处理。', { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] })
          } else {
            const balanceColumn = selected.payment === 'trx' ? 'cash_trx' : 'cash_usdt'
            const debited = await client.query<{ cash_trx: string; cash_usdt: string }>(`UPDATE t_telegram_bot_user SET ${balanceColumn}=${balanceColumn}-$2::numeric WHERE rid=$1 AND ${balanceColumn}>=$2::numeric RETURNING cash_trx::text,cash_usdt::text`, [user.rows[0].rid, price])
            if (!debited.rowCount) {
              const markup = { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }, { text: '💵充值余额', callback_data: 'aitrusteeshiprechargetrx' }]] }
              const text = `<b>❌余额不足，请及时充值！</b>\nTRX 余额：${escapeHtml(user.rows[0].cash_trx)}\nUSDT 余额：${escapeHtml(user.rows[0].cash_usdt)}\n\n当前套餐需要：${escapeHtml(item.trx_price)} TRX 或者：${escapeHtml(item.usdt_price)} USDT`
              await save('insufficient_balance', text, markup, price)
            } else {
              const order = await client.query<{ rid: number }>(`INSERT INTO t_energy_quick_order
                (bot_rid,tg_uid,wallet_addr,energy_amount,energy_day,package_name,package_rid,status,pay_price,pay_type,pay_time,create_time,update_time)
                VALUES($1,$2,$3,$4,$5,$6,$7,1,$8::numeric,$9,now(),now(),now()) RETURNING rid`,
                [botRid, selected.chatId, selected.action === 'reply' ? selected.walletAddr : user.rows[0].bind_trc_wallet_addr, item.energy_amount, item.energy_day, item.package_name, item.rid, price, selected.payment === 'trx' ? 'trx' : 'usdt'])
              if (!order.rows[0]) throw new Error('energy_balance_purchase_order_insert_failed')
              const purchaseWallet = selected.action === 'reply' ? selected.walletAddr! : user.rows[0].bind_trc_wallet_addr!
              const response = `✅恭喜您，购买成功！能量将在5秒内到账\n购买地址：<code>${escapeHtml(purchaseWallet)}</code>\n购买套餐：${escapeHtml(item.package_name)}\n购买能量：${item.energy_amount}\n支付方式：${escapeHtml(price)} ${selected.payment.toUpperCase()}\n\n剩余可用余额：${escapeHtml(debited.rows[0].cash_trx)} TRX ${escapeHtml(debited.rows[0].cash_usdt)} USDT`
              await save('purchased', response, { inline_keyboard: [[{ text: '🔄重新购买套餐', callback_data: '/buyenergy' }]] }, price, order.rows[0].rid)
            }
          }
        }
      }
      if (!receipt) throw new Error('energy_balance_purchase_receipt_missing')
      await client.query('COMMIT')
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }

  await send(pool, fetcher, botRid, selected.chatId, receipt!.response_text, receipt!.response_markup)
  return true
}
