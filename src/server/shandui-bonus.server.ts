import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; sleep?: (milliseconds: number) => Promise<void> }
type Candidate = {
  rid: number; amount: string; sendback_address: string | null; transit_wallet_id: number | null
  send_wallet: string | null; send_wallet_privatekey: string | null; out_coin_name: string | null
  exchange_rate: string | null; kou_out_amount: string | null; min_transit_amount: string | null
  max_transit_amount: string | null; black_wallet: boolean
}
function cents(value: unknown): bigint | null {
  const match = String(value ?? '').trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match || String(value).length > 100) return null
  const fraction = (match[3] || '').slice(0, 2).padEnd(2, '0')
  const n = BigInt(match[2]) * 100n + BigInt(fraction || '0')
  return match[1] === '-' ? -n : n
}
function multiplyCents(left: unknown, right: unknown): bigint | null {
  const parse = (value: unknown) => {
    const text = String(value ?? '').trim()
    if (text.length > 100 || !/^-?\d+(?:\.\d+)?$/.test(text)) return null
    const negative = text.startsWith('-'), [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
    return { n: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length }
  }
  const a = parse(left), b = parse(right)
  if (!a || !b) return null
  const n = a.n * b.n, scale = a.scale + b.scale
  return scale > 2 ? n / (10n ** BigInt(scale - 2)) : n * (10n ** BigInt(2 - scale))
}
function formatCents(n: bigint) {
  const abs = n < 0n ? -n : n
  return (n < 0n ? '-' : '') + (abs / 100n) + '.' + String(abs % 100n).padStart(2, '0')
}
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
function tronAddressBytes(address: string): Buffer {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('invalid_address')
  let value = 0n
  for (const char of address) {
    const digit = BASE58_ALPHABET.indexOf(char)
    if (digit < 0) throw new Error('invalid_address')
    value = value * 58n + BigInt(digit)
  }
  let hex = value.toString(16)
  if (hex.length % 2) hex = '0' + hex
  let bytes = Buffer.from(hex, 'hex')
  let leading = 0
  while (leading < address.length && address[leading] === '1') leading++
  if (leading) bytes = Buffer.concat([Buffer.alloc(leading), bytes])
  if (bytes.length !== 25) throw new Error('invalid_address')
  const payload = bytes.subarray(0, 21)
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  if (!checksum.equals(bytes.subarray(21)) || payload[0] !== 0x41) throw new Error('invalid_address')
  return payload
}
async function tronGridBalance(fetcher: typeof fetch, address: string, coin: 'trx'|'usdt'): Promise<bigint> {
  const headers = { 'content-type': 'application/json', ...(process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {}) }
  const body = coin === 'trx' ? { address, visible: true } : {
    owner_address: address, contract_address: USDT_CONTRACT, function_selector: 'balanceOf(address)',
    parameter: tronAddressBytes(address).subarray(1).toString('hex').padStart(64, '0'), visible: true,
  }
  const path = coin === 'trx' ? '/wallet/getaccount' : '/wallet/triggerconstantcontract'
  const response = await fetcher('https://api.trongrid.io' + path, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok || !result) throw new Error('trongrid_balance_failed')
  if (coin === 'trx') {
    if (result.balance == null) return 0n
    if (!Number.isSafeInteger(result.balance) || result.balance < 0) throw new Error('trongrid_balance_invalid')
    return BigInt(result.balance)
  }
  const balance = result.constant_result?.[0]
  if (typeof balance !== 'string' || !/^[0-9a-f]{1,64}$/i.test(balance) || result.result?.result === false) throw new Error('trongrid_balance_invalid')
  return BigInt('0x' + balance)
}
async function tronScanBalance(fetcher: typeof fetch, address: string, coin: 'trx'|'usdt'): Promise<bigint> {
  const url = new URL('https://apilist.tronscanapi.com/api/accountv2')
  url.searchParams.set('address', address)
  const key = process.env.TRONSCAN_API_KEY?.trim()
  const response = await fetcher(url, { headers: key ? { 'TRON-PRO-API-KEY': key } : {}, redirect: 'error', signal: AbortSignal.timeout(12_000) })
  const result = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok || !result) throw new Error('tronscan_balance_failed')
  if (coin === 'trx') {
    const balance = String(result.balance ?? '0')
    if (!/^\d+$/.test(balance)) throw new Error('tronscan_balance_invalid')
    return BigInt(balance)
  }
  const token = Array.isArray(result.withPriceTokens) ? result.withPriceTokens.find((item: any) => item?.tokenId === USDT_CONTRACT) : null
  const balance = String(token?.balance ?? '0'), decimals = Number(token?.tokenDecimal)
  if (!/^\d+$/.test(balance) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error('tronscan_balance_invalid')
  const units = BigInt(balance)
  return decimals <= 6 ? units * (10n ** BigInt(6 - decimals)) : units / (10n ** BigInt(decimals - 6))
}
async function readBalance(
  fetcher: typeof fetch,
  address: string,
  coin: 'trx'|'usdt',
  pause: (milliseconds: number) => Promise<void>,
): Promise<bigint> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const balance = await tronGridBalance(fetcher, address, coin)
      if (balance > 0n) return balance
    } catch {
      // The legacy task retries provider errors and zero balances before using TronScan.
    }
    await pause(1_000)
  }
  return tronScanBalance(fetcher, address, coin)
}
function signerConfig() {
  const token = process.env.TRON_SIGNER_TOKEN?.trim(), base = process.env.TRON_SIGNER_URL?.trim()
  if (!token || token.length < 32 || !base) throw new Error('signer_not_configured')
  const url = new URL(base), env = (process.env.APP_ENV || 'production').toLowerCase()
  if (url.protocol !== 'https:' && !['local','dev','development'].includes(env)) throw new Error('signer_https_required')
  return { token, url }
}
async function signTransfer(fetcher: typeof fetch, row: Candidate, amount: string): Promise<{ txid: string; coin: "trx" | "usdt" }> {
  const { token, url } = signerConfig()
  if (!row.send_wallet || !row.send_wallet_privatekey || !row.sendback_address) throw new Error('wallet_not_configured')
  const coin = row.out_coin_name?.toLowerCase()
  if (coin !== 'trx' && coin !== 'usdt') throw new Error('unsupported_coin')
  const response = await fetcher(new URL('/api/internal/tron/sign', url), {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ operation: coin === 'trx' ? 'transfer_trx' : 'transfer_trc20', private_key_ciphertext: row.send_wallet_privatekey,
      from_address: row.send_wallet, to_address: row.sendback_address, amount,
      ...(coin === 'usdt' ? { contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } : {}) }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => null) as { code?: number; data?: { txid?: string } } | null
  if (!response.ok || result?.code !== 200 || !result.data?.txid) throw new Error('signer_rejected')
  return { txid: result.data.txid, coin }
}
async function claimOne(pool: Database, excluded: number[]) {
  const result = await pool.query<Candidate>(String.raw`WITH candidate AS (
    SELECT rid FROM t_transit_wallet_trade_list WHERE process_status=1 AND NOT (rid=ANY($1::int[]))
    ORDER BY rid LIMIT 1 FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE t_transit_wallet_trade_list t SET process_status=8,process_comments='转账中'
    FROM candidate c WHERE t.rid=c.rid AND t.process_status=1 RETURNING t.*
  )
  SELECT t.rid,t.amount,t.sendback_address,w.rid AS transit_wallet_id,w.send_wallet,w.send_wallet_privatekey,
    c.out_coin_name,c.exchange_rate::text AS exchange_rate,c.kou_out_amount::text AS kou_out_amount,
    c.min_transit_amount::text AS min_transit_amount,c.max_transit_amount::text AS max_transit_amount,
    EXISTS(SELECT 1 FROM t_transit_wallet_black b WHERE b.black_wallet=t.sendback_address) AS black_wallet
  FROM claimed t LEFT JOIN t_transit_wallet w ON w.receive_wallet=t.transferto_address
  LEFT JOIN t_transit_wallet_coin c ON c.transit_wallet_id=w.rid AND lower(c.in_coin_name)=lower(t.coin_name) LIMIT 1`, [excluded])
  return result.rows[0] ?? null
}
async function setStatus(pool: Database, row: Candidate, status: number, comment: string) {
  await pool.query('UPDATE t_transit_wallet_trade_list SET process_status=$2,process_comments=$3,process_time=now() WHERE rid=$1 AND process_status=8', [row.rid,status,comment])
}
async function finalize(pool: Database, row: Candidate, result: { txid: string; coin: 'trx'|'usdt' }, amount: string, rate: string, recovered: bigint) {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[row.sendback_address])
    const found = await client.query<{rid:number;total_transit_usdt:string;need_feedback_sxf:string;send_feedback_sxf:string}>(
      "SELECT rid,total_transit_usdt,need_feedback_sxf,send_feedback_sxf FROM t_transit_user_wallet WHERE chain_type='trc' AND wallet_addr=$1 ORDER BY rid LIMIT 1 FOR UPDATE",[row.sendback_address])
    if (found.rowCount) {
      const w=found.rows[0], total=cents(w.total_transit_usdt)??0n, need=cents(w.need_feedback_sxf)??0n, sent=cents(w.send_feedback_sxf)??0n
      await client.query('UPDATE t_transit_user_wallet SET total_transit_usdt=$2,last_transit_time=now(),need_feedback_sxf=$3,send_feedback_sxf=$4 WHERE rid=$1',
        [w.rid,formatCents(total+(cents(row.amount)??0n)),formatCents(need-recovered),formatCents(sent+recovered)])
    } else {
      await client.query("INSERT INTO t_transit_user_wallet(chain_type,wallet_addr,total_transit_usdt,last_transit_time) VALUES('trc',$1,$2,now())",[row.sendback_address,formatCents(cents(row.amount)??0n)])
    }
    const updated=await client.query(String.raw`UPDATE t_transit_wallet_trade_list SET process_status=9,process_time=now(),
      process_comments=$2,sendback_coin_name=$3,sendback_amount=$4,sendback_tx_hash=$5,sendback_contract_ret='SUCCESS',
      sendback_time=now(),current_exchange_rate=$6,current_huan_yuzhi_amount=$7 WHERE rid=$1 AND process_status=8`,
      [row.rid,'转账成功，扣预支:'+formatCents(recovered)+'，汇率:'+rate,result.coin,amount,result.txid,rate,formatCents(recovered)])
    if (updated.rowCount!==1) throw new Error('trade_state_conflict')
    await client.query('COMMIT')
  } catch(e) { await client.query('ROLLBACK').catch(()=>undefined); throw e }
  finally { client.release() }
}

/** Migrates HandleShanduiBonus with external chain actions opt-in only. */
export async function syncShanduiBonus(options: Options = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_TRANSIT_BONUS_ACTIONS === 'true')) return { skipped:true,processed:0,succeeded:0,failed:0 }
  const pool=options.pool??db, fetcher=options.fetcher??fetch, logger=options.logger??console, keepGoing=options.shouldContinue??(()=>true), pause=options.sleep??((milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)))
  const excluded:number[]=[], limit=Math.min(Math.max(options.batchSize??10,1),100)
  let processed=0,succeeded=0,failed=0
  for(;processed<limit&&keepGoing();processed++) {
    let row:Candidate|null
    try { row=await claimOne(pool,excluded) } catch { logger.error('shanduiBonus claim failed'); failed++; break }
    if(!row) break
    excluded.push(row.rid)
    try {
      const gross=cents(row.amount), fee=cents(row.kou_out_amount), min=cents(row.min_transit_amount), max=cents(row.max_transit_amount)
      if(!row.transit_wallet_id||!row.out_coin_name||!row.exchange_rate||gross===null||fee===null||min===null||max===null) { await setStatus(pool,row,1,'闪兑钱包币种或汇率未配置'); continue }
      if(row.black_wallet) { await setStatus(pool,row,6,'黑钱包'); continue }
      if(gross<min||gross>max) { await setStatus(pool,row,7,gross<min?'转入金额小于最低转入金额:'+row.min_transit_amount:'转入金额大于最高转入金额:'+row.max_transit_amount); continue }
      const exchange=cents(row.exchange_rate), total=multiplyCents(row.amount,row.exchange_rate)
      if(exchange===null||total===null||total<=fee) { await setStatus(pool,row,7,'计算汇率减去扣回款金额后金额无效'); continue }
      if(exchange>1000n) { await setStatus(pool,row,2,'超过最大汇率10，当前：'+row.exchange_rate); continue }
      const existing=await pool.query<{need_feedback_sxf:string}>("SELECT need_feedback_sxf FROM t_transit_user_wallet WHERE chain_type='trc' AND wallet_addr=$1 ORDER BY rid LIMIT 1",[row.sendback_address])
      let recovered=0n, amountCents=total-fee
      if(existing.rowCount) { const need=cents(existing.rows[0].need_feedback_sxf)??0n; if(need>0n){ recovered=amountCents<need?amountCents:need; amountCents-=recovered } }
      if(amountCents<=0n||amountCents*10000n>BigInt(Number.MAX_SAFE_INTEGER)) { await setStatus(pool,row,7,'返币金额格式无效'); continue }
      const amount=formatCents(amountCents)
      const coin=row.out_coin_name.toLowerCase() as 'trx'|'usdt'
      if (!row.send_wallet) throw new Error('wallet_not_configured')
      const available=await readBalance(fetcher,row.send_wallet,coin,pause)
      const required=amountCents*10000n
      if (available<required) { await setStatus(pool,row,10,'余额不足，当前:'+formatCents(available/10000n)); failed++; continue }
      const sent=await signTransfer(fetcher,row,amount)
      await finalize(pool,row,sent,amount,row.exchange_rate,recovered); succeeded++
    } catch {
      failed++
      try { await setStatus(pool,row,10,'自动转账失败，待人工核对') } catch { logger.error('shanduiBonus final state failed for trade '+row.rid) }
      logger.error('shanduiBonus failed for trade '+row.rid)
    }
  }
  return {skipped:false,processed,succeeded,failed}
}

