import { createHash } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'
import { collectionWalletSweepPlan as packageSweepPlan, decimalUnits, formatUnits, amountPlan } from '@tgbotpress/plugin-collection/sweep.js'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error' | 'info'>
type Coin = 'trx' | 'usdt'
type ActionCoin = Coin | 'trx_fee'
type Options = {
  pool?: Database
  fetcher?: typeof fetch
  logger?: Logger
  shouldContinue?: () => boolean
  enabled?: boolean
  batchSize?: number
}
type Wallet = {
  rid: number
  bot_rid: number
  wallet_addr: string
  wallet_addr_privatekey: string | null
  trx_collection_amount: string
  usdt_collection_amount: string
  trx_reserve_amount: string
  usdt_reserve_amount: string
  collection_wallet_addr: string | null
  permission_id: number
  tg_notice_obj: string | null
  bot_token: string | null
  trx_balance: string | null
  usdt_balance: string | null
  last_collection_time: Date | string | null
  last_collection_trx_balance: string | null
  last_collection_usdt_balance: string | null
  collection_trx_generation: number
  collection_usdt_generation: number
}
type AccountSnapshot = { trx: bigint; usdt: bigint }
type Resources = { energy: bigint; bandwidth: bigint }
type SweepPlan = { amount: bigint; coin: Coin }
type Action = {
  key: string
  coin: ActionCoin
  walletRid: number
  from: string
  to: string
  amount: bigint
  balance: bigint
  generation: number
}
const SCALE = 1_000_000n
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const STOP = { skipped: true, scanned: 0, transferred: 0, failed: 0 }

function encodeActionKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
function validTronAddress(address: string) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false
  let number = 0n
  for (const char of address) {
    const digit = BASE58.indexOf(char)
    if (digit < 0) return false
    number = number * 58n + BigInt(digit)
  }
  let hex = number.toString(16)
  if (hex.length % 2) hex = '0' + hex
  const decoded = Buffer.from(hex, 'hex')
  let leading = 0
  while (leading < address.length && address[leading] === '1') leading++
  const bytes = leading ? Buffer.concat([Buffer.alloc(leading), decoded]) : decoded
  if (bytes.length !== 25 || bytes[0] !== 0x41) return false
  const payload = bytes.subarray(0, 21)
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  return checksum.equals(bytes.subarray(21))
}
function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
async function responseJson(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetcher(input, init)
  const body = jsonRecord(await response.json().catch(() => null))
  if (!response.ok || !body) throw new Error('provider_response_invalid')
  return body
}
function providerHeaders(key: string | undefined) {
  return { Accept: 'application/json', ...(key?.trim() ? { 'TRON-PRO-API-KEY': key.trim() } : {}) }
}
async function tronscanSnapshot(fetcher: typeof fetch, address: string): Promise<AccountSnapshot> {
  const url = new URL('https://apilist.tronscanapi.com/api/accountv2')
  url.searchParams.set('address', address)
  const body = await responseJson(fetcher, url, { headers: providerHeaders(process.env.TRONSCAN_API_KEY), redirect: 'error', signal: AbortSignal.timeout(12_000) })
  const tokens = Array.isArray(body.withPriceTokens) ? body.withPriceTokens.map(jsonRecord).filter(Boolean) as Record<string, unknown>[] : []
  const trx = tokens.find(token => token.tokenId === '_')
  const usdt = tokens.find(token => token.tokenId === USDT_CONTRACT)
  const trxUnits = trx
    ? decimalUnits(trx.amount ?? '0', 6)
    : decimalUnits(String(body.balance ?? '0'), 0)
  const tokenDecimals = usdt ? Number(usdt.tokenDecimal ?? 6) : 6; const tokenBalance = usdt ? decimalUnits(usdt.balance ?? '0', 0) : 0n
  const usdtUnits = usdt && tokenDecimals > 6
    ? tokenBalance / (10n ** BigInt(tokenDecimals - 6))
    : usdt && tokenDecimals < 6
      ? tokenBalance * (10n ** BigInt(6 - tokenDecimals))
      : tokenBalance
  return { trx: trxUnits, usdt: usdtUnits }
}
async function tronGridSnapshot(fetcher: typeof fetch, address: string): Promise<AccountSnapshot> {
  const response = await responseJson(fetcher, 'https://api.trongrid.io/v1/accounts/' + encodeURIComponent(address), {
    headers: providerHeaders(process.env.TRONGRID_API_KEY), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  if (response.success !== true || !Array.isArray(response.data) || response.data.length === 0) throw new Error('wallet_not_activated')
  const account = jsonRecord(response.data[0])
  if (!account) throw new Error('wallet_response_invalid')
  const trx = decimalUnits(String(account.balance ?? '0'), 0)
  const tokenRows = Array.isArray(account.trc20) ? account.trc20.map(jsonRecord).filter(Boolean) as Record<string, unknown>[] : []
  let usdt = 0n
  for (const token of tokenRows) {
    const raw = token[USDT_CONTRACT]
    if (raw !== undefined) {
      if (!/^\d+$/.test(String(raw))) throw new Error('token_balance_invalid')
      usdt = decimalUnits(String(raw), 0)
      break
    }
  }
  return { trx, usdt }
}
async function readSnapshot(fetcher: typeof fetch, address: string): Promise<AccountSnapshot> {
  try { return await tronscanSnapshot(fetcher, address) }
  catch { return tronGridSnapshot(fetcher, address) }
}
async function readResources(fetcher: typeof fetch, address: string): Promise<Resources> {
  const body = await responseJson(fetcher, 'https://api.trongrid.io/wallet/getaccountresource', {
    method: 'POST', headers: { ...providerHeaders(process.env.TRONGRID_API_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, visible: true }), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  const energyLimit = BigInt(String(body.EnergyLimit ?? 0))
  const energyUsed = BigInt(String(body.EnergyUsed ?? 0))
  const freeLimit = BigInt(String(body.freeNetLimit ?? 0))
  const netLimit = BigInt(String(body.NetLimit ?? 0))
  const freeUsed = BigInt(String(body.freeNetUsed ?? 0))
  const netUsed = BigInt(String(body.NetUsed ?? 0))
  if ([energyLimit, energyUsed, freeLimit, netLimit, freeUsed, netUsed].some(value => value < 0n)) throw new Error('resource_response_invalid')
  return {
    energy: energyLimit > energyUsed ? energyLimit - energyUsed : 0n,
    bandwidth: (freeLimit > freeUsed ? freeLimit - freeUsed : 0n) + (netLimit > netUsed ? netLimit - netUsed : 0n),
  }
}
function enoughUsdtResources(balance: bigint, resources: Resources) {
  return (resources.energy >= 31_895n && (resources.bandwidth >= 345n || balance >= 350_000n)) || balance >= 13_750_000n
}
function signerConfig() {
  const token = process.env.TRON_SIGNER_TOKEN?.trim()
  const base = process.env.TRON_SIGNER_URL?.trim()
  if (!token || token.length < 32 || !base) throw new Error('signer_not_configured')
  const url = new URL(base)
  const env = (process.env.APP_ENV || 'production').toLowerCase()
  if (url.protocol !== 'https:' && !['local', 'dev', 'development'].includes(env)) throw new Error('signer_https_required')
  return { token, url }
}
async function signerTransfer(fetcher: typeof fetch, action: Action, privateKeyCiphertext: string, permissionId: number) {
  const { token, url } = signerConfig()
  const coin = action.coin === 'trx_fee' ? 'trx' : action.coin
  const body = {
    operation: coin === 'trx' ? 'transfer_trx' : 'transfer_trc20',
    private_key_ciphertext: privateKeyCiphertext,
    from_address: action.from,
    to_address: action.to,
    amount: formatUnits(action.amount),
    permission_id: permissionId,
    ...(coin === 'usdt' ? { contract_address: USDT_CONTRACT } : {}),
  }
  const result = await responseJson(fetcher, new URL('/api/internal/tron/sign', url), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  const data = jsonRecord(result.data)
  const txid = String(data?.txid ?? '')
  if (result.code !== 200 || !/^[a-f0-9]{64}$/i.test(txid)) throw new Error('signer_result_ambiguous')
  return txid
}
async function claimAction(client: PoolClient, action: Action) {
  await client.query('BEGIN')
  try {
    const inserted = await client.query(
      'INSERT INTO t_platform_collection_wallet_action(action_key,wallet_rid,coin_name,from_address,to_address,amount,balance_snapshot,generation) ' +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(action_key) DO NOTHING RETURNING id",
      [action.key, action.walletRid, action.coin, action.from, action.to, formatUnits(action.amount), formatUnits(action.balance), action.generation],
    )
    if (inserted.rowCount) { await client.query('COMMIT'); return true }
    const found = await client.query<{ id: string; state: string; updated_at: Date | string }>(
      'SELECT id::text,state,updated_at FROM t_platform_collection_wallet_action WHERE action_key=$1 FOR UPDATE', [action.key],
    )
    const row = found.rows[0]
    const age = row ? Date.now() - new Date(row.updated_at).getTime() : 0
    if (row?.state === 'claimed' && age > 90_000) {
      await client.query("UPDATE t_platform_collection_wallet_action SET state='claimed',attempts=attempts+1,error_code=NULL,updated_at=now() WHERE id=$1", [row.id])
      await client.query('COMMIT')
      return true
    }
    if (row?.state === 'signing' && age > 300_000) {
      await client.query("UPDATE t_platform_collection_wallet_action SET state='manual',error_code='signer_result_unknown',updated_at=now() WHERE id=$1", [row.id])
    }
    await client.query('COMMIT')
    return false
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
async function setActionState(client: PoolClient, key: string, state: 'signing' | 'succeeded' | 'manual', txid: string | null = null, errorCode: string | null = null) {
  await client.query('UPDATE t_platform_collection_wallet_action SET state=$2,tx_hash=$3,error_code=$4,updated_at=now() WHERE action_key=$1', [key, state, txid, errorCode])
}
async function queueNotice(client: PoolClient, wallet: Wallet, action: Action, txid: string) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !wallet.bot_token || !wallet.tg_notice_obj) return
  const message = '✅钱包归集成功\n------------------------------\n钱包地址：<code>' + wallet.wallet_addr +
    '</code>\n归集地址：<code>' + action.to + '</code>\n归集金额：<b>' + formatUnits(action.amount) +
    ' ' + (action.coin === 'trx' ? 'TRX' : 'USDT') + '</b>\n交易哈希：<code>' + txid + '</code>'
  for (const chatId of wallet.tg_notice_obj.split(',').map(value => value.trim()).filter(Boolean)) {
    const key = action.key + ':notice:' + chatId
    await client.query(
      "INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) VALUES('handlecollectionwallet',$1,'collection_wallet',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",
      [key, String(wallet.rid), wallet.bot_rid, chatId, message],
    )
  }
}
async function finalizeTransfer(client: PoolClient, wallet: Wallet, action: Action, txid: string) {
  await client.query('BEGIN')
  try {
    const current = await client.query<{ status: number; wallet_addr: string; collection_wallet_addr: string | null }>(
      'SELECT status,wallet_addr,collection_wallet_addr FROM t_collection_wallet WHERE rid=$1 FOR UPDATE', [wallet.rid],
    )
    const row = current.rows[0]
    await client.query(
      'INSERT INTO t_collection_wallet_list(wallet_addr,collection_wallet_addr,coin_name,collection_amount,collection_time,collection_hash,create_time) VALUES($1,$2,$3,$4,now(),$5,now())',
      [action.from, action.to, action.coin, formatUnits(action.amount), txid],
    )
    const unchanged = row?.status === 0 && row.wallet_addr === action.from && row.collection_wallet_addr === action.to
    if (unchanged) {
      const balanceColumn = action.coin === 'trx' ? 'last_collection_trx_balance' : 'last_collection_usdt_balance'
      await client.query(
        'UPDATE t_collection_wallet SET last_collection_time=now(),' + balanceColumn + '=$2,update_time=now() WHERE rid=$1',
        [wallet.rid, formatUnits(action.balance)],
      )
      await setActionState(client, action.key, 'succeeded', txid)
      await queueNotice(client, wallet, action, txid)
    } else {
      await setActionState(client, action.key, 'manual', txid, 'wallet_changed_after_broadcast')
    }
    await client.query('COMMIT')
    return unchanged
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
async function submitTransfer(client: PoolClient, fetcher: typeof fetch, logger: Logger, wallet: Wallet, action: Action, privateKey: string, permissionId: number) {
  if (!await claimAction(client, action)) return false
  await setActionState(client, action.key, 'signing')
  let txid: string | null = null
  try {
    txid = await signerTransfer(fetcher, action, privateKey, permissionId)
    await finalizeTransfer(client, wallet, action, txid)
    return true
  } catch {
    await setActionState(client, action.key, 'manual', txid, 'signer_result_unknown').catch(() => undefined)
    logger.error('handlecollectionwallet signer result requires reconciliation for wallet ' + wallet.rid + ' (' + action.coin + ')')
    return false
  }
}
async function submitFeeTopup(client: PoolClient, fetcher: typeof fetch, logger: Logger, wallet: Wallet, source: { rid: number; send_wallet: string; send_wallet_privatekey: string | null }, generation: number) {
  const action: Action = {
    key: encodeActionKey('trx_fee:' + wallet.rid + ':' + generation + ':' + source.rid + ':' + wallet.wallet_addr),
    coin: 'trx_fee', walletRid: wallet.rid, from: source.send_wallet, to: wallet.wallet_addr,
    amount: 15n * SCALE, balance: 15n * SCALE, generation,
  }
  if (!source.send_wallet_privatekey || !validTronAddress(source.send_wallet) || source.send_wallet === wallet.wallet_addr) throw new Error('fee_wallet_invalid')
  if (!await claimAction(client, action)) return false
  await setActionState(client, action.key, 'signing')
  try {
    const txid = await signerTransfer(fetcher, action, source.send_wallet_privatekey, 0)
    await setActionState(client, action.key, 'succeeded', txid)
    return true
  } catch {
    await setActionState(client, action.key, 'manual', null, 'signer_result_unknown').catch(() => undefined)
    logger.error('handlecollectionwallet fee top-up requires reconciliation for wallet ' + wallet.rid)
    return false
  }
}
async function lockWallet<T>(pool: Database, rid: number, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', ['collection-wallet:' + rid])
    if (!result.rows[0]?.locked) return null
    try { return await run(client) }
    finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['collection-wallet:' + rid]).catch(() => undefined) }
  } finally { client.release() }
}
async function rearmCoin(client: PoolClient, wallet: Wallet, coin: Coin, balance: bigint) {
  const snapshotKey = coin === 'trx' ? 'last_collection_trx_balance' : 'last_collection_usdt_balance'
  const generationKey = coin === 'trx' ? 'collection_trx_generation' : 'collection_usdt_generation'
  const previous = wallet[snapshotKey]
  if (previous === null || previous === undefined) return Number(wallet[generationKey] ?? 0)
  if (balance >= decimalUnits(previous)) return null
  const generation = Number(wallet[generationKey] ?? 0) + 1
  await client.query(
    'UPDATE t_collection_wallet SET ' + snapshotKey + '=NULL,' + generationKey + '=$2 WHERE rid=$1',
    [wallet.rid, generation],
  )
  wallet[snapshotKey] = null
  wallet[generationKey] = generation
  return generation
}
async function processWallet(pool: Database, wallet: Wallet, fetcher: typeof fetch, logger: Logger, shouldContinue: () => boolean) {
  let transferred = 0
  const locked = await lockWallet(pool, wallet.rid, async client => {
    if (!shouldContinue()) return { transferred: 0 }
    const snapshot = await readSnapshot(fetcher, wallet.wallet_addr)
    await client.query('UPDATE t_collection_wallet SET trx_balance=$2,usdt_balance=$3 WHERE rid=$1', [wallet.rid, formatUnits(snapshot.trx), formatUnits(snapshot.usdt)])
    if (!wallet.wallet_addr_privatekey || !wallet.collection_wallet_addr || !validTronAddress(wallet.wallet_addr) ||
        !validTronAddress(wallet.collection_wallet_addr) || wallet.wallet_addr === wallet.collection_wallet_addr) {
      logger.error('handlecollectionwallet invalid wallet configuration for wallet ' + wallet.rid)
      return { transferred: 0 }
    }
    let trx = snapshot.trx, usdt = snapshot.usdt
    const usdtGeneration = await rearmCoin(client, wallet, 'usdt', usdt)
    const usdtPlan = amountPlan('usdt', usdt, decimalUnits(wallet.usdt_collection_amount), decimalUnits(wallet.usdt_reserve_amount))
    if (usdtGeneration !== null && usdtPlan && shouldContinue()) {
      let resources: Resources | null = null
      let enough = trx >= 13_750_000n
      if (!enough) {
        try { resources = await readResources(fetcher, wallet.wallet_addr); enough = enoughUsdtResources(trx, resources) }
        catch { logger.error('handlecollectionwallet resource query failed for wallet ' + wallet.rid) }
      }
      if (!enough && resources) {
        const feeWallet = await client.query<{ rid: number; send_wallet: string; send_wallet_privatekey: string | null }>(
          "SELECT rid,send_wallet,send_wallet_privatekey FROM t_transit_wallet WHERE bot_rid=$1 AND send_wallet_privatekey IS NOT NULL AND length(send_wallet)=34 ORDER BY rid LIMIT 1",
          [wallet.bot_rid],
        )
        const source = feeWallet.rows[0]
        if (source) {
          const topped = await submitFeeTopup(client, fetcher, logger, wallet, source, usdtGeneration)
          if (topped) {
            await new Promise(resolve => setTimeout(resolve, 3_000))
            try {
              const refreshed = await readSnapshot(fetcher, wallet.wallet_addr)
              trx = refreshed.trx; usdt = refreshed.usdt
              await client.query('UPDATE t_collection_wallet SET trx_balance=$2,usdt_balance=$3 WHERE rid=$1', [wallet.rid, formatUnits(trx), formatUnits(usdt)])
              resources = await readResources(fetcher, wallet.wallet_addr)
              enough = enoughUsdtResources(trx, resources)
            } catch { logger.error('handlecollectionwallet post-funding check failed for wallet ' + wallet.rid) }
          }
        }
      }
      if (enough && shouldContinue()) {
        const action: Action = {
          key: encodeActionKey('usdt:' + wallet.rid + ':' + usdtGeneration + ':' + wallet.wallet_addr + ':' + wallet.collection_wallet_addr + ':' + formatUnits(usdt)),
          coin: 'usdt', walletRid: wallet.rid, from: wallet.wallet_addr, to: wallet.collection_wallet_addr,
          amount: usdtPlan.amount, balance: usdt, generation: usdtGeneration,
        }
        if (await submitTransfer(client, fetcher, logger, wallet, action, wallet.wallet_addr_privatekey, wallet.permission_id)) transferred++
      }
    }
    if (!shouldContinue()) return { transferred }
    const trxGeneration = await rearmCoin(client, wallet, 'trx', trx)
    const trxPlan = amountPlan('trx', trx, decimalUnits(wallet.trx_collection_amount), decimalUnits(wallet.trx_reserve_amount))
    if (trxGeneration !== null && trxPlan) {
      const action: Action = {
        key: encodeActionKey('trx:' + wallet.rid + ':' + trxGeneration + ':' + wallet.wallet_addr + ':' + wallet.collection_wallet_addr + ':' + formatUnits(trx)),
        coin: 'trx', walletRid: wallet.rid, from: wallet.wallet_addr, to: wallet.collection_wallet_addr,
        amount: trxPlan.amount, balance: trx, generation: trxGeneration,
      }
      if (await submitTransfer(client, fetcher, logger, wallet, action, wallet.wallet_addr_privatekey, wallet.permission_id)) transferred++
    }
    return { transferred }
  })
  return locked?.transferred ?? transferred
}
async function sendCollectionNotices(pool: Database, fetcher: typeof fetch, logger: Logger, shouldContinue: () => boolean) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !shouldContinue()) return { sent: 0, failed: 0 }
  const owner = 'collection:' + process.pid + ':' + Math.random().toString(36).slice(2)
  const client = await pool.connect()
  let sent = 0, failed = 0
  try {
    const claimed = await client.query<{ id: string; bot_rid: number; chat_id: string; message_text: string; attempts: number; max_attempts: number; bot_token: string | null }>(
      "WITH candidates AS (SELECT id,bot_rid FROM t_platform_job_outbox WHERE task_name='handlecollectionwallet' AND ((status='pending' AND next_attempt_at<=now()) OR (status='processing' AND locked_until<=now())) ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED), claimed AS (UPDATE t_platform_job_outbox o SET status='processing',attempts=o.attempts+1,lock_owner=$1,locked_until=now()+interval '60 seconds',updated_at=now() FROM candidates c WHERE o.id=c.id RETURNING o.id::text,o.bot_rid,o.chat_id,o.message_text,o.attempts,o.max_attempts) SELECT c.*,b.bot_token FROM claimed c LEFT JOIN t_telegram_bot b ON b.rid=c.bot_rid",
      [owner],
    )
    for (const item of claimed.rows) {
      if (!shouldContinue()) break
      let ok = false
      try {
        if (!item.bot_token) throw new Error('bot_token_unavailable')
        const result = await responseJson(fetcher, 'https://api.telegram.org/bot' + item.bot_token + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: item.chat_id, text: item.message_text, parse_mode: 'HTML', disable_web_page_preview: true }),
          redirect: 'error', signal: AbortSignal.timeout(12_000),
        })
        ok = result.ok === true
      } catch { ok = false }
      const release = await pool.connect()
      try {
        if (ok) {
          await release.query("UPDATE t_platform_job_outbox SET status='sent',sent_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL,last_error_code=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2", [item.id, owner])
          sent++
        } else {
          const delay = Math.min(300, 5 * 2 ** Math.max(0, item.attempts - 1))
          await release.query("UPDATE t_platform_job_outbox SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+($3*interval '1 second'),last_error_code='telegram_delivery_failed',updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2", [item.id, owner, delay])
          failed++
        }
      } finally { release.release() }
    }
    if (!shouldContinue()) await client.query("UPDATE t_platform_job_outbox SET status='pending',attempts=GREATEST(attempts-1,0),next_attempt_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE task_name='handlecollectionwallet' AND status='processing' AND lock_owner=$1", [owner])
    return { sent, failed }
  } finally { client.release() }
}
export function collectionWalletSweepPlan(input: { coin: Coin; balance: string; threshold: string; reserve: string }) {
  return packageSweepPlan(input)
}
export function collectionWalletAddressIsValid(address: string) {
  return validTronAddress(address)
}
export async function syncCollectionWallets(options: Options = {}) {
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const shouldContinue = options.shouldContinue ?? (() => true)
  const enabled = options.enabled ?? process.env.PLATFORM_COLLECTION_WALLET_ACTIONS === 'true'
  if (!shouldContinue()) return STOP
  const notices = await sendCollectionNotices(pool, fetcher, logger, shouldContinue).catch(error => {
    logger.error('handlecollectionwallet notification worker failed: ' + (error instanceof Error ? error.message : 'unknown'))
    return { sent: 0, failed: 1 }
  })
  if (!enabled) return { skipped: true, scanned: 0, transferred: 0, failed: notices.failed, noticesSent: notices.sent }
  try { signerConfig() }
  catch {
    logger.error('handlecollectionwallet signer unavailable; wallet actions skipped')
    return { skipped: true, scanned: 0, transferred: 0, failed: 1, noticesSent: notices.sent }
  }
  const result = await pool.query<Wallet>(
    "SELECT w.rid,w.bot_rid,w.wallet_addr,w.wallet_addr_privatekey,w.trx_collection_amount::text,w.usdt_collection_amount::text,w.trx_reserve_amount::text,w.usdt_reserve_amount::text,w.collection_wallet_addr,w.permission_id,w.tg_notice_obj,b.bot_token,w.trx_balance::text,w.usdt_balance::text,w.last_collection_time,w.last_collection_trx_balance::text,w.last_collection_usdt_balance::text,w.collection_trx_generation,w.collection_usdt_generation FROM t_collection_wallet w LEFT JOIN t_telegram_bot b ON b.rid=w.bot_rid WHERE w.status=0 AND length(w.wallet_addr)=34 ORDER BY w.rid LIMIT $1",
    [Math.max(1, Math.min(options.batchSize ?? 10, 50))],
  )
  let scanned = 0, transferred = 0, failed = notices.failed
  for (const wallet of result.rows) {
    if (!shouldContinue()) break
    scanned++
    try { transferred += await processWallet(pool, wallet, fetcher, logger, shouldContinue) }
    catch (error) {
      failed++
      logger.error('handlecollectionwallet failed for wallet ' + wallet.rid + ': ' + (error instanceof Error ? error.message : 'unknown'))
    }
  }
  return { skipped: false, scanned, transferred, failed, noticesSent: notices.sent }
}
