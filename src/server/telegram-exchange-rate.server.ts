import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type Message = {
  message_id?: number | string
  text?: string
  chat?: { id?: number | string; type?: string }
  from?: { id?: number | string; is_bot?: boolean }
}
type Update = { message?: Message; edited_message?: Message; [key: string]: unknown }

export const telegramExchangeRateClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,chat,id}'=u.update_body #>> '{message,from,id}'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~* '^[0-9]*[[:space:]]*(usdt|u)$'",
].join('\n')

export function telegramExchangeRateCommand(update: Update, options: { allowGroups?: boolean } = {}) {
  const message = update.message ?? update.edited_message
  const text = String(message?.text ?? '').trim()
  const isGroup = message?.chat?.type === 'group' || message?.chat?.type === 'supergroup'
  if (!message || (options.allowGroups ? !isGroup : message.chat?.type !== 'private') || message.from?.is_bot === true) return null
  if (!options.allowGroups && String(message.chat?.id ?? '') !== String(message.from?.id ?? '')) return null
  const match = /^([0-9]*)\s*(usdt|u)$/i.exec(text)
  if (!match) return null
  return { message, amount: match[1] || '1' }
}

function formatRate(amount: string, rate: string) {
  if (!/^\d{1,4096}$/.test(amount) || !/^\d+(?:\.\d{1,2})?$/.test(rate)) return null
  const [whole, fraction = ''] = rate.split('.')
  const rateCents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  const cents = BigInt(amount) * rateCents
  const decimal = (cents % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return decimal ? `${cents / 100n}.${decimal}` : String(cents / 100n)
}
const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export type TelegramExchangeRateResult =
  | { kind: 'not-command' }
  | { kind: 'replied'; text: string; configured: boolean }

export async function handleTelegramExchangeRate(options: {
  pool: Database
  botRid: number
  update: Update
  sendMessage: (message: Message, text: string) => Promise<boolean>
  allowGroups?: boolean
}): Promise<TelegramExchangeRateResult> {
  const command = telegramExchangeRateCommand(options.update, { allowGroups: options.allowGroups })
  if (!command) return { kind: 'not-command' }
  const { message, amount } = command
  const wallet = await options.pool.query<{ exchange_rate: string; receive_wallet: string }>(
    `SELECT a.exchange_rate::text AS exchange_rate,b.receive_wallet
     FROM t_transit_wallet_coin a
     JOIN t_transit_wallet b ON a.transit_wallet_id=b.rid
     WHERE b.bot_rid=$1 AND a.in_coin_name='usdt' AND a.out_coin_name='trx' AND b.status=0
     LIMIT 1`,
    [options.botRid],
  )
  const row = wallet.rows[0]
  const converted = row && formatRate(amount, row.exchange_rate)
  const configured = Boolean(row && converted !== null)
  const text = configured
    ? `💹实时汇率: <b>${amount} USDT = ${converted} TRX</b>\n\n官方USDT-TRC20自动兑换地址（点击地址复制）\n<code>${html(row.receive_wallet)}</code>`
    : '请先配置机器人闪兑钱包并开启，设置汇率！！'
  if (!await options.sendMessage(message, text)) throw new Error('telegram_exchange_rate_reply_failed')
  return { kind: 'replied', text, configured }
}
