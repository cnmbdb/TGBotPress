import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error' | 'info'>
type Ad = {
  rid: number; bot_rid: number; bot_token: string; bot_username: string | null; bot_admin_username: string | null
  notice_cycle: number; notice_obj: string; notice_ad: string; notice_photo: string | null; last_notice_time: Date | string | null
}
type Keyboard = {
  keyboard_name: string; keyboard_icon_custom_emoji_id: string | null; keyboard_type: number
  inline_type: number; keyboard_value: string
}
type RateConfig = { exchange_rate: string | number; receive_wallet: string; show_notes: string | null }
type User = { tg_uid: string | number }
const cycleSeconds: Record<number, number> = {
  1: 60, 2: 600, 3: 1800, 4: 3600, 5: 86400, 6: 10800, 7: 21600, 8: 43200,
  9: 172800, 10: 432000, 11: 864000, 12: 1296000, 13: 1728000, 14: 2592000,
  15: 5184000, 16: 7776000, 17: 15552000,
}
export function timingAdCycleMs(cycle: number) {
  return cycleSeconds[cycle] ? cycleSeconds[cycle] * 1000 : null
}
export function timingAdIsDue(cycle: number, lastNotice: Date | string | null, now: number) {
  const interval = timingAdCycleMs(cycle)
  if (!interval) return false
  const last = lastNotice == null ? 0 : new Date(lastNotice).getTime()
  return Number.isFinite(last) && last + interval <= now
}
function normalizeEmojiId(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/emoji-id=["']?([0-9]+)["']?/i)
  return (match?.[1] ?? raw.replace(/\D+/g, '')) || null
}
function replyButton(keyboard: Keyboard) {
  const icon = normalizeEmojiId(keyboard.keyboard_icon_custom_emoji_id)
  return icon ? { text: keyboard.keyboard_name, icon_custom_emoji_id: icon } : keyboard.keyboard_name
}
function inlineButton(keyboard: Keyboard) {
  const button: Record<string, string> = { text: keyboard.keyboard_name }
  const icon = normalizeEmojiId(keyboard.keyboard_icon_custom_emoji_id)
  if (icon) button.icon_custom_emoji_id = icon
  if (Number(keyboard.inline_type) === 1) button.url = keyboard.keyboard_value
  else button.callback_data = keyboard.keyboard_value
  return button
}
export function buildTimingAdKeyboard(rows: Keyboard[]) {
  if (!rows.length) return undefined
  const type = Number(rows[0].keyboard_type)
  if (rows.some(row => Number(row.keyboard_type) !== type)) throw new Error('TIMING_AD_KEYBOARD_TYPE_MISMATCH')
  if (type === 1) {
    const buttons = rows.map(replyButton), keyboard: unknown[][] = []
    for (let i = 0; i < buttons.length; i += 3) keyboard.push(buttons.slice(i, i + 3))
    return { keyboard, resize_keyboard: true, one_time_keyboard: false }
  }
  if (type === 2) {
    const keyboard: Record<string, string>[][] = []
    for (let i = 0; i < rows.length; i += 2) keyboard.push(rows.slice(i, i + 2).map(inlineButton))
    return { inline_keyboard: keyboard }
  }
  throw new Error('TIMING_AD_KEYBOARD_TYPE_INVALID')
}
export function expandTimingAdTemplate(template: string, config: RateConfig | null, botName: string | null, adminName: string | null) {
  if (!config) return template
  const rate = Number(config.exchange_rate)
  if (!Number.isFinite(rate)) return template
  const replacements: Record<string, string> = {
    trxusdtrate: String(config.exchange_rate), trxusdtwallet: config.receive_wallet,
    tgbotadmin: String(adminName ?? ''), trxusdtshownotes: String(config.show_notes ?? ''),
    tgbotname: '@' + String(botName ?? ''),
    trx10usdtrate: String(Number((rate * 10).toFixed(2))),
    trx100usdtrate: String(Number((rate * 100).toFixed(2))),
    trx1000usdtrate: String(Number((rate * 1000).toFixed(2))),
  }
  return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => Object.prototype.hasOwnProperty.call(replacements, name) ? replacements[name] : match)
}
function adIsDue(ad: Pick<Ad, 'notice_cycle' | 'last_notice_time'>, now: number) {
  return timingAdIsDue(Number(ad.notice_cycle), ad.last_notice_time, now)
}
async function listAds(pool: Database, after: number) {
  return (await pool.query<Ad>(
    'SELECT a.rid,a.bot_rid,a.notice_cycle,a.notice_obj,a.notice_photo,a.notice_ad,a.last_notice_time,' +
    'b.bot_token,b.bot_username,b.bot_admin_username FROM t_telegram_bot_ad a JOIN t_telegram_bot b ON a.bot_rid=b.rid ' +
    'WHERE a.status=0 AND a.rid>$1 ORDER BY a.rid LIMIT 100', [after],
  )).rows
}
async function claimAd(pool: Database, ad: Ad, now: number, shouldContinue: () => boolean) {
  if (!shouldContinue()) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ notice_cycle: number; last_notice_time: Date | string | null }>(
      'SELECT notice_cycle,last_notice_time FROM t_telegram_bot_ad WHERE rid=$1 AND status=0 FOR UPDATE', [ad.rid],
    )
    if (!current.rowCount || !adIsDue(current.rows[0], now) || !shouldContinue()) {
      await client.query('ROLLBACK'); return false
    }
    const update = await client.query('UPDATE t_telegram_bot_ad SET last_notice_time=now() WHERE rid=$1 AND status=0 RETURNING rid', [ad.rid])
    if (!update.rowCount || !shouldContinue()) { await client.query('ROLLBACK'); return false }
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
async function readKeyboard(pool: Database, ad: Ad) {
  return (await pool.query<Keyboard>(
    'SELECT b.keyboard_name,b.keyboard_icon_custom_emoji_id,b.keyboard_type,b.inline_type,b.keyboard_value ' +
    'FROM t_telegram_bot_ad_keyboard a JOIN t_telegram_bot_keyboard b ON a.keyboard_rid=b.rid ' +
    'WHERE a.bot_rid=$1 AND a.ad_rid=$2 AND b.status=0 ORDER BY b.seq_sn DESC', [ad.bot_rid, ad.rid],
  )).rows
}
async function readRateConfig(pool: Database, botRid: number) {
  return (await pool.query<RateConfig>(
    "SELECT a.exchange_rate::text AS exchange_rate,b.receive_wallet,b.show_notes FROM t_transit_wallet_coin a " +
    "JOIN t_transit_wallet b ON a.transit_wallet_id=b.rid WHERE b.bot_rid=$1 AND a.in_coin_name='usdt' " +
    "AND a.out_coin_name='trx' ORDER BY a.rid DESC LIMIT 1", [botRid],
  )).rows[0] ?? null
}
async function recipients(pool: Database, ad: Ad, shouldContinue: () => boolean) {
  const ids = String(ad.notice_obj ?? '').split(',').map(value => value.trim()).filter(Boolean)
  const all = ids.includes('888'), direct = ids.filter(value => value !== '888')
  if (all && shouldContinue()) {
    const users = await pool.query<User>('SELECT tg_uid FROM t_telegram_bot_user WHERE bot_rid=$1 AND status=1 ORDER BY rid', [ad.bot_rid])
    direct.push(...users.rows.map(row => String(row.tg_uid)))
  }
  return [...new Set(direct)]
}
async function sendAd(ad: Ad, recipientsList: string[], text: string, photo: string | null, markup: unknown, fetcher: typeof fetch, shouldContinue: () => boolean) {
  let sent = 0, failed = 0
  const method = photo ? 'sendPhoto' : 'sendMessage'
  for (const chatId of recipientsList) {
    if (!shouldContinue()) break
    const payload: Record<string, unknown> = { chat_id: chatId, parse_mode: 'HTML' }
    if (photo) { payload.photo = photo; payload.caption = text } else payload.text = text
    if (markup) payload.reply_markup = markup
    try {
      const response = await fetcher('https://api.telegram.org/bot' + ad.bot_token + '/' + method, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        redirect: 'error', signal: AbortSignal.timeout(12_000),
      })
      const result = await response.json().catch(() => null) as { ok?: boolean } | null
      if (response.ok && result?.ok === true) sent++
      else failed++
    } catch { failed++ }
  }
  return { sent, failed }
}
export async function sendTimingTelegramAds(options: {
  pool?: Database; fetcher?: typeof fetch; logger?: Logger; now?: () => number; shouldContinue?: () => boolean
} = {}) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return { skipped: true, scanned: 0, claimed: 0, sent: 0, failed: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const now = options.now ?? Date.now, shouldContinue = options.shouldContinue ?? (() => true)
  let after = 0, scanned = 0, claimed = 0, sent = 0, failed = 0
  while (shouldContinue()) {
    const ads = await listAds(pool, after)
    if (!ads.length) break
    for (const ad of ads) {
      if (!shouldContinue()) break
      after = ad.rid; scanned++
      if (!adIsDue(ad, now())) continue
      try {
        if (!await claimAd(pool, ad, now(), shouldContinue)) continue
        claimed++
        const keyboardRows = await readKeyboard(pool, ad)
        let keyboard: unknown
        try { keyboard = buildTimingAdKeyboard(keyboardRows) }
        catch { logger.error('sendtimingtgmessage has invalid keyboard configuration for ad ' + ad.rid); failed++; continue }
        const needsTemplate = /\$\{(?:trxusdtrate|trxusdtwallet|tgbotadmin|trxusdtshownotes|tgbotname|trx10usdtrate|trx100usdtrate|trx1000usdtrate)\}/.test(ad.notice_ad)
        const config = needsTemplate ? await readRateConfig(pool, ad.bot_rid) : null
        const text = expandTimingAdTemplate(ad.notice_ad, config, ad.bot_username, ad.bot_admin_username)
        const list = await recipients(pool, ad, shouldContinue)
        const result = await sendAd(ad, list, text, ad.notice_photo, keyboard, fetcher, shouldContinue)
        sent += result.sent; failed += result.failed
      } catch { logger.error('sendtimingtgmessage failed for ad ' + ad.rid); failed++ }
    }
    if (ads.length < 100) break
  }
  return { skipped: false, scanned, claimed, sent, failed }
}

