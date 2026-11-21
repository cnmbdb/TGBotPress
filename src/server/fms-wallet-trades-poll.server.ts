import { createHash } from 'node:crypto'
import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Wallet = { rid: number; recharge_wallet_addr: string; get_tx_time: Date | string | null; latest_trx_timestamp: string; latest_usdt_timestamp: string }
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
type Trade = { hash: string; from: string; timestamp: string; amount: string }
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const PAGE_SIZE = 50
const MAX_PAGES = 1000
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const obj = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const integer = (value: unknown) => (typeof value === 'number' || typeof value === 'string') && /^\d{1,100}$/.test(String(value))
function amount(value: string, decimals = 6) {
  const scale = 10n ** BigInt(decimals), whole = (BigInt(value) / scale).toString()
  const fraction = (BigInt(value) % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? whole + '.' + fraction : whole
}
function startTimestamp(latest: string, saved: Date | string | null) {
  let start = /^\d{1,16}$/.test(latest) ? BigInt(latest) : 0n
  if (saved) {
    const text = saved instanceof Date ? saved.toISOString() : String(saved)
    const date = new Date(text.includes('T') ? text : text.replace(' ', 'T') + '+08:00')
    if (Number.isFinite(date.getTime())) {
      const lower = BigInt(Math.max(0, date.getTime() - 10))
      if (lower > start) start = lower
    }
  }
  return start.toString()
}
function addressFromHex(value: unknown): string | null {
  if (typeof value !== 'string' || !/^41[a-fA-F0-9]{40}$/.test(value)) return null
  const body = Buffer.from(value, 'hex')
  const checksum = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4)
  const bytes = Buffer.concat([body, checksum])
  let n = BigInt('0x' + bytes.toString('hex')), out = ''
  while (n > 0n) { out = BASE58[Number(n % 58n)] + out; n /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out }
  return out
}
function scanTrx(value: unknown): Trade | null {
  const row = obj(value), token = obj(row?.tokenInfo)
  if (!row || !token || row.contractRet !== 'SUCCESS' || String(token.tokenId) !== '_' ||
      String(token.tokenAbbr).toLowerCase() !== 'trx' || typeof row.transactionHash !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(row.transactionHash) || typeof row.transferFromAddress !== 'string' ||
      !row.transferFromAddress || row.transferFromAddress.length > 200 || !integer(row.amount) ||
      !Number.isSafeInteger(row.timestamp) || Number(row.timestamp) < 0) return null
  const raw = BigInt(String(row.amount))
  if (raw < 1_000_000n) return null
  return { hash: row.transactionHash.toLowerCase(), from: row.transferFromAddress, timestamp: String(row.timestamp), amount: amount(String(raw)) }
}
function gridTrx(value: unknown, wallet: string): Trade | null {
  const row = obj(value), raw = obj(row?.raw_data), contracts = raw?.contract
  const contract = Array.isArray(contracts) ? obj(contracts[0]) : null
  const parameter = obj(contract?.parameter), detail = obj(parameter?.value)
  if (!row || typeof row.txID !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.txID) ||
      contract?.type !== 'TransferContract' || !detail || typeof raw?.timestamp !== 'number' ||
      !Number.isSafeInteger(raw.timestamp) || !integer(detail.amount) ||
      addressFromHex(detail.to_address) !== wallet) return null
  const rawAmount = BigInt(String(detail.amount))
  if (rawAmount < 100_000n) return null
  const from = addressFromHex(detail.owner_address)
  if (!from) return null
  return { hash: row.txID.toLowerCase(), from, timestamp: String(raw.timestamp), amount: amount(String(rawAmount)) }
}
function gridUsdt(value: unknown, wallet: string): Trade | null {
  const row = obj(value)
  if (!row || row.type !== 'Transfer' || typeof row.transaction_id !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(row.transaction_id) || typeof row.from !== 'string' ||
      !row.from || row.from.length > 200 || row.to !== wallet || !integer(row.value) ||
      typeof row.block_timestamp !== 'number' || !Number.isSafeInteger(row.block_timestamp) || row.block_timestamp < 0 ||
      BigInt(String(row.value)) <= 0n) return null
  return { hash: row.transaction_id.toLowerCase(), from: row.from, timestamp: String(row.block_timestamp), amount: amount(String(row.value)) }
}
function keys(value: unknown): string[] {
  let parsed = value
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return [] } }
  const raw = obj(parsed)?.keys, list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.map(String).map(key => key.trim()).filter(Boolean)
}
async function providerKeys(pool: Database, source: 'trongrid' | 'tronscan') {
  try {
    const configKey = source === 'trongrid' ? 'trongrid_api_keys' : 'tronscan_api_keys'
    const result = await pool.query<{ config_val: unknown }>('SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid', [configKey])
    const fromDb = result.rows.flatMap(row => keys(row.config_val))
    if (fromDb.length) return fromDb
  } catch {}
  const fallback = source === 'trongrid'
    ? process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY
    : process.env.TRONSCAN_API_KEYS ?? process.env.TRONSCAN_API_KEY
  return String(fallback ?? '').split(/[\s,]+/).map(key => key.trim()).filter(Boolean)
}
function validateGridNext(value: unknown, path: string, required: Record<string, string>) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'api.trongrid.io' || url.port || url.username ||
        url.password || url.hash || url.pathname !== path) return null
    for (const [key, expected] of Object.entries(required)) if (url.searchParams.get(key) !== expected) return null
    for (const key of url.searchParams.keys()) if (!new Set([...Object.keys(required), 'fingerprint']).has(key)) return null
    return url
  } catch { return null }
}
async function requestJson(request: Fetcher, url: URL, key = '') {
  const response = await request(url, { headers: { Accept: 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`provider HTTP ${response.status}`)
  return await response.json() as unknown
}
async function importTrade(pool: Database, wallet: Wallet, coin: 'trx' | 'usdt', trade: Trade, now: Date) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [trade.hash])
    const exists = await client.query('SELECT 1 FROM t_fms_wallet_trade_list WHERE tx_hash=$1 LIMIT 1', [trade.hash])
    if (exists.rowCount) { await client.query('COMMIT'); return false }
    await client.query(
      "INSERT INTO t_fms_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time) VALUES($1,$2,$3,$4,$5,$6,1,$7,'待处理',$7)",
      [trade.hash, trade.from, wallet.recharge_wallet_addr, coin, trade.amount, trade.timestamp, now],
    )
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
async function tronscanTrxPages(options: { pool: Database; request: Fetcher; wallet: Wallet; key: string; start: string; end: string; now: () => Date; shouldContinue: () => boolean }) {
  let offset = 0, inserted = 0
  for (let page = 0; page < MAX_PAGES && options.shouldContinue(); page++) {
    const url = new URL('https://apilist.tronscanapi.com/api/new/transfer')
    for (const [key, value] of Object.entries({ sort: '-timestamp', count: 'true', limit: String(PAGE_SIZE), start: String(offset), address: options.wallet.recharge_wallet_addr, toAddress: options.wallet.recharge_wallet_addr, tokens: '_', start_timestamp: options.start, end_timestamp: options.end })) url.searchParams.set(key, value)
    const data = obj(await requestJson(options.request, url, options.key)), rows = data?.data
    if (!data || !Array.isArray(rows)) throw new Error('invalid TronScan transfer list')
    for (const row of rows) {
      if (!options.shouldContinue()) break
      const trade = scanTrx(row)
      if (trade && await importTrade(options.pool, options.wallet, 'trx', trade, options.now())) inserted++
    }
    const total = Number(data.total)
    if (!Number.isSafeInteger(total) || total <= offset + rows.length || rows.length < PAGE_SIZE) break
    offset += rows.length
    if (page === MAX_PAGES - 1) throw new Error('TronScan pagination exceeded safety limit')
  }
  return inserted
}
async function tronGridPages(options: { pool: Database; request: Fetcher; wallet: Wallet; key: string; initial: URL; path: string; required: Record<string, string>; coin: 'trx' | 'usdt'; parse: (row: unknown, wallet: string) => Trade | null; now: () => Date; shouldContinue: () => boolean }) {
  let url: URL | null = options.initial, inserted = 0
  const seen = new Set<string>()
  for (let page = 0; url && page < MAX_PAGES && options.shouldContinue(); page++) {
    if (seen.has(url.href)) throw new Error('repeated TronGrid pagination URL')
    seen.add(url.href)
    const payload = obj(await requestJson(options.request, url, options.key)), rows = payload?.data
    if (!Array.isArray(rows)) throw new Error('invalid TronGrid transaction list')
    for (const row of rows) {
      if (!options.shouldContinue()) break
      const trade = options.parse(row, options.wallet.recharge_wallet_addr)
      if (trade && await importTrade(options.pool, options.wallet, options.coin, trade, options.now())) inserted++
    }
    const meta = obj(payload?.meta), links = obj(meta?.links), rawNext = links?.next
    const next = validateGridNext(rawNext, options.path, options.required)
    if (rawNext && !next) throw new Error('invalid TronGrid pagination URL')
    url = next
    if (url && page === MAX_PAGES - 1) throw new Error('TronGrid pagination exceeded safety limit')
  }
  return inserted
}
export async function syncFmsWalletTrades(options: { pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date } = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_FMS_WALLET_POLLING === 'true')) return { wallets: 0, inserted: 0, skipped: true }
  const pool = options.pool ?? db, request = options.request ?? fetch
  const logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!shouldContinue()) return { wallets: 0, inserted: 0, skipped: true }
  const wallets = await pool.query<Wallet>(
    "SELECT b.rid,b.recharge_wallet_addr,b.get_tx_time::text AS get_tx_time,COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_fms_wallet_trade_list t WHERE t.transferto_address=b.recharge_wallet_addr AND t.coin_name='trx' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_trx_timestamp,COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_fms_wallet_trade_list t WHERE t.transferto_address=b.recharge_wallet_addr AND t.coin_name='usdt' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_usdt_timestamp FROM t_telegram_bot b WHERE b.recharge_wallet_addr IS NOT NULL AND b.recharge_wallet_addr LIKE 'T%' AND length(b.recharge_wallet_addr)=34 ORDER BY b.rid",
  )
  const gridKeys = await providerKeys(pool, 'trongrid'), scanKeys = await providerKeys(pool, 'tronscan')
  const end = String(now().getTime())
  let inserted = 0, cursor = 0
  await Promise.all(Array.from({ length: Math.min(5, wallets.rows.length) }, async () => {
    while (cursor < wallets.rows.length && shouldContinue()) {
      const wallet = wallets.rows[cursor++]
      try {
        const trxStart = startTimestamp(wallet.latest_trx_timestamp, wallet.get_tx_time)
        if (gridKeys.length) {
          const path = `/v1/accounts/${encodeURIComponent(wallet.recharge_wallet_addr)}/transactions`
          const required = { only_to: 'true', only_confirm: 'true', limit: String(PAGE_SIZE), min_timestamp: trxStart, search_internal: 'false' }
          const url = new URL('https://api.trongrid.io' + path)
          for (const [key, value] of Object.entries(required)) url.searchParams.set(key, value)
          try { inserted += await tronGridPages({ pool, request, wallet, key: gridKeys[Math.floor(Math.random() * gridKeys.length)], initial: url, path, required, coin: 'trx', parse: gridTrx, now, shouldContinue }) }
          catch (error) { logger.error(`FMS TronGrid TRX poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`) }
        }
        if (scanKeys.length && shouldContinue()) {
          try { inserted += await tronscanTrxPages({ pool, request, wallet, key: scanKeys[Math.floor(Math.random() * scanKeys.length)], start: trxStart, end, now, shouldContinue }) }
          catch (error) { logger.error(`FMS TronScan TRX poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`) }
        }
        if (shouldContinue()) {
          const usdtStart = startTimestamp(wallet.latest_usdt_timestamp, wallet.get_tx_time)
          const path = `/v1/accounts/${encodeURIComponent(wallet.recharge_wallet_addr)}/transactions/trc20`
          const required = { limit: String(PAGE_SIZE), only_to: 'true', min_timestamp: usdtStart, contract_address: USDT }
          const url = new URL('https://api.trongrid.io' + path)
          for (const [key, value] of Object.entries(required)) url.searchParams.set(key, value)
          try { inserted += await tronGridPages({ pool, request, wallet, key: gridKeys[0] ?? '', initial: url, path, required, coin: 'usdt', parse: gridUsdt, now, shouldContinue }) }
          catch (error) { logger.error(`FMS TronGrid USDT poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`) }
        }
      } catch (error) { logger.error(`FMS wallet poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`) }
    }
  }))
  return { wallets: wallets.rows.length, inserted, skipped: false }
}

