import type { Pool } from 'pg'
import { registeredCloneProxy as cloneProxyPlugin } from '../plugins/registry.server'
const { appendButton: appendCloneProxyButton } = cloneProxyPlugin.telegram

type Database = Pick<Pool, 'query'>
type TelegramMessage = {
  message_id: number | string
  chat: { id: number | string; type: string; username?: string; title?: string }
  from?: { id?: number | string; username?: string; first_name?: string; last_name?: string }
  text?: string
  caption?: string
}
type Keyreply = {
  rid: number
  bot_token: string
  bot_username: string | null
  bot_admin_username: string | null
  opt_type: number
  monitor_word: string
  reply_photo: string | null
  reply_content: string
}
type KeyboardItem = {
  keyboard_name: string
  keyboard_icon_custom_emoji_id: string | null
  keyboard_type: number
  inline_type: number
  keyboard_value: string
  seq_sn: number
}

function actionsEnabled() { return process.env.PLATFORM_TELEGRAM_ACTIONS === 'true' }
const messageTextSql = "COALESCE(u.update_body #>> '{message,text}',u.update_body #>> '{message,caption}','')"
function keywordExpressions(messageSql: string, usernameSql: string) {
  const original = `btrim(replace(left(${messageSql},100),'@'||trim(COALESCE(${usernameSql},''),'@'),''))`
  const cleaned = `replace(replace(replace(replace(replace(${original},chr(39),''),chr(60),''),chr(62),''),chr(38),''),chr(92),'')`
  const filtered = `btrim(regexp_replace(${original}, '[\u200B-\u200D\uFEFF\u2060\uFE00-\uFE0F\u2600-\u26FF\u2700-\u27BF\u2300-\u23FF\u2B50\u2728\u274C\u274E\u2705\u2747]|[𐀀-􏿿]', '', 'g'))`
  return [original, cleaned, filtered]
}
const [originalMessageTextSql, cleanedMessageTextSql, filteredMessageTextSql] = keywordExpressions(messageTextSql, 'b.bot_username')

// This is included in the native update lease predicate. Keep it limited to
// reply types whose message delivery has a native implementation.
export const telegramKeyreplyClaimPredicate = actionsEnabled() ? `EXISTS (
  SELECT 1 FROM t_telegram_bot_keyreply kr
  CROSS JOIN LATERAL unnest(string_to_array(COALESCE(kr.monitor_word,''), ',')) AS keyword(value)
  WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (1,2,3,4,5,6,7,8,9,10,11)
    AND platform_plugin_config_effective('keyreply',kr.bot_rid,kr.rid,kr.monitor_word,kr.opt_type)
    AND btrim(keyword.value) IN (${originalMessageTextSql},${cleanedMessageTextSql},${filteredMessageTextSql})
)` : 'FALSE'

export async function telegramKeyreplyClaimable(pool: Database, botRid: number, update: Record<string, unknown>) {
  const message = update.message as { text?: unknown; caption?: unknown; chat?: { type?: unknown } } | undefined
  if (!actionsEnabled() || message?.chat?.type !== 'private') return false
  const [original, cleaned, filtered] = keywordExpressions('$2', 'b.bot_username')
  const result = await pool.query<{ claimable: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM t_telegram_bot_keyreply kr JOIN t_telegram_bot b ON b.rid=kr.bot_rid
    CROSS JOIN LATERAL unnest(string_to_array(COALESCE(kr.monitor_word,''), ',')) AS keyword(value)
    WHERE kr.bot_rid=$1 AND kr.status=0 AND kr.opt_type IN (1,2,3,4,5,6,7,8,9,10,11)
      AND platform_plugin_config_effective('keyreply',kr.bot_rid,kr.rid,kr.monitor_word,kr.opt_type)
      AND btrim(keyword.value) IN (${original},${cleaned},${filtered})
  ) AS claimable`, [botRid, String(message.text ?? message.caption ?? '')])
  return result.rows[0]?.claimable === true
}

export function normalizeTelegramKeyword(value: string) {
  return value
    .replace(/[\u200B-\u200D\uFEFF\u2060]/gu, '')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[\uFE00-\uFE0F\u2600-\u26FF\u2700-\u27BF\u2300-\u23FF\u2B50\u2728\u274C\u274E\u2705\u2747]/gu, '')
    .trim()
}

export function telegramKeywordReplyMatches(monitorWord: string, messageText: string, botUsername = '') {
  const original = Array.from(messageText).slice(0, 100).join('').trim().replace(`@${botUsername.replace(/^@/u, '')}`, '')
  const cleaned = original.replace(/['<>&\\]/gu, '')
  const filtered = normalizeTelegramKeyword(original)
  const candidates = new Set([original, cleaned, filtered].map((value) => value.trim()).filter(Boolean))
  return monitorWord.split(',').some((keyword) => {
    const candidate = keyword.trim()
    return candidate !== '' && candidates.has(candidate)
  })
}

export function telegramReplyKeyboard(items: KeyboardItem[] | Record<string, unknown>[]) {
  if (!items.length) return undefined
  const first = items[0] as Partial<KeyboardItem>
  const replyKeyboard = first.keyboard_type === 1
  const rows: Record<string, unknown>[][] = []
  const limit = replyKeyboard ? 3 : 2

  for (const rawItem of items) {
    const item = rawItem as Partial<KeyboardItem>
    const label = String(item.keyboard_name ?? '').trim()
    if (!label) continue
    const emojiId = String(item.keyboard_icon_custom_emoji_id ?? '').match(/(?:emoji-id=["']?)?(\d+)/iu)?.[1]
    let button: Record<string, unknown>
    if (replyKeyboard && item.keyboard_type === 1) {
      button = emojiId ? { text: label, icon_custom_emoji_id: emojiId } : { text: label }
    } else if (!replyKeyboard && item.keyboard_type === 2) {
      const value = String(item.keyboard_value ?? '')
      if (!value) continue
      button = { text: label, ...(emojiId ? { icon_custom_emoji_id: emojiId } : {}), ...(item.inline_type === 1 ? { url: value } : { callback_data: value }) }
    } else continue
    if (!rows.length || rows[rows.length - 1].length >= limit) rows.push([])
    rows[rows.length - 1].push(button)
  }

  if (!rows.length) return undefined
  return replyKeyboard ? { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } : { inline_keyboard: rows }
}

export function telegramReplyIdContent(message: TelegramMessage) {
  const from = message.from ?? {}
  const escape = (value: unknown) => htmlEscape(String(value ?? ''))
  let content = `<b>用户ID：</b><code>${escape(from.id)}</code>\n用户名：@${escape(from.username)}\n用户昵称：<code>${escape(`${from.first_name ?? ''}${from.last_name ?? ''}`)}</code>\n\n`
  if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
    content += `<b>群组ID：</b><code>${escape(message.chat.id)}</code>\n群组名：@${escape(message.chat.username)}\n群组昵称：<code>${escape(message.chat.title)}</code>\n群组类型：<code>${escape(message.chat.type)}</code>\n`
  }
  return content
}

export function telegramReplyIdKeyboard(message: TelegramMessage) {
  if (String(message.chat.id).startsWith('-')) return undefined
  return {
    keyboard: [
      [{ text: '查用户ID', request_users: { request_id: 1, user_is_bot: false } }, { text: '查群组ID', request_chat: { request_id: 2, chat_is_channel: false } }],
      [{ text: '查机器人ID', request_users: { request_id: 3, user_is_bot: true } }, { text: '查频道ID', request_chat: { request_id: 4, chat_is_channel: true } }],
      ['/start'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    selective: true,
  }
}

function normalizedReply(content: string) {
  return content
    .replace(/\\n/gu, '\n')
    .replace(/\r\n?/gu, '\n')
    .replace(/<strong\b([^>]*)>(.*?)<\/strong>/giu, '<b$1>$2</b>')
    .replace(/<em\b([^>]*)>(.*?)<\/em>/giu, '<i$1>$2</i>')
    .replace(/<ins\b([^>]*)>(.*?)<\/ins>/giu, '<u$1>$2</u>')
    .replace(/<strike\b([^>]*)>(.*?)<\/strike>/giu, '<s$1>$2</s>')
    .replace(/<del\b([^>]*)>(.*?)<\/del>/giu, '<s$1>$2</s>')
    .replace(/<span\s+class=["']tg-spoiler["']\s*>(.*?)<\/span>/giu, '<tg-spoiler>$1</tg-spoiler>')
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(2))) : ''
}

function decimalTimes(value: unknown, multiplier: bigint) {
  const match = String(value ?? '0').trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/u)
  if (!match) return ''
  const fraction = match[3] ?? ''
  const scale = 10n ** BigInt(fraction.length)
  const units = (BigInt(match[2]) * scale + BigInt(fraction || '0')) * multiplier
  const whole = units / scale
  const remainder = units % scale
  if (remainder === 0n) return `${match[1]}${whole}`
  const decimal = String(remainder).padStart(fraction.length, '0').replace(/0+$/u, '')
  return `${match[1]}${whole}.${decimal}`
}

function htmlEscape(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function telegramUsernameUrl(username: string | null) {
  const name = String(username ?? '').replace(/^@/u, '')
  return /^[A-Za-z0-9_]{5,32}$/u.test(name) ? `https://t.me/${name}` : null
}

async function queryOkxC2c(fetcher: typeof fetch, message: string) {
  const selection = message.trim().toLowerCase()
  const method = selection === 'z1' ? 'bank' : selection === 'z2' ? 'aliPay' : selection === 'z3' ? 'wxPay' : 'all'
  const queryName = method === 'bank' ? '银行卡' : method === 'aliPay' ? '支付宝' : method === 'wxPay' ? '微信' : '所有'
  const selected = selection === 'z1' ? 'z1' : selection === 'z2' ? 'z2' : selection === 'z3' ? 'z3' : 'z0'
  const url = new URL('https://www.okx.com/v3/c2c/tradingOrders/books')
  url.search = new URLSearchParams({
    t: String(Date.now()), quoteCurrency: 'cny', baseCurrency: 'usdt', side: 'sell',
    paymentMethod: method, userType: 'all', receivingAds: 'false',
  }).toString()
  let content = '查询结果：查询失败1'
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
    if (response.ok) {
      const result = await response.json() as { code?: unknown; data?: { sell?: Array<{ price?: unknown; nickName?: unknown; paymentMethods?: unknown }> } }
      if (String(result.code) === '0' && Array.isArray(result.data?.sell)) {
        const icons = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
        const rows = result.data.sell.slice(0, 10).map((item, index) => {
          const methods = Array.isArray(item.paymentMethods) ? item.paymentMethods : []
          const names = [
            ...(methods.includes('bank') ? ['银行卡'] : []),
            ...(methods.includes('aliPay') ? ['支付宝'] : []),
            ...(methods.includes('wxPay') ? ['微信'] : []),
          ]
          return `${icons[index]}  <code>${htmlEscape(String(item.price ?? ''))}  ${htmlEscape(String(item.nickName ?? ''))}</code>  🈶${names.join(' ')}`
        })
        const time = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).format(new Date()).replace('T', ' ')
        content = `<b>[Okex商家C2C实时top10 - ${queryName}]</b>\n<b>查询时间：<code>${time}</code></b>\n\n${rows.join('\n')}`
      } else content = '查询结果：查询失败2'
    }
  } catch {
    // Keep the legacy response shape and leave filters available on provider errors.
  }
  return {
    content,
    replyMarkup: { inline_keyboard: [[
      { text: `${selected === 'z0' ? '✅' : ''}所有`, callback_data: 'z0' },
      { text: `${selected === 'z1' ? '✅' : ''}银行卡`, callback_data: 'z1' },
      { text: `${selected === 'z2' ? '✅' : ''}支付宝`, callback_data: 'z2' },
      { text: `${selected === 'z3' ? '✅' : ''}微信`, callback_data: 'z3' },
    ]] },
  }
}

async function sendTelegram(fetcher: typeof fetch, token: string, method: 'sendMessage' | 'sendPhoto' | 'answerCallbackQuery', payload: Record<string, unknown>) {
  if (!actionsEnabled() || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(token)) return false
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
    const result = await response.json() as { ok?: boolean }
    return response.ok && result.ok === true
  } catch {
    return false
  }
}

export async function handleTelegramKeywordReply(options: {
  pool: Database
  fetcher: typeof fetch
  botRid: number
  message: TelegramMessage
  callbackData?: string
  callbackUsername?: string
  callbackId?: string
}) {
  const messageText = String(options.callbackData ?? options.message.text ?? options.message.caption ?? '').trim()
  if (!actionsEnabled() || !messageText) return false
  if (options.callbackData && !['z0', 'z1', 'z2', 'z3', 'energybishu', 'aitrusteeship'].includes(options.callbackData.toLowerCase())) return false
  const selected = await options.pool.query<Keyreply>(`SELECT kr.rid,b.bot_token,b.bot_username,b.bot_admin_username,kr.opt_type,kr.monitor_word,kr.reply_photo,kr.reply_content
    FROM t_telegram_bot_keyreply kr JOIN t_telegram_bot b ON b.rid=kr.bot_rid
    WHERE kr.bot_rid=$1 AND kr.status=0 AND kr.opt_type IN (1,2,3,4,5,6,7,8,9,10,11)
      AND platform_plugin_config_effective('keyreply',kr.bot_rid,kr.rid,kr.monitor_word,kr.opt_type) ORDER BY kr.rid`, [options.botRid])
  const callbackData = options.callbackData?.toLowerCase()
  const callbackOptType = callbackData === 'energybishu' ? 10 : callbackData === 'aitrusteeship' ? 11 : 9
  const reply = selected.rows.find((row) => options.callbackData ? row.opt_type === callbackOptType : telegramKeywordReplyMatches(row.monitor_word, messageText, row.bot_username ?? ''))
  if (!reply || (reply.opt_type !== 2 && reply.opt_type !== 9 && reply.opt_type !== 10 && reply.opt_type !== 11 && !reply.reply_content)) return false

  let content = reply.opt_type === 2 ? telegramReplyIdContent(options.message) : normalizedReply(reply.reply_content)
  if (/\$\{(?:trxusdtrate|trxusdtwallet|tgbotadmin|trxusdtshownotes|tgbotname|trx10usdtrate|trx100usdtrate|trx1000usdtrate)\}/u.test(content)) {
    const wallet = await options.pool.query<{ exchange_rate: string | number; receive_wallet: string; show_notes: string | null }>(`SELECT c.exchange_rate,w.receive_wallet,w.show_notes
      FROM t_transit_wallet_coin c JOIN t_transit_wallet w ON w.rid=c.transit_wallet_id
      WHERE w.bot_rid=$1 AND c.in_coin_name='usdt' AND c.out_coin_name='trx' ORDER BY w.rid LIMIT 1`, [options.botRid])
    const rate = Number(wallet.rows[0]?.exchange_rate ?? 0)
    const values: Record<string, string> = {
      trxusdtrate: wallet.rows[0] ? String(wallet.rows[0].exchange_rate) : '',
      trxusdtwallet: wallet.rows[0]?.receive_wallet ?? '',
      tgbotadmin: reply.bot_admin_username ?? '',
      trxusdtshownotes: wallet.rows[0]?.show_notes ?? '',
      tgbotname: reply.bot_username ? `@${reply.bot_username}` : '',
      trx10usdtrate: numeric(rate * 10),
      trx100usdtrate: numeric(rate * 100),
      trx1000usdtrate: numeric(rate * 1000),
    }
    content = content.replace(/\$\{([^}]+)\}/gu, (match, key: string) => key in values ? htmlEscape(values[key]) : match)
  }

  let dynamicReplyMarkup: Record<string, unknown> | undefined
  if (reply.opt_type === 9) {
    if (options.callbackId) await sendTelegram(options.fetcher, reply.bot_token, 'answerCallbackQuery', { callback_query_id: options.callbackId })
    const result = await queryOkxC2c(options.fetcher, messageText)
    content = `${options.callbackData ? `@${options.callbackUsername || '-'}\n` : ''}${result.content}`
    dynamicReplyMarkup = result.replyMarkup
  }
  if (reply.opt_type === 10 && options.callbackId) {
    await sendTelegram(options.fetcher, reply.bot_token, 'answerCallbackQuery', { callback_query_id: options.callbackId })
  }
  if (reply.opt_type === 11 && callbackData === 'aitrusteeship' && options.callbackId) {
    await sendTelegram(options.fetcher, reply.bot_token, 'answerCallbackQuery', { callback_query_id: options.callbackId })
  }
  if (reply.opt_type === 11) {
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    const botUrl = telegramUsernameUrl(reply.bot_username)
    const instructions = '1️⃣在机器人充值TRX,每笔能量消耗该TRX余额\n'
      + '2️⃣添加托管您的波场地址,地址一定要激活(转入TRX即可激活)\n'
      + '3️⃣默认自动代理65000能量,可以给有USDT的地址免费转账一笔\n'
      + '4️⃣可在我的托管地址中修改每笔代理能量数量和备注说明\n'
      + '5️⃣每笔能量代理时间为一天,到期回收'
    if (options.message.chat.type !== 'private') {
      content = '<b>能量智能托管说明</b>\n' + instructions + '\n🔥点击下方私聊机器人赶紧使用吧！🔥'
      const buttons = [
        ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
        ...(botUrl ? [{ text: '🤖私聊机器人', url: botUrl }] : []),
      ]
      if (buttons.length) dynamicReplyMarkup = { inline_keyboard: [buttons] }
    } else {
      const user = await options.pool.query<{ cash_trx: string | number; cash_usdt: string | number }>(
        'SELECT cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
        [options.botRid, String(options.message.chat.id)],
      )
      if (!user.rows[0]) {
        content = '用户信息为空，请发送 /start 初始化用户'
        if (contactUrl) dynamicReplyMarkup = { inline_keyboard: [[{ text: '👨联系客服', url: contactUrl }]] }
      } else {
        const platform = await options.pool.query<{ trx_price_energy_32000: string | number | null; trx_price_energy_65000: string | number | null }>(
          'SELECT trx_price_energy_32000::text,trx_price_energy_65000::text FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1',
          [options.botRid],
        )
        content = `<b>TRX余额为：</b><code>${htmlEscape(String(user.rows[0].cash_trx))} TRX</code>\n`
          + `<b>USDT余额为：</b><code>${htmlEscape(String(user.rows[0].cash_usdt))} USDT</code>\n\n`
          + '⚠️TRX余额不足时，不再执行智能托管，请及时充值\n'
          + '⚠️充值的USDT可点击下方转换为TRX\n\n'
          + instructions + '\n'
        const price = platform.rows[0]
        if (price?.trx_price_energy_32000 != null && price.trx_price_energy_65000 != null) {
          content += `<b>托管单价</b>：65000能量 <u>${htmlEscape(String(price.trx_price_energy_32000))} TRX</u>，131000能量 <u>${htmlEscape(String(price.trx_price_energy_65000))} TRX</u>\n`
        } else {
          content += '<b>机器人未设置智能托管价格，请联系客服</b>\n'
        }
        content += '<b>请保证余额充足,点击下方可充值余额！</b>'
        dynamicReplyMarkup = { inline_keyboard: [
          [
            { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
            { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
            { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
          ],
          [
            { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
            { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
          ],
          [{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }],
        ] }
      }
    }
  }
  if (reply.opt_type === 5) {
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    const botUrl = telegramUsernameUrl(reply.bot_username)
    if (options.message.chat.type !== 'private') {
      content = '<b>该功能命令只能私聊机器人执行！点击下方私聊机器人</b> ！'
      const buttons = [
        ...(botUrl ? [{ text: '🤖私聊机器人', url: botUrl }] : []),
        ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
      ]
      if (buttons.length) dynamicReplyMarkup = { inline_keyboard: [buttons] }
    } else {
      const user = await options.pool.query<{ cash_trx: string | number; cash_usdt: string | number }>(
        'SELECT cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
        [options.botRid, String(options.message.chat.id)],
      )
      if (!user.rows[0]) {
        content += '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管'
        if (contactUrl) dynamicReplyMarkup = { inline_keyboard: [[{ text: '👨联系客服', url: contactUrl }]] }
      } else {
        content += `\n\n<b>TRX余额为：</b><code>${htmlEscape(String(user.rows[0].cash_trx))} TRX</code>\n`
          + `<b>USDT余额为：</b><code>${htmlEscape(String(user.rows[0].cash_usdt))} USDT</code>\n\n`
          + '⚠️TRX余额不足时，不再执行智能托管，请及时充值\n'
          + '⚠️充值的USDT可点击下方转换为TRX\n\n'
          + '<b>请保证余额充足,点击下方可充值余额！</b>'
        dynamicReplyMarkup = { inline_keyboard: [
          [
            { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
            { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
            { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
          ],
          [
            { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
            { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
          ],
          [{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }],
        ] }
      }
    }
  }

  if (reply.opt_type === 6) {
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    if (options.message.chat.type !== 'private') {
      content = '监控钱包请私聊机器人！'
    } else {
      const user = await options.pool.query<{ cash_trx: string | number; cash_usdt: string | number; max_monitor_wallet: number }>(
        'SELECT cash_trx::text,cash_usdt::text,max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
        [options.botRid, String(options.message.chat.id)],
      )
      if (!user.rows[0]) {
        content = '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控'
        if (contactUrl) dynamicReplyMarkup = { inline_keyboard: [[{ text: '👨联系客服', url: contactUrl }]] }
      } else {
        const [quota, countResult] = await Promise.all([
          options.pool.query<{ free_limit: number }>('SELECT COALESCE(free_monitor_wallet,4)::int AS free_limit FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1', [options.botRid]),
          options.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [options.botRid, String(options.message.chat.id)]),
        ])
        const count = Number(countResult.rows[0]?.count ?? 0)
        const totalPages = Math.ceil(count / 10)
        const remaining = Math.max(0, Math.max(0, Number(user.rows[0].max_monitor_wallet) || 0) + Math.max(0, Number(quota.rows[0]?.free_limit ?? 4)) - count)
        const wallets = await options.pool.query<{ monitor_wallet: string }>(
          'SELECT monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 10 OFFSET 0',
          [options.botRid, String(options.message.chat.id)],
        )
        content += `\n\n<b>TRX余额为：</b><code>${htmlEscape(String(user.rows[0].cash_trx))} TRX</code>\n`
          + `<b>USDT余额为：</b><code>${htmlEscape(String(user.rows[0].cash_usdt))} USDT</code>\n\n`
          + `<b>剩余可监控数量：</b><code>${remaining}</code>\n`
          + '<b>可点击下方购买监控套餐！</b>\n'
          + `当前已监控地址：${count} 个\n`
          + wallets.rows.map((row) => `  <code>${htmlEscape(row.monitor_wallet)}</code>\n`).join('')
        const rows: Record<string, unknown>[][] = [
          [{ text: '➕添加监控地址', callback_data: 'monitorddaddress' }, { text: '➖删除监控地址', callback_data: 'monitordeleteaddress' }],
          [
            { text: '💎购买监控包', callback_data: 'monitorwalletbuy' },
            ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
          ],
        ]
        const paging: Record<string, unknown>[] = []
        if (totalPages >= 2) paging.push({ text: '➡️下一页', callback_data: 'monitorwallet_2' })
        paging.push({ text: '🛠修改备注', callback_data: 'monitorwalletupdate_1' }, { text: '🛠修改监控', callback_data: 'monitorwalletfunc_1' })
        rows.push(paging)
        dynamicReplyMarkup = { inline_keyboard: rows }
      }
    }
  }

  if (reply.opt_type === 7) {
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    const botUrl = telegramUsernameUrl(reply.bot_username)
    if (options.message.chat.type !== 'private') {
      content = '<b>该功能命令只能私聊机器人执行！点击下方私聊机器人</b> ！'
      const buttons = [
        ...(botUrl ? [{ text: '🤖私聊机器人', url: botUrl }] : []),
        ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
      ]
      if (buttons.length) dynamicReplyMarkup = { inline_keyboard: [buttons] }
    } else {
      const user = await options.pool.query<{ cash_trx: string | number; cash_usdt: string | number }>(
        'SELECT cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
        [options.botRid, String(options.message.chat.id)],
      )
      if (!user.rows[0]) {
        content += '用户信息为空，请发送 /start 初始化用户，然后再进行购买'
        if (contactUrl) dynamicReplyMarkup = { inline_keyboard: [[{ text: '👨联系客服', url: contactUrl }]] }
      } else {
        const goods = await options.pool.query<{ rid: number; goods_name: string }>(`SELECT b.rid,b.goods_name
          FROM t_shop_goods_bot a JOIN t_shop_goods b ON b.rid=a.goods_rid
          WHERE a.bot_rid=$1 AND a.status=0 AND b.status=0 ORDER BY b.seq_sn DESC`, [options.botRid])
        content += `\n\n<b>TRX余额为：</b><code>${htmlEscape(String(user.rows[0].cash_trx))} TRX</code>\n`
          + `<b>USDT余额为：</b><code>${htmlEscape(String(user.rows[0].cash_usdt))} USDT</code>\n\n`
        if (!goods.rows.length) content += '<b>当前机器人无商品可购买！</b>'
        const rows: Record<string, unknown>[][] = []
        for (let index = 0; index < goods.rows.length; index += 2) {
          rows.push(goods.rows.slice(index, index + 2).map((item) => ({ text: item.goods_name, callback_data: `buygoods${item.rid}_1` })))
        }
        rows.push([
          { text: '🔥我要充值', callback_data: 'aitrusteeshiprechargetrx' },
          ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
        ])
        dynamicReplyMarkup = { inline_keyboard: rows }
      }
    }
  }

  if (reply.opt_type === 8) {
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    const botUrl = telegramUsernameUrl(reply.bot_username)
    if (options.message.chat.type !== 'private') {
      content = '<b>该功能命令只能私聊机器人执行！点击下方私聊机器人</b> ！'
      const buttons = [
        ...(botUrl ? [{ text: '🤖私聊机器人', url: botUrl }] : []),
        ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
      ]
      if (buttons.length) dynamicReplyMarkup = { inline_keyboard: [buttons] }
    } else {
      const user = await options.pool.query<{ cash_trx: string | number; cash_usdt: string | number }>(
        'SELECT cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
        [options.botRid, String(options.message.chat.id)],
      )
      if (!user.rows[0]) {
        content += '用户信息为空，请发送 /start 初始化用户'
        if (contactUrl) dynamicReplyMarkup = { inline_keyboard: [[{ text: '👨联系客服', url: contactUrl }]] }
      } else {
        const from = options.message.from ?? {}
        content += `\n\n用户ID：<code>${htmlEscape(String(options.message.chat.id))}</code>\n`
          + `用户名：@${htmlEscape(String(from.username ?? ''))}\n`
          + `<b>TRX余额为：</b><code>${htmlEscape(String(user.rows[0].cash_trx))} TRX</code>\n`
          + `<b>USDT余额为：</b><code>${htmlEscape(String(user.rows[0].cash_usdt))} USDT</code>\n\n`
          + '⚠️充值的USDT可点击下方转换为TRX\n'
        dynamicReplyMarkup = { inline_keyboard: [[
          { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
          { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
          { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
        ]] }
      }
    }
  }

  if (reply.opt_type === 10) {
    const platform = await options.pool.query<{ per_bishu_usdt_price: string | number; receive_wallet: string | null }>(
      'SELECT per_bishu_usdt_price::text,receive_wallet FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1',
      [options.botRid],
    )
    const contactUrl = telegramUsernameUrl(reply.bot_admin_username)
    const botUrl = telegramUsernameUrl(reply.bot_username)
    if (!platform.rows[0]) {
      content = '还未配置笔数模式，请联系客服配置后再使用！'
    } else {
      const price = String(platform.rows[0].per_bishu_usdt_price)
      const baseContent = reply.reply_content === '--' ? '' : content
      content = `${baseContent}\n\n👉<b>每笔单价：${htmlEscape(price)} USDT</b>\n`
        + `✅<b>支付地址：<code>${htmlEscape(String(platform.rows[0].receive_wallet ?? ''))}</code></b>\n\n`
        + `👆<b>请点击地址复制，直接转入USDT，如转入 ${htmlEscape(decimalTimes(price, 100n))} USDT，可获得100次免费转账次数</b>\n`
        + '💰如已在机器人充值USDT，可发送指令：<u>添加笔数 Txx 10</u>，手工添加笔数，Txx为您的波场钱包地址，10为需要添加的笔数'
    }
    if (options.message.chat.type !== 'private') {
      const buttons = [
        ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
        ...(botUrl ? [{ text: '⏳剩余笔数', url: botUrl }] : []),
      ]
      if (buttons.length) dynamicReplyMarkup = { inline_keyboard: [buttons] }
    } else {
      dynamicReplyMarkup = { inline_keyboard: [
        [
          ...(contactUrl ? [{ text: '👨联系客服', url: contactUrl }] : []),
          { text: '⏳剩余笔数', callback_data: 'energybishusy' },
        ],
        [
          { text: '📣地址绑定通知', callback_data: 'energybishubind' },
          { text: '✏️已绑通知地址', callback_data: 'energybishusearch' },
        ],
        [{ text: '➕增加地址笔数', callback_data: 'energybishubalanceadd' }],
      ] }
    }
  }

  const keyboardResult = reply.opt_type === 2 || reply.opt_type === 5 || reply.opt_type === 6 || reply.opt_type === 7 || reply.opt_type === 8 || reply.opt_type === 9 || reply.opt_type === 10 || reply.opt_type === 11
    ? { rows: [] as KeyboardItem[] }
      : reply.opt_type === 3
      ? await options.pool.query<KeyboardItem>(`SELECT a.package_name AS keyboard_name,NULL::text AS keyboard_icon_custom_emoji_id,
          2 AS keyboard_type,2 AS inline_type,a.callback_data AS keyboard_value,a.seq_sn
        FROM t_energy_platform_bot b JOIN t_energy_platform_package a ON a.bot_rid=b.bot_rid
        WHERE b.bot_rid=$1 AND b.status=0 AND a.status=0 ORDER BY a.seq_sn DESC`, [options.botRid])
      : reply.opt_type === 4
        ? await options.pool.query<KeyboardItem>(`SELECT a.package_name AS keyboard_name,NULL::text AS keyboard_icon_custom_emoji_id,
            2 AS keyboard_type,2 AS inline_type,a.callback_data AS keyboard_value,a.seq_sn
          FROM t_premium_platform_package a JOIN t_premium_platform b ON b.rid=a.premium_platform_rid
          WHERE a.bot_rid=$1 AND a.status=0 AND b.status=0 ORDER BY a.seq_sn DESC`, [options.botRid])
      : await options.pool.query<KeyboardItem>(`SELECT k.keyboard_name,k.keyboard_icon_custom_emoji_id,k.keyboard_type,k.inline_type,k.keyboard_value,k.seq_sn
        FROM t_telegram_bot_keyreply_keyboard relation JOIN t_telegram_bot_keyboard k ON k.rid=relation.keyboard_rid
        WHERE relation.bot_rid=$1 AND relation.keyreply_rid=$2 AND k.status=0
        AND platform_plugin_config_effective('keyreply_keyboard',relation.bot_rid,relation.rid,NULL,NULL)
        AND platform_plugin_config_effective('keyboard',0,k.rid,k.keyboard_name,NULL) ORDER BY k.seq_sn DESC`, [options.botRid, reply.rid])
  const payload: Record<string, unknown> = {
    chat_id: String(options.message.chat.id),
    allow_sending_without_reply: true,
    parse_mode: 'HTML',
  }
  if (!options.callbackData && reply.opt_type !== 10 && reply.opt_type !== 11 && (![5, 6, 7, 8].includes(reply.opt_type) || options.message.chat.type !== 'private')) payload.reply_to_message_id = options.message.message_id
  let replyMarkup: unknown = dynamicReplyMarkup ?? (reply.opt_type === 2 ? telegramReplyIdKeyboard(options.message) : telegramReplyKeyboard(keyboardResult.rows))
  if (options.message.chat.type === 'private') {
    replyMarkup = await appendCloneProxyButton(options.pool, options.botRid, options.message.chat.type, replyMarkup)
  }
  if (replyMarkup) payload.reply_markup = replyMarkup

  const photo = reply.opt_type === 2 || reply.opt_type === 10 || ([5, 6, 7, 8].includes(reply.opt_type) && options.message.chat.type !== 'private') ? null : reply.reply_photo
  const method = photo ? 'sendPhoto' : 'sendMessage'
  if (photo) {
    payload.photo = photo
    payload.caption = content
  } else payload.text = content
  if (!await sendTelegram(options.fetcher, reply.bot_token, method, payload)) throw new Error('telegram_keyword_reply_delivery_failed')
  return true
}
