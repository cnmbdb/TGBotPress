import { constants, createPrivateKey, privateDecrypt, createHash, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Pool } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query'>
type Logger = Pick<Console, 'info' | 'error'>
type Platform = {
  rid: number; platform_name: number; platform_uid: string | null; platform_apikey: string | null
  platform_balance: string | number; alert_platform_balance: string | number; last_alert_time: Date | string | null
  tg_notice_obj: string | null; bot_token: string | null; comments: string | null
}
type PlatformName = 1 | 2 | 3 | 4 | 5 | 6 | 7
type Json = Record<string, any>
const timeout = 6000

function privateKey(): KeyObject {
  const path = process.env.TRON_RSA_PRIVATE_KEY_PATH
  const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim()
  if (!raw) throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE')
  return createPrivateKey(raw)
}
function decryptApiKey(ciphertext: string): string {
  const key = privateKey(), bytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8
  if (!bytes || bytes < 256 || bytes % 1 !== 0) throw new Error('RSA_KEY_INVALID')
  const versioned = ciphertext.startsWith('v2:')
  const encoded = (versioned ? ciphertext.slice(3) : ciphertext).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('RSA_CIPHERTEXT_INVALID')
  const encrypted = Buffer.from(encoded, 'base64')
  if (!encrypted.length || encrypted.length % bytes !== 0) throw new Error('RSA_CIPHERTEXT_INVALID')
  const parts: Buffer[] = []
  for (let offset = 0; offset < encrypted.length; offset += bytes) {
    parts.push(privateDecrypt(versioned
      ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
      : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)))
  }
  return Buffer.concat(parts).toString('utf8')
}
function objectValue(value: unknown): Json | null {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return null } }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}
function numeric(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : null
}
function balanceFrom(payload: unknown, name: PlatformName): number | null {
  const body = objectValue(payload)
  if (name === 2) return numeric(typeof payload === 'string' ? payload : payload)
  if (!body) return null
  if (name === 1 && Number(body.status) === 200) return numeric(objectValue(body.data)?.balance)
  if (name === 3) {
    const limit = numeric(body.EnergyLimit), used = numeric(body.EnergyUsed ?? 0)
    return limit === null || used === null ? null : Math.max(0, limit - used)
  }
  if (name === 4 && Number(body.code) === 10000) return numeric(objectValue(body.data)?.balance)
  if (name === 5 && Number(body.code) === 200) return numeric(objectValue(body.data)?.trx_balance)
  if (name === 6 && Number(body.code) === 1) return numeric(objectValue(body.data)?.balance)
  if (name === 7) {
    if (body.error) return null
    for (const field of ['当前余额(TRX)', '当前余额 (TRX)', '余额', 'balance', 'trx_balance']) {
      if (Object.prototype.hasOwnProperty.call(body, field)) return numeric(body[field])
    }
  }
  return null
}
async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok || !text.trim()) return null
  try { return JSON.parse(text) } catch { return text }
}
function safeUrl(raw: string): URL {
  const url = new URL(raw), host = url.hostname.toLowerCase()
  if (!(url.protocol === 'https:' || url.protocol === 'http:') || url.username || url.password || url.hash || host === 'localhost' ||
      host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
      host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) {
    throw new Error('UNSAFE_PROVIDER_URL')
  }
  return url
}
function requestOptions(body?: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    ...(body === undefined && Object.keys(headers).length ? { headers } : {}),
    redirect: 'error', signal: AbortSignal.timeout(timeout),
  }
}
async function providerBalance(row: Platform, options: { fetcher: typeof fetch; now: () => number; tronGridKeys: string[] }) {
  const name = Number(row.platform_name) as PlatformName, uid = String(row.platform_uid ?? '')
  const request = async (url: string, init?: RequestInit) =>
    responsePayload(await options.fetcher(url, init ?? requestOptions()))
  let payload: unknown
  if (name === 1) {
    if (!row.platform_apikey) return null
    const secret = decryptApiKey(row.platform_apikey), time = String(Math.floor(options.now() / 1000))
    const sign = createHash('md5').update(secret + 'time' + time + 'uid' + uid).digest('hex')
    payload = await request('https://api.tronqq.com/openapi/v1/user/balance', requestOptions({ time: Number(time), uid, sign }))
  } else if (name === 2) {
    if (!row.platform_apikey) return null
    payload = await request('https://api.wallet.buzz/?api=getBalance&apikey=' + encodeURIComponent(decryptApiKey(row.platform_apikey)))
  } else if (name === 3) {
    if (uid.length !== 34 || !options.tronGridKeys.length) return null
    const key = options.tronGridKeys[Math.floor(Math.random() * options.tronGridKeys.length)]
    payload = await request('https://api.trongrid.io/wallet/getaccountresource', requestOptions({ address: uid, visible: true }, { 'TRON-PRO-API-KEY': key }))
  } else if (name === 4) {
    payload = await request('https://trongas.io/api/userInfo', requestOptions({ username: uid }))
  } else if (name === 5) {
    if (!process.env.THIRD_URL) return null
    const url = safeUrl(process.env.THIRD_URL)
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/thirdpart/balance'
    url.searchParams.set('tg_uid', uid)
    payload = await request(url.toString())
  } else if (name === 6) {
    if (!row.platform_apikey) return null
    payload = await request('https://admin.weidubot.cc/api/trc_api/user_info', requestOptions({ token: decryptApiKey(row.platform_apikey) }))
  } else if (name === 7) {
    if (!uid || !row.platform_apikey) return null
    const base = process.env.NL_API_BASE_URL || String(row.comments ?? '').match(/nl_api_url=([^\s]+)/i)?.[1] || 'https://tgnl-home.hfz.pw'
    const url = safeUrl(base)
    url.pathname = url.pathname.replace(/\/$/, '') + '/v1/get_api_user_info'
    url.searchParams.set('username', uid)
    url.searchParams.set('password', decryptApiKey(row.platform_apikey))
    payload = await request(url.toString())
  } else return null
  return balanceFrom(payload, name)
}
function formatBalance(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\\.$/, '')
}
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
const providerLabels: Record<PlatformName, string> = {
  1: 'neee.cc', 2: 'RentEnergysBot', 3: '自己质押代理', 4: 'trongas.io', 5: '机器人开发者代理', 6: '搜狐', 7: 'NL-API',
}
function noticeText(row: Platform, balance: number) {
  const name = Number(row.platform_name) as PlatformName
  const action = name === 3 ? '能量不足，请立即质押！' : name === 5 ? '余额不足，请立即联系客服充值！' : name === 7 ? '余额不足，请立即前往能量池系统充值！' : '余额不足，请立即前往平台充值！'
  const uidLabel = name === 3 ? '质押钱包地址' : name === 7 ? 'API用户名' : '平台用户UID'
  const lines = [
    '能量平台(' + providerLabels[name] + ')，' + action,
    '能量平台ID：' + row.rid, uidLabel + '：' + String(row.platform_uid ?? ''),
    (name === 3 ? '当前能量剩余：' : '当前余额：') + formatBalance(balance) + (name === 7 ? ' TRX' : ''),
    (name === 3 ? '告警能量值：' : '告警金额：') + String(row.alert_platform_balance) + (name === 7 ? ' TRX' : ''),
    '', '不处理会一直告警通知！间隔10分钟告警一次',
  ]
  return escapeHtml(lines.join('\n'))
}
async function sendNotices(row: Platform, balance: number, fetcher: typeof fetch) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !row.bot_token || !row.tg_notice_obj) return 0
  let sent = 0
  for (const chatId of row.tg_notice_obj.split(',').map(value => value.trim()).filter(Boolean)) {
    const response = await fetcher('https://api.telegram.org/bot' + row.bot_token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: noticeText(row, balance), parse_mode: 'HTML' }),
      redirect: 'error', signal: AbortSignal.timeout(12_000),
    })
    const result = objectValue(await responsePayload(response))
    if (response.ok && result?.ok === true) sent++
  }
  return sent
}
async function loadTronGridKeys(pool: Database) {
  let keys: string[] = []
  try {
    const result = await pool.query<{ config_val: unknown }>("SELECT config_val FROM t_sys_config WHERE config_key='trongrid_api_keys' ORDER BY rid")
    keys = result.rows.flatMap(row => {
      let value = row.config_val
      if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return [] } }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const raw = (value as Json).keys
      return (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map(String).map(item => item.trim()).filter(Boolean)
    })
  } catch { /* optional config rows can be absent on older installs */ }
  return keys.length ? keys : String(process.env.TRONGRID_API_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean)
}
async function persistBalance(pool: Database, row: Platform, balance: number, now: () => number) {
  const threshold = numeric(row.alert_platform_balance) ?? 0
  const lastAlert = row.last_alert_time ? new Date(row.last_alert_time).getTime() : 0
  const shouldAlert = threshold > 0 && balance <= threshold && (!lastAlert || now() - lastAlert >= 600_000)
  const result = await pool.query(
    'UPDATE t_energy_platform SET platform_balance=$2,last_alert_time=CASE WHEN $3 THEN now() ELSE last_alert_time END,update_time=now() WHERE rid=$1 AND status=0',
    [row.rid, balance, shouldAlert],
  )
  return { changed: (result.rowCount ?? 0) > 0, shouldAlert }
}
export async function refreshEnergyPlatformBalances(options: {
  pool?: Database; fetcher?: typeof fetch; logger?: Logger; now?: () => number; shouldContinue?: () => boolean
} = {}) {
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const now = options.now ?? Date.now, shouldContinue = options.shouldContinue ?? (() => true)
  const tronGridKeys = await loadTronGridKeys(pool)
  const rows = await pool.query<Platform>(
    'SELECT p.rid,p.platform_name,p.platform_uid,p.platform_apikey,p.platform_balance::text AS platform_balance,' +
    'p.alert_platform_balance::text AS alert_platform_balance,p.last_alert_time,p.tg_notice_obj,b.bot_token,p.comments ' +
    'FROM t_energy_platform p LEFT JOIN t_telegram_bot b ON b.rid=p.tg_notice_bot_rid WHERE p.status=0 ORDER BY p.rid',
  )
  let scanned = 0, updated = 0, alertsDue = 0, notified = 0, failed = 0
  for (const row of rows.rows) {
    if (!shouldContinue()) break
    scanned++
    let balance: number | null
    try { balance = await providerBalance(row, { fetcher, now, tronGridKeys }) }
    catch { logger.error('getenergyplatformbalance provider request failed for platform ' + row.rid); failed++; continue }
    if (balance === null) { logger.error('getenergyplatformbalance returned no valid balance for platform ' + row.rid); failed++; continue }
    try {
      const saved = await persistBalance(pool, row, balance, now)
      if (!saved.changed) continue
      updated++
      if (saved.shouldAlert) {
        alertsDue++
        try { notified += await sendNotices(row, balance, fetcher) }
        catch { logger.error('getenergyplatformbalance notice failed for platform ' + row.rid) }
      }
    } catch { logger.error('getenergyplatformbalance could not save platform ' + row.rid); failed++ }
  }
  return { scanned, updated, alertsDue, notified, failed }
}

