import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Json = Record<string, unknown>
type Wallets = { receive: Set<string>; bishu: Map<string, number> }
type Block = { number: number; id: string; timestamp: number; transactions: unknown[] }
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
const USDT_CONTRACT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function decodeAddress(hex: unknown) {
  if (typeof hex !== 'string' || !/^41[a-fA-F0-9]{40}$/.test(hex)) return null
  const payload = Buffer.from(hex, 'hex')
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  const bytes = Buffer.concat([payload, checksum])
  let number = BigInt('0x' + bytes.toString('hex')), encoded = ''
  while (number > 0n) { encoded = BASE58[Number(number % 58n)] + encoded; number /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; encoded = '1' + encoded }
  return encoded
}
function amountString(raw: bigint) {
  const whole = (raw / 1_000_000n).toString()
  const fraction = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? whole + '.' + fraction : whole
}
function configKeys(value: unknown) {
  let parsed = value
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return [] as string[] } }
  const raw = isObject(parsed) ? parsed.keys : undefined
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.map(String).map(item => item.trim()).filter(Boolean)
}
async function tronGridKeys(pool: Database) {
  try {
    const result = await pool.query<{ config_val: unknown }>("SELECT config_val FROM t_sys_config WHERE config_key='trongrid_api_keys' ORDER BY rid")
    const keys = result.rows.flatMap(row => configKeys(row.config_val))
    if (keys.length) return keys
  } catch { /* use environment fallback like the legacy API-key helper */ }
  return String(process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY ?? '')
    .split(/[\s,]+/).map(value => value.trim()).filter(Boolean)
}
async function loadWallets(pool: Database): Promise<Wallets> {
  const receive = await pool.query<{ receive_wallet: string }>(
    "SELECT receive_wallet FROM t_energy_platform_bot WHERE status=0 AND length(receive_wallet)=34 AND receive_wallet IS NOT NULL",
  )
  const bishu = await pool.query<{ rid: number; wallet_addr: string }>(
    "SELECT a.rid,a.wallet_addr FROM t_energy_ai_bishu a " +
    "JOIN t_telegram_bot b ON a.bot_rid=b.rid JOIN t_energy_platform_bot c ON a.bot_rid=c.bot_rid " +
    "WHERE a.status=0 AND c.is_open_bishu='Y' AND length(a.wallet_addr)=34 " +
    "AND a.max_buy_quantity>a.total_buy_quantity ORDER BY a.rid",
  )
  const bishuByWallet = new Map<string, number>()
  for (const row of bishu.rows) if (!bishuByWallet.has(row.wallet_addr)) bishuByWallet.set(row.wallet_addr, row.rid)
  return { receive: new Set(receive.rows.map(row => row.receive_wallet)), bishu: bishuByWallet }
}
async function requestJson(request: Fetcher, key: string, path: string, body: Json): Promise<Json> {
  const response = await request('https://api.trongrid.io' + path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`TronGrid HTTP ${response.status}`)
  const payload = await response.json()
  if (!isObject(payload) || payload.Error || payload.error) throw new Error('invalid TronGrid block response')
  return payload
}
function parseBlock(payload: Json, expectedNumber?: number): Block {
  const header = isObject(payload.block_header) ? payload.block_header : null
  const raw = header && isObject(header.raw_data) ? header.raw_data : null
  const number = raw?.number, timestamp = raw?.timestamp, id = payload.blockID
  if (!integer(number) || !integer(timestamp) || typeof id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(id) ||
    (expectedNumber !== undefined && number !== expectedNumber) ||
    (payload.transactions !== undefined && !Array.isArray(payload.transactions))) throw new Error('invalid TronGrid block payload')
  return { number, id: id.toLowerCase(), timestamp, transactions: Array.isArray(payload.transactions) ? payload.transactions : [] }
}
async function currentBlock(request: Fetcher, key: string) {
  return parseBlock(await requestJson(request, key, '/wallet/getnowblock', {}))
}
async function numberedBlock(request: Fetcher, key: string, number: number) {
  return parseBlock(await requestJson(request, key, '/wallet/getblockbynum', { num: number }), number)
}
async function insertEnergyTrade(client: PoolClient, txHash: string, from: string, to: string, coin: 'trx' | 'usdt', amount: string, timestamp: number, now: Date) {
  const result = await client.query(
    "INSERT INTO t_energy_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time) " +
    "VALUES($1,$2,$3,$4,$5,$6,1,$7,'待处理',$7) ON CONFLICT (tx_hash) DO NOTHING",
    [txHash.toLowerCase(), from, to, coin, amount, String(timestamp), now],
  )
  return (result.rowCount ?? 0) > 0
}
type ProcessResult = { inserted: number; markedForPurchase: number; cancelled: boolean }
async function processBlock(client: PoolClient, block: Block, wallets: Wallets, now: Date, shouldContinue: () => boolean, allowPurchaseTrigger: boolean): Promise<ProcessResult> {
  let inserted = 0, markedForPurchase = 0
  for (const value of block.transactions) {
    if (!shouldContinue()) return { inserted, markedForPurchase, cancelled: true }
    if (!isObject(value) || typeof value.txID !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.txID)) continue
    const raw = isObject(value.raw_data) ? value.raw_data : null
    const contracts = raw?.contract
    const contract = Array.isArray(contracts) ? contracts[0] : null
    if (!isObject(contract) || !isObject(contract.parameter) || !isObject(contract.parameter.value)) continue
    const detail = contract.parameter.value
    const result = Array.isArray(value.ret) ? value.ret[0] : null
    if (!isObject(result) || result.contractRet !== 'SUCCESS') continue

    if (contract.type === 'TransferContract') {
      const recipient = decodeAddress(detail.to_address), sender = decodeAddress(detail.owner_address)
      const rawAmount = detail.amount
      if (!recipient || !sender || !wallets.receive.has(recipient) ||
        (typeof rawAmount !== 'string' && typeof rawAmount !== 'number') || !/^\d{1,100}$/.test(String(rawAmount))) continue
      const amount = BigInt(String(rawAmount))
      if (amount < 1_000_000n) continue
      if (await insertEnergyTrade(client, value.txID, sender, recipient, 'trx', amountString(amount), block.timestamp, now)) inserted++
      continue
    }

    if (contract.type !== 'TriggerSmartContract' || detail.contract_address !== USDT_CONTRACT_HEX ||
      typeof detail.data !== 'string' || !/^a9059cbb[0-9a-fA-F]{128,}$/.test(detail.data)) continue
    const recipient = decodeAddress('41' + detail.data.slice(32, 72))
    const sender = decodeAddress(detail.owner_address)
    const rawHex = detail.data.slice(72, 136)
    if (!sender || !recipient || !/^[a-fA-F0-9]{64}$/.test(rawHex)) continue
    const amount = BigInt('0x' + rawHex)
    if (wallets.receive.has(recipient) && amount >= 1_000_000n) {
      if (await insertEnergyTrade(client, value.txID, sender, recipient, 'usdt', amountString(amount), block.timestamp, now)) inserted++
    }
    const bishuRid = wallets.bishu.get(sender)
    if (allowPurchaseTrigger && amount > 0n && bishuRid !== undefined) {
      const changed = await client.query("UPDATE t_energy_ai_bishu SET is_buy='Y' WHERE rid=$1 AND is_buy='N'", [bishuRid])
      if (changed.rowCount) markedForPurchase++
    }
  }
  return { inserted, markedForPurchase, cancelled: false }
}
function stoppedResult(block?: number) {
  return { block, inserted: 0, markedForPurchase: 0, skipped: true }
}
export async function syncEnergyCurrentBlock(options: {
  pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; allowPurchaseTrigger?: boolean
  shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_ENERGY_BLOCK_MONITORING === 'true'
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!enabled || !shouldContinue()) return stoppedResult()
  const pool = options.pool ?? db, request = options.request ?? fetch
  const logger = options.logger ?? console, now = options.now ?? (() => new Date())
  try {
    const wallets = await loadWallets(pool)
    if (!wallets.receive.size && !wallets.bishu.size) return stoppedResult()
    const keys = await tronGridKeys(pool)
    const key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : ''
    const block = await currentBlock(request, key)
    if (!shouldContinue()) return stoppedResult(block.number)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-energy-block-cursor'))")
      const state = await client.query<{ latest_block: string; latest_block_id: string }>(
        "SELECT latest_block::text,latest_block_id FROM t_platform_energy_block_cursor WHERE cursor_key='energy-wallet' FOR UPDATE",
      )
      const previous = state.rows[0]?.latest_block ? BigInt(state.rows[0].latest_block) : null
      if (previous !== null && BigInt(block.number) < previous) {
        await client.query('COMMIT')
        return { ...stoppedResult(block.number), skipped: true, reason: 'node height moved behind stored cursor' }
      }
      if (previous === BigInt(block.number) && state.rows[0]?.latest_block_id === block.id) {
        await client.query('COMMIT')
        return { ...stoppedResult(block.number), skipped: true }
      }
      let missedQueued = 0
      if (previous !== null && BigInt(block.number) > previous + 1n) {
        const pending = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM t_platform_energy_missed_block WHERE status IN ('pending','processing')",
        )
        const available = Math.max(0, 20 - Number(pending.rows[0]?.count ?? 0))
        const end = BigInt(block.number) - 1n
        for (let number = previous + 1n; number <= end && missedQueued < available; number++, missedQueued++) {
          await client.query(
            "INSERT INTO t_platform_energy_missed_block(block_number) VALUES($1) ON CONFLICT (block_number) DO NOTHING",
            [number.toString()],
          )
        }
      }
      if (!shouldContinue()) { await client.query('ROLLBACK'); return stoppedResult(block.number) }
      const processed = await processBlock(client, block, wallets, now(), shouldContinue, options.allowPurchaseTrigger ?? process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true')
      if (processed.cancelled || !shouldContinue()) { await client.query('ROLLBACK'); return stoppedResult(block.number) }
      await client.query(
        "INSERT INTO t_platform_energy_block_cursor(cursor_key,latest_block,latest_block_id,updated_at) VALUES('energy-wallet',$1,$2,$3) " +
        "ON CONFLICT (cursor_key) DO UPDATE SET latest_block=EXCLUDED.latest_block,latest_block_id=EXCLUDED.latest_block_id,updated_at=EXCLUDED.updated_at",
        [block.number, block.id, now()],
      )
      await client.query('COMMIT')
      return { block: block.number, inserted: processed.inserted, markedForPurchase: processed.markedForPurchase, missedQueued, skipped: false }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  } catch (error) {
    logger.error(`Energy block monitor failed: ${error instanceof Error ? error.message : 'provider or database error'}`)
    throw error
  }
}
export async function syncEnergyMissedBlock(options: {
  pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; allowPurchaseTrigger?: boolean
  shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_ENERGY_BLOCK_MONITORING === 'true'
  const shouldContinue = options.shouldContinue ?? (() => true)
  if (!enabled || !shouldContinue()) return stoppedResult()
  const pool = options.pool ?? db, request = options.request ?? fetch
  const logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const wallets = await loadWallets(pool)
  if (!wallets.receive.size && !wallets.bishu.size) return stoppedResult()
  const keys = await tronGridKeys(pool), key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : ''
  const client = await pool.connect()
  let blockNumber: number | null = null, attempt = 0
  try {
    await client.query('BEGIN')
    const claim = await client.query<{ block_number: string; attempts: number }>(
      "SELECT block_number::text,attempts FROM t_platform_energy_missed_block " +
      "WHERE (status='pending' AND next_attempt_at <= $1) OR (status='processing' AND locked_until < $1) " +
      "ORDER BY block_number LIMIT 1 FOR UPDATE SKIP LOCKED",
      [now()],
    )
    if (!claim.rowCount) { await client.query('COMMIT'); client.release(); return stoppedResult() }
    blockNumber = Number(claim.rows[0].block_number)
    attempt = Number(claim.rows[0].attempts) + 1
    await client.query(
      "UPDATE t_platform_energy_missed_block SET status='processing',attempts=$2,locked_until=$3,updated_at=$4 WHERE block_number=$1",
      [blockNumber, attempt, new Date(now().getTime() + 30_000), now()],
    )
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); client.release(); throw error }

  if (blockNumber === null) { client.release(); return stoppedResult() }
  try {
    const block = await numberedBlock(request, key, blockNumber)
    if (!shouldContinue()) {
      await client.query("UPDATE t_platform_energy_missed_block SET status='pending',locked_until=NULL,next_attempt_at=$2,updated_at=$2 WHERE block_number=$1", [blockNumber, now()])
      return stoppedResult(blockNumber)
    }
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-energy-block-cursor'))")
    const processed = await processBlock(client, block, wallets, now(), shouldContinue, options.allowPurchaseTrigger ?? process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true')
    if (processed.cancelled || !shouldContinue()) { await client.query('ROLLBACK'); await client.query("UPDATE t_platform_energy_missed_block SET status='pending',locked_until=NULL,next_attempt_at=$2,updated_at=$2 WHERE block_number=$1", [blockNumber, now()]); return stoppedResult(blockNumber) }
    await client.query('DELETE FROM t_platform_energy_missed_block WHERE block_number=$1', [blockNumber])
    await client.query('COMMIT')
    return { block: blockNumber, inserted: processed.inserted, markedForPurchase: processed.markedForPurchase, skipped: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const delaySeconds = Math.min(60, Math.max(2, 2 ** Math.min(attempt, 6)))
    await client.query(
      "UPDATE t_platform_energy_missed_block SET status='pending',locked_until=NULL,next_attempt_at=$2,last_error=$3,updated_at=$4 WHERE block_number=$1",
      [blockNumber, new Date(now().getTime() + delaySeconds * 1000), error instanceof Error ? error.message.slice(0, 500) : 'provider or database error', now()],
    ).catch(() => {})
    logger.error(`Energy missed block ${blockNumber} failed: ${error instanceof Error ? error.message : 'provider or database error'}`)
    throw error
  } finally { client.release() }
}

