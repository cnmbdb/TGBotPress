import { createHash } from 'node:crypto'
import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { decimalUnits } from '@tgbotpress/plugin-energy/units.js'
import { energyWalletStartTimestamp } from '@tgbotpress/plugin-energy/poll.js'

type Database = Pick<Pool, 'query'>
type Logger = Pick<Console, 'error'>
type Wallet = { rid: number; receive_wallet: string; get_tx_time: Date | string | null; latest_trx_timestamp: string | null; latest_usdt_timestamp: string | null }
type Json = Record<string, unknown>
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const PAGE_SIZE = 50
const MAX_PAGES_PER_SOURCE = 1000
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function objectValue(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}
function decodeTronAddress(hex: unknown): string | null {
  if (typeof hex !== 'string' || !/^41[a-fA-F0-9]{40}$/.test(hex)) return null
  const payload = Buffer.from(hex, 'hex')
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  const bytes = Buffer.concat([payload, checksum])
  let number = BigInt('0x' + bytes.toString('hex')), encoded = ''
  while (number > 0n) { encoded = BASE58[Number(number % 58n)] + encoded; number /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; encoded = '1' + encoded }
  return encoded
}
function tronscanTrx(value: unknown) {
  const row = objectValue(value), token = objectValue(row?.tokenInfo)
  if (!row || !token || row.contractRet !== 'SUCCESS' || String(token.tokenId) !== '_' ||
    String(token.tokenAbbr).toLowerCase() !== 'trx' || typeof row.transactionHash !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(row.transactionHash) || typeof row.transferFromAddress !== 'string' ||
    !row.transferFromAddress || row.transferFromAddress.length > 200 ||
    (typeof row.amount !== 'string' && typeof row.amount !== 'number') || !/^\d{1,100}$/.test(String(row.amount)) ||
    !safeInteger(row.timestamp)) return null
  const amount = BigInt(String(row.amount))
  if (amount < 1_000_000n) return null
  return { hash: row.transactionHash.toLowerCase(), from: row.transferFromAddress, timestamp: String(row.timestamp), amount: decimalUnits(String(amount)) }
}
function tronGridTrx(value: unknown, wallet: string) {
  const row = objectValue(value), raw = objectValue(row?.raw_data), contracts = raw?.contract
  const contract = Array.isArray(contracts) ? objectValue(contracts[0]) : null
  const parameter = objectValue(contract?.parameter), detail = objectValue(parameter?.value)
  if (!row || !detail || typeof row.txID !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.txID) ||
    contract?.type !== 'TransferContract' || !safeInteger(raw?.timestamp) ||
    (typeof detail.amount !== 'string' && typeof detail.amount !== 'number') || !/^\d{1,100}$/.test(String(detail.amount))) return null
  const to = decodeTronAddress(detail.to_address), from = decodeTronAddress(detail.owner_address), amount = BigInt(String(detail.amount))
  if (!from || to !== wallet || amount < 100_000n) return null
  return { hash: row.txID.toLowerCase(), from, timestamp: String(raw.timestamp), amount: decimalUnits(String(amount)) }
}
function tronGridUsdt(value: unknown, wallet: string) {
  const row = objectValue(value), token = objectValue(row?.token_info)
  if (!row || row.type !== 'Transfer' || typeof row.transaction_id !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(row.transaction_id) || typeof row.from !== 'string' ||
    !row.from || row.from.length > 200 || row.to !== wallet ||
    (typeof row.value !== 'string' && typeof row.value !== 'number') || !/^\d{1,100}$/.test(String(row.value)) ||
    !safeInteger(row.block_timestamp) || (token?.address !== undefined && token.address !== USDT_CONTRACT)) return null
  const amount = BigInt(String(row.value))
  if (amount === 0n) return null
  return { hash: row.transaction_id.toLowerCase(), from: row.from, timestamp: String(row.block_timestamp), amount: decimalUnits(String(amount)) }
}
export { energyWalletStartTimestamp } from '@tgbotpress/plugin-energy/poll.js'
function keysFromConfig(value: unknown) {
  let parsed = value
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return [] as string[] } }
  const raw = objectValue(parsed)?.keys
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return values.map(String).map(item => item.trim()).filter(Boolean)
}
async function providerKeys(pool: Database, source: 'trongrid' | 'tronscan') {
  const configKey = source === 'trongrid' ? 'trongrid_api_keys' : 'tronscan_api_keys'
  try {
    const configured = await pool.query<{ config_val: unknown }>('SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid', [configKey])
    const fromDb = configured.rows.flatMap(row => keysFromConfig(row.config_val))
    if (fromDb.length) return fromDb
  } catch { /* match the legacy key helper by falling back to environment configuration */ }
  const envKeys = source === 'trongrid'
    ? process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY
    : process.env.TRONSCAN_API_KEYS ?? process.env.TRONSCAN_API_KEY
  return String(envKeys ?? '').split(/[\s,]+/).map(value => value.trim()).filter(Boolean)
}
function validatedNext(value: unknown, path: string, params: Record<string, string>) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'api.trongrid.io' || url.port || url.username ||
      url.password || url.hash || url.pathname !== path) return null
    for (const [key, expected] of Object.entries(params)) if (url.searchParams.get(key) !== expected) return null
    const allowed = new Set([...Object.keys(params), 'fingerprint'])
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) return null
    return url
  } catch { return null }
}
async function requestJson(request: Fetcher, url: URL, key: string) {
  const response = await request(url, {
    headers: { Accept: 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as unknown
}
async function insertTrade(pool: Database, wallet: Wallet, coin: 'trx' | 'usdt', trade: ReturnType<typeof tronscanTrx>, now: Date) {
  if (!trade) return false
  const result = await pool.query(
    "INSERT INTO t_energy_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time) " +
    "VALUES($1,$2,$3,$4,$5,$6,1,$7,'待处理',$7) ON CONFLICT (tx_hash) DO NOTHING",
    [trade.hash, trade.from, wallet.receive_wallet, coin, trade.amount, trade.timestamp, now],
  )
  return (result.rowCount ?? 0) > 0
}
async function syncTronScanTrx(options: { pool: Database; request: Fetcher; wallet: Wallet; key: string; start: string; end: string; now: () => Date }) {
  let offset = 0, inserted = 0
  for (let page = 0; page < MAX_PAGES_PER_SOURCE; page++) {
    const url = new URL('https://apilist.tronscanapi.com/api/new/transfer')
    for (const [key, value] of Object.entries({
      sort: '-timestamp', count: 'true', limit: String(PAGE_SIZE), start: String(offset),
      address: options.wallet.receive_wallet, toAddress: options.wallet.receive_wallet, tokens: '_',
      start_timestamp: options.start, end_timestamp: options.end,
    })) url.searchParams.set(key, value)
    const payload = objectValue(await requestJson(options.request, url, options.key))
    if (!payload || !Array.isArray(payload.data) || !safeInteger(payload.total)) throw new Error('invalid TronScan transfer response')
    for (const row of payload.data) {
      const trade = tronscanTrx(row)
      if (trade && await insertTrade(options.pool, options.wallet, 'trx', trade, options.now())) inserted++
    }
    if (payload.data.length < PAGE_SIZE || offset + PAGE_SIZE >= payload.total) break
    offset += PAGE_SIZE
    if (page === MAX_PAGES_PER_SOURCE - 1) throw new Error('TronScan pagination exceeded safety limit')
  }
  return inserted
}
async function syncTronGridPages(options: {
  pool: Database; request: Fetcher; wallet: Wallet; key: string; initial: URL; path: string
  nextParams: Record<string, string>; coin: 'trx' | 'usdt'; parse: (row: unknown, wallet: string) => ReturnType<typeof tronscanTrx>; now: () => Date
}) {
  const seen = new Set<string>()
  let url: URL | null = options.initial, inserted = 0
  for (let page = 0; url && page < MAX_PAGES_PER_SOURCE; page++) {
    if (seen.has(url.href)) throw new Error('repeated TronGrid pagination URL')
    seen.add(url.href)
    const payload = objectValue(await requestJson(options.request, url, options.key))
    if (!payload || !Array.isArray(payload.data)) throw new Error('invalid TronGrid transaction response')
    for (const row of payload.data) {
      const trade = options.parse(row, options.wallet.receive_wallet)
      if (trade && await insertTrade(options.pool, options.wallet, options.coin, trade, options.now())) inserted++
    }
    const links = objectValue(objectValue(payload.meta)?.links)
    const rawNext = links?.next, next = validatedNext(rawNext, options.path, options.nextParams)
    if (rawNext && !next) throw new Error('invalid TronGrid pagination URL')
    url = next
    if (url && page === MAX_PAGES_PER_SOURCE - 1) throw new Error('TronGrid pagination exceeded safety limit')
  }
  return inserted
}
function apiUrl(wallet: string, route: 'transactions' | 'transactions/trc20') {
  return new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet)}/${route}`)
}
export async function syncEnergyWalletTrades(options: {
  pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_ENERGY_WALLET_TRADES_POLLING === 'true'
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!enabled || !shouldContinue()) return { wallets: 0, inserted: 0, skipped: true }
  const pool = options.pool ?? db, request = options.request ?? fetch
  const logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const wallets = await pool.query<Wallet>(
    "SELECT w.rid,w.receive_wallet,w.get_tx_time::text AS get_tx_time," +
    "COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_energy_wallet_trade_list t WHERE t.transferto_address=w.receive_wallet AND t.coin_name='trx' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_trx_timestamp," +
    "COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_energy_wallet_trade_list t WHERE t.transferto_address=w.receive_wallet AND t.coin_name='usdt' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_usdt_timestamp " +
    "FROM t_energy_platform_bot w WHERE w.status=0 AND length(w.receive_wallet)=34 ORDER BY w.rid",
  )
  if (!shouldContinue()) return { wallets: wallets.rows.length, inserted: 0, skipped: true }
  const [gridKeys, scanKeys] = await Promise.all([providerKeys(pool, 'trongrid'), providerKeys(pool, 'tronscan')])
  let inserted = 0, cursor = 0
  await Promise.all(Array.from({ length: Math.min(5, wallets.rows.length) }, async () => {
    while (cursor < wallets.rows.length && shouldContinue()) {
      const wallet = wallets.rows[cursor++]
      const trxStart = energyWalletStartTimestamp(wallet.latest_trx_timestamp, wallet.get_tx_time)
      const usdtStart = energyWalletStartTimestamp(wallet.latest_usdt_timestamp, wallet.get_tx_time)
      const report = (source: string, error: unknown) => logger.error(
        `Energy wallet ${source} poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`,
      )
      if (scanKeys.length && shouldContinue()) {
        try { inserted += await syncTronScanTrx({ pool, request, wallet, key: scanKeys[Math.floor(Math.random() * scanKeys.length)], start: trxStart, end: String(now().getTime()), now }) }
        catch (error) { report('TronScan TRX', error) }
      }
      if (gridKeys.length && shouldContinue()) {
        const trxPath = `/v1/accounts/${encodeURIComponent(wallet.receive_wallet)}/transactions`
        const trxUrl = apiUrl(wallet.receive_wallet, 'transactions')
        for (const [key, value] of Object.entries({ only_to: 'true', only_confirmed: 'true', limit: String(PAGE_SIZE), min_timestamp: trxStart, search_internal: 'false' })) trxUrl.searchParams.set(key, value)
        try {
          inserted += await syncTronGridPages({ pool, request, wallet, key: gridKeys[Math.floor(Math.random() * gridKeys.length)], initial: trxUrl, path: trxPath, nextParams: { only_to: 'true', only_confirmed: 'true', limit: String(PAGE_SIZE), min_timestamp: trxStart, search_internal: 'false' }, coin: 'trx', parse: tronGridTrx, now })
        } catch (error) { report('TronGrid TRX', error) }
        if (shouldContinue()) {
          const usdtPath = `/v1/accounts/${encodeURIComponent(wallet.receive_wallet)}/transactions/trc20`
          const usdtUrl = apiUrl(wallet.receive_wallet, 'transactions/trc20')
          for (const [key, value] of Object.entries({ only_to: 'true', limit: String(PAGE_SIZE), min_timestamp: usdtStart, contract_address: USDT_CONTRACT })) usdtUrl.searchParams.set(key, value)
          try {
            inserted += await syncTronGridPages({ pool, request, wallet, key: gridKeys[Math.floor(Math.random() * gridKeys.length)], initial: usdtUrl, path: usdtPath, nextParams: { only_to: 'true', limit: String(PAGE_SIZE), min_timestamp: usdtStart, contract_address: USDT_CONTRACT }, coin: 'usdt', parse: tronGridUsdt, now })
          } catch (error) { report('TronGrid USDT', error) }
        }
      }
    }
  }))
  return { wallets: wallets.rows.length, inserted, skipped: false }
}

