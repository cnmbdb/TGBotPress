import { execFile } from 'node:child_process'
import { constants, createPrivateKey, privateDecrypt, type KeyObject } from 'node:crypto'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'

const execFileAsync = promisify(execFile)
type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'info' | 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; runPayment?: typeof runTonPayment; preflight?: (mnemonic: string) => Promise<boolean> }
type Trade = { rid: number; transferfrom_address: string; transferto_address: string; amount: string; platform_order_rid: number | null }
type DueOrder = { rid: number; bot_rid: number; premium_platform_rid: number; recipient: string; premium_package_month: number }
type Platform = { rid: number; platform_hash: string | null; platform_cookie: string | null; platform_phrase: string | null }
type FragmentTransaction = { payload?: unknown; amount?: unknown }
type FragmentResponse = { ok?: unknown; req_id?: unknown; error?: unknown; transaction?: { messages?: FragmentTransaction[] } }
const H = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36', Referer: 'https://fragment.com/' }

function rsaPrivateKey(): KeyObject {
  const path = process.env.TRON_RSA_PRIVATE_KEY_PATH
  const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim()
  if (!raw) throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE')
  return createPrivateKey(raw)
}
function decryptSecret(value: string | null): string {
  if (!value) return ''
  const versioned = value.startsWith('v2:'), encoded = (versioned ? value.slice(3) : value).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('RSA_CIPHERTEXT_INVALID')
  const encrypted = Buffer.from(encoded, 'base64'), key = rsaPrivateKey(), bytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8
  if (!bytes || bytes < 256 || bytes % 1 || !encrypted.length || encrypted.length % bytes) throw new Error('RSA_CIPHERTEXT_INVALID')
  const parts: Buffer[] = []
  for (let offset = 0; offset < encrypted.length; offset += bytes) parts.push(privateDecrypt(versioned
    ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
    : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)))
  return Buffer.concat(parts).toString('utf8')
}
async function fragmentRequest(fetcher: typeof fetch, hash: string, cookie: string, params: Record<string, string | number>): Promise<FragmentResponse> {
  const url = new URL('https://fragment.com/api')
  for (const [key, value] of Object.entries({ hash, ...params })) url.searchParams.set(key, String(value))
  const response = await fetcher(url, { headers: { ...H, Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`FRAGMENT_HTTP_${response.status}`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('FRAGMENT_INVALID_RESPONSE')
  return body as FragmentResponse
}
async function runTonPayment(amount: string, ref: string, months: number, mnemonic: string) {
  const binary = process.env.PLATFORM_TON_PAYMENT_BINARY || '/usr/local/bin/ton-payment'
  const env = { ...process.env, WalletMnemonic: mnemonic, TON_API_GATEWAY: process.env.TON_API_GATEWAY || 'https://tonapi.txsw.top', TON_API_GATEWAY_TOKEN: process.env.TON_API_GATEWAY_TOKEN || '' }
  const result = await execFileAsync(binary, [amount, ref, String(months), 'premium'], { env, timeout: 180_000, maxBuffer: 64 * 1024 })
  const output = `${result.stdout}\n${result.stderr}`
  const hash = /交易hash:\s*([^\s]+)/u.exec(output)?.[1]
  if (!output.includes('交易成功') || !hash) throw new Error('TON_RESULT_UNCONFIRMED')
  return hash
}
function refFromPayload(payload: string): string {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('utf8')
  const ref = /#([A-Za-z0-9]{9})/.exec(decoded)?.[1]
  if (!ref) throw new Error('FRAGMENT_PAYMENT_REF_MISSING')
  return ref
}
async function matchTrade(pool: Database, rid: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<Trade>(
      "SELECT t.rid,t.transferfrom_address,t.transferto_address,t.amount::text,t.platform_order_rid FROM t_premium_wallet_trade_list t WHERE t.rid=$1 AND t.process_status=1 AND t.coin_name='usdt' FOR UPDATE SKIP LOCKED", [rid])
    const trade = locked.rows[0]
    if (!trade) { await client.query('ROLLBACK'); return 'skipped' }
    const platformResult = await client.query<{ rid: number }>("SELECT rid FROM t_premium_platform WHERE receive_wallet=$1 ORDER BY rid LIMIT 1", [trade.transferto_address])
    const platformRid = platformResult.rows[0]?.rid
    if (!platformRid) { await client.query('ROLLBACK'); return 'skipped' }
    let order
    if (trade.platform_order_rid) order = await client.query("SELECT rid,status FROM t_premium_platform_order WHERE rid=$1 AND premium_platform_rid=$2 AND status IN (0,1) FOR UPDATE SKIP LOCKED", [trade.platform_order_rid, platformRid])
    else order = await client.query("SELECT rid,status FROM t_premium_platform_order WHERE premium_platform_rid=$1 AND need_pay_usdt=$2::numeric AND status=0 ORDER BY rid LIMIT 1 FOR UPDATE SKIP LOCKED", [platformRid, trade.amount])
    const match = order.rows[0]
    if (!match) {
      await client.query("UPDATE t_premium_wallet_trade_list SET process_status=7,process_comments='金额无对应订单',process_time=now(),premium_platform_rid=$2 WHERE rid=$1", [rid, platformRid])
      await client.query('COMMIT'); return 'unmatched'
    }
    if (Number(match.status) === 0) await client.query("UPDATE t_premium_platform_order SET status=1,update_time=now() WHERE rid=$1 AND status=0", [match.rid])
    await client.query("UPDATE t_premium_wallet_trade_list SET process_status=9,process_comments='SUCCESS',process_time=now(),premium_platform_rid=$2,platform_order_rid=$3 WHERE rid=$1", [rid, platformRid, match.rid])
    await client.query('COMMIT'); return 'matched'
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function completeOrder(pool: Database, rid: number, txHash: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const payment = await client.query("UPDATE t_platform_premium_payment SET state='succeeded',tx_hash=$2,updated_at=now() WHERE order_rid=$1 AND state='submitting' RETURNING order_rid", [rid, txHash])
    if (payment.rowCount !== 1) throw new Error('PREMIUM_PAYMENT_LEDGER_STATE_CHANGED')
    const order = await client.query("UPDATE t_premium_platform_order SET status=2,comments='开通成功',complete_time=now(),update_time=now(),tg_notice_user='Y',tg_notice_admin='Y',tx_hash=$2 WHERE rid=$1 AND status=6 RETURNING rid", [rid, txHash])
    if (order.rowCount !== 1) throw new Error('PREMIUM_ORDER_STATE_CHANGED')
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function failOrder(pool: Database, rid: number, message: string, manual: boolean) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("UPDATE t_premium_platform_order SET comments=$2,status=5,update_time=now(),tg_notice_admin='Y' WHERE rid=$1 AND status IN (1,6)", [rid, message.slice(0, 240)])
    if (manual) await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code='TON_RESULT_UNCONFIRMED',updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')", [rid])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function fulfillOrder(pool: Database, order: DueOrder, fetcher: typeof fetch, pay: NonNullable<Options['runPayment']>, shouldContinue: () => boolean, logger: Logger, preflight: (mnemonic: string) => Promise<boolean>) {
  const client = await pool.connect()
  let platform: Platform | undefined
  try {
    await client.query('BEGIN')
    const locked = await client.query<DueOrder>('SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month FROM t_premium_platform_order WHERE rid=$1 AND status=1 FOR UPDATE SKIP LOCKED', [order.rid])
    if (!locked.rowCount) { await client.query('ROLLBACK'); return 'skipped' }
    const existing = await client.query<{ state: string }>('SELECT state FROM t_platform_premium_payment WHERE order_rid=$1 FOR UPDATE', [order.rid])
    if (existing.rowCount) {
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='TON 付款状态待人工核查',update_time=now(),tg_notice_admin='Y' WHERE rid=$1 AND status=1", [order.rid])
      await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code='PREVIOUS_ATTEMPT_REQUIRES_REVIEW',updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')", [order.rid])
      await client.query('COMMIT'); return 'manual'
    }
    const found = await client.query<Platform>('SELECT rid,platform_hash,platform_cookie,platform_phrase FROM t_premium_platform WHERE rid=$1 AND bot_rid=$2 AND status=0 FOR UPDATE', [order.premium_platform_rid, order.bot_rid])
    platform = found.rows[0]
    if (!platform) { await client.query("UPDATE t_premium_platform_order SET status=5,comments='无可用会员平台',update_time=now(),tg_notice_admin='Y' WHERE rid=$1", [order.rid]); await client.query('COMMIT'); return 'failed' }
    await client.query("INSERT INTO t_platform_premium_payment(order_rid,state) VALUES($1,'prepared')", [order.rid])
    await client.query("UPDATE t_premium_platform_order SET status=6,comments='开通中',update_time=now() WHERE rid=$1 AND status=1", [order.rid])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  if (!platform) return 'failed'
  let signerInvoked = false
  try {
    if (!shouldContinue()) return 'skipped'
    const cookie = decryptSecret(platform.platform_cookie), mnemonic = decryptSecret(platform.platform_phrase)
    if (!cookie) throw new Error('会员平台未配置 Cookie')
    if (!mnemonic) throw new Error('会员平台未配置助记词')
    if (!platform.platform_hash) throw new Error('会员平台缺少 Fragment 配置')
    const preflightOk = await preflight(mnemonic)
    if (!preflightOk) throw new Error('TON 网关预检失败')
    const init = await fragmentRequest(fetcher, platform.platform_hash, cookie, { recipient: order.recipient, months: order.premium_package_month, payment_method: 'ton', method: 'initGiftPremiumRequest' })
    if (init.ok !== true || !init.req_id) throw new Error(`FRAGMENT_INIT_FAILED:${String(init.error ?? 'missing req_id')}`)
    const device = JSON.stringify({ platform: 'iphone', appName: 'Tonkeeper', appVersion: '4.9.0', maxProtocolVersion: 2, features: ['SendTransaction', { name: 'SendTransaction', maxMessages: 4 }] })
    const gift = await fragmentRequest(fetcher, platform.platform_hash, cookie, { device, transaction: 1, id: String(init.req_id), show_sender: 1, method: 'getGiftPremiumLink' })
    const message = gift.transaction?.messages?.[0], payload = typeof message?.payload === 'string' ? message.payload : '', rawAmount = message?.amount
    if (gift.ok !== true || !payload || (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') || !/^\d{1,32}$/.test(String(rawAmount)) || BigInt(String(rawAmount)) <= 0n) throw new Error('FRAGMENT_TRANSACTION_INVALID')
    const amount = (BigInt(String(rawAmount)) / 1_000_000_000n).toString() + '.' + (BigInt(String(rawAmount)) % 1_000_000_000n).toString().padStart(9, '0')
    const ref = refFromPayload(payload)
    if (!shouldContinue()) return 'skipped'
    const submitting = await pool.connect()
    try { await submitting.query("UPDATE t_platform_premium_payment SET state='submitting',updated_at=now() WHERE order_rid=$1 AND state='prepared'", [order.rid]) } finally { submitting.release() }
    signerInvoked = true
    const txHash = await pay(amount, ref, order.premium_package_month, mnemonic)
    await completeOrder(pool, order.rid, txHash)
    logger.info(`Premium order ${order.rid} completed`)
    return 'succeeded'
  } catch (error) {
    const message = error instanceof Error ? error.message : '会员开通失败'
    await failOrder(pool, order.rid, signerInvoked ? 'TON 付款结果不确定，需人工核查' : message, signerInvoked)
    logger.error(`Premium order ${order.rid} failed${signerInvoked ? ' after signer invocation; manual review required' : ''}: ${signerInvoked ? 'TON_RESULT_UNCONFIRMED' : message.slice(0, 100)}`)
    return signerInvoked ? 'manual' : 'failed'
  }
}
async function runTonPreflight(mnemonic: string) {
  const binary = process.env.PLATFORM_TON_PAYMENT_BINARY || '/usr/local/bin/ton-payment'
  try {
    await execFileAsync(binary, ['--check-gateway'], { env: { ...process.env, WalletMnemonic: mnemonic, TON_API_GATEWAY: process.env.TON_API_GATEWAY || 'https://tonapi.txsw.top', TON_API_GATEWAY_TOKEN: process.env.TON_API_GATEWAY_TOKEN || '' }, timeout: 30_000, maxBuffer: 64 * 1024 })
    return true
  } catch { return false }
}

async function reconcileInterruptedPayments(pool: Database) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const stale = await client.query<{ order_rid: number }>(
      "UPDATE t_platform_premium_payment SET state='manual',error_code='INTERRUPTED_PAYMENT_REQUIRES_REVIEW',updated_at=now() WHERE state IN ('prepared','submitting') AND updated_at < now()-interval '10 minutes' RETURNING order_rid")
    if (stale.rowCount) await client.query(
      "UPDATE t_premium_platform_order SET status=5,comments='TON 付款进程中断，需人工核查',update_time=now(),tg_notice_admin='Y' WHERE rid=ANY($1::int[]) AND status=6",
      [stale.rows.map(row => row.order_rid)])
    await client.query('COMMIT')
    return stale.rowCount ?? stale.rows.length
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function syncPremiumFulfillment(options: Options = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS === 'true'
  const shouldContinue = options.shouldContinue ?? (() => true), logger = options.logger ?? console
  if (!enabled || !shouldContinue()) return { skipped: true, scanned: 0, matched: 0, succeeded: 0, failed: 0, manual: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, pay = options.runPayment ?? runTonPayment, preflight = options.preflight ?? runTonPreflight
  const trades = await pool.query<{ rid: number }>("SELECT rid FROM t_premium_wallet_trade_list WHERE process_status=1 AND coin_name='usdt' ORDER BY rid LIMIT 100")
  let matched = 0, failed = 0, manual = await reconcileInterruptedPayments(pool), succeeded = 0
  for (const row of trades.rows) { if (!shouldContinue()) break; try { if (await matchTrade(pool, Number(row.rid)) === 'matched') matched++ } catch (error) { logger.error(`Premium trade ${row.rid} matching failed: ${error instanceof Error ? error.message : 'database error'}`) } }
  const due = await pool.query<DueOrder>("SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month FROM t_premium_platform_order WHERE status=1 ORDER BY rid LIMIT $1", [options.batchSize ?? 5])
  for (const order of due.rows) {
    if (!shouldContinue()) break
    const result = await fulfillOrder(pool, order, fetcher, pay, shouldContinue, logger, preflight)
    if (result === 'succeeded') succeeded++
    else if (result === 'manual') manual++
    else if (result === 'failed') failed++
  }
  return { skipped: false, scanned: trades.rows.length + due.rows.length, matched, succeeded, failed, manual }
}
