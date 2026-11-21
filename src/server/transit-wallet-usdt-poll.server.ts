import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { transitUsdtStartTimestamp } from '@tgbotpress/plugin-transit/poll.js'
type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'info' | 'error'>
type Wallet = { rid: number; receive_wallet: string; get_tx_time: Date | string | null; latest_timestamp: string | null }
type Event = { transaction_id?: unknown; type?: unknown; from?: unknown; value?: unknown; block_timestamp?: unknown }
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export { transitUsdtStartTimestamp } from '@tgbotpress/plugin-transit/poll.js'
function nextUrl(value: unknown, address: string) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'api.trongrid.io' || url.port || url.username || url.password || url.hash ||
      url.pathname !== `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` ||
      url.searchParams.get('contract_address') !== contract || url.searchParams.get('only_to') !== 'true') return null
    return url
  } catch { return null }
}
function eventData(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const row = value as Event
  if (row.type !== 'Transfer' || typeof row.transaction_id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.transaction_id) ||
    typeof row.from !== 'string' || !row.from || row.from.length > 200 ||
    typeof row.value !== 'string' || !/^\d{1,100}$/.test(row.value) || !safeInteger(row.block_timestamp)) return null
  const raw = BigInt(row.value)
  if (!raw) return null
  const whole = raw / 1_000_000n
  const fraction = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return { hash: row.transaction_id, from: row.from, timestamp: String(row.block_timestamp), amount: fraction ? `${whole}.${fraction}` : whole.toString() }
}
async function insert(pool: Database, wallet: Wallet, value: ReturnType<typeof eventData>, now: Date) {
  if (!value) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [value.hash])
    const exists = await client.query('SELECT 1 FROM t_transit_wallet_trade_list WHERE tx_hash=$1 LIMIT 1', [value.hash])
    if (exists.rowCount) { await client.query('COMMIT'); return false }
    await client.query(
      "INSERT INTO t_transit_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time,sendback_address,sendback_amount,sendback_coin_name) VALUES($1,$2,$3,'usdt',$4,$5,1,$6,'\u5f85\u5151\u6362',$6,$2,'0','trx')",
      [value.hash, value.from, wallet.receive_wallet, value.amount, value.timestamp, now],
    )
    await client.query('COMMIT'); return true
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function syncTransitWalletUsdtTrades(options: {
  pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_TRANSIT_WALLET_POLLING === 'true'
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!enabled || !shouldContinue()) return { wallets: 0, inserted: 0, skipped: true }
  const pool = options.pool ?? db, request = options.request ?? fetch, logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const keys = (process.env.TRONGRID_API_KEY ?? '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
  const wallets = await pool.query<Wallet>(
    "SELECT w.rid,w.receive_wallet,w.get_tx_time::text AS get_tx_time,COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_transit_wallet_trade_list t WHERE t.transferto_address=w.receive_wallet AND t.coin_name='usdt' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_timestamp FROM t_transit_wallet w WHERE w.status=0 AND length(w.receive_wallet)=34 ORDER BY w.rid",
  )
  let inserted = 0
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(2, wallets.rows.length) }, async () => {
    while (cursor < wallets.rows.length && shouldContinue()) {
      const wallet = wallets.rows[cursor++]
      let url = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet.receive_wallet)}/transactions/trc20`)
      url.searchParams.set('limit', '50'); url.searchParams.set('only_to', 'true')
      url.searchParams.set('min_timestamp', transitUsdtStartTimestamp(wallet.latest_timestamp, wallet.get_tx_time)); url.searchParams.set('contract_address', contract)
      const seen = new Set<string>()
      try {
        while (shouldContinue()) {
          if (seen.has(url.href)) throw new Error('repeated TronGrid pagination URL')
          seen.add(url.href)
          const key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : ''
          const response = await request(url, { headers: { Accept: 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
          if (!response.ok) throw new Error(`TronGrid HTTP ${response.status}`)
          const payload = await response.json() as { data?: unknown; meta?: { links?: { next?: unknown } } }
          if (!Array.isArray(payload.data)) throw new Error('invalid TronGrid transaction list')
          for (const row of payload.data) { if (!shouldContinue()) break; if (await insert(pool, wallet, eventData(row), now())) inserted++ }
          const next = nextUrl(payload.meta?.links?.next, wallet.receive_wallet)
          if (payload.meta?.links?.next && !next) throw new Error('invalid TronGrid pagination URL')
          if (!next) break
          url = next
        }
      } catch (error) {
        logger.error(`Transit USDT poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`)
      }
    }
  }))
  return { wallets: wallets.rows.length, inserted, skipped: false }
}
