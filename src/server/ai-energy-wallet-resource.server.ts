import type { Pool } from 'pg'
import { db } from './db.server'
import { parseTronscanAccountResource } from './ai-trusteeship-resource.server'

type Queryable = Pick<Pool, 'query'>
type Resource = { bandwidth: number; energy: number }
type Candidate = { kind: 'trusteeship' | 'bishu'; rid: number; wallet_addr: string; target_energy: number | string }
type GridResponse = { freeNetLimit?: unknown; NetLimit?: unknown; NetUsed?: unknown; EnergyLimit?: unknown; EnergyUsed?: unknown }
export type AiEnergyResourceOptions = {
  pool?: Queryable; fetcher?: typeof fetch; logger?: Pick<Console, 'error'>; shouldContinue?: () => boolean
  enabled?: boolean; allowPurchaseTrigger?: boolean; tronscanApiKey?: string; tronGridApiKey?: string; delayMs?: number
}
const empty = () => ({ checked: 0, updated: 0, failed: 0, skipped: 0 })
function integer(value: unknown, fallback?: number): number | null {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
export function parseTronGridAccountResource(value: unknown): Resource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as GridResponse
  const free = integer(body.freeNetLimit), net = integer(body.NetLimit, 0), used = integer(body.NetUsed, 0)
  const energy = integer(body.EnergyLimit, 0), energyUsed = integer(body.EnergyUsed, 0)
  if (free === null || net === null || used === null || energy === null || energyUsed === null) return null
  return { bandwidth: Math.max(0, net + free - used), energy: Math.max(0, energy - energyUsed) }
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function getResource(wallet: string, fetcher: typeof fetch, options: AiEnergyResourceOptions): Promise<Resource | null> {
  try {
    const url = new URL('https://apilist.tronscanapi.com/api/accountv2')
    url.searchParams.set('address', wallet)
    const headers: Record<string,string> = { Accept: 'application/json' }
    if (options.tronscanApiKey) headers['TRON-PRO-API-KEY'] = options.tronscanApiKey
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10000) })
    if (response.ok) {
      const parsed = parseTronscanAccountResource(await response.json())
      if (parsed) return parsed
    }
  } catch { /* fallback to TronGrid */ }
  try {
    const headers: Record<string,string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (options.tronGridApiKey) headers['TRON-PRO-API-KEY'] = options.tronGridApiKey
    const response = await fetcher('https://api.trongrid.io/wallet/getaccountresource', {
      method: 'POST', headers, body: JSON.stringify({ address: wallet, visible: true }),
      signal: AbortSignal.timeout(10000),
    })
    return response.ok ? parseTronGridAccountResource(await response.json()) : null
  } catch { return null }
}
export async function refreshAiEnergyWalletResources(options: AiEnergyResourceOptions = {}) {
  if (options.enabled !== true) return empty()
  const pool=options.pool ?? db, fetcher=options.fetcher ?? fetch, logger=options.logger ?? console
  const trusteeship=await pool.query<Candidate>([
    "SELECT 'trusteeship'::text kind,a.rid,a.wallet_addr,a.min_energy_quantity target_energy",
    'FROM t_energy_ai_trusteeship a JOIN t_telegram_bot b ON b.rid=a.bot_rid',
    'JOIN t_energy_platform_bot c ON c.bot_rid=a.bot_rid',
    'JOIN telegram_bot_user d ON d.bot_rid=a.bot_rid AND d.tg_uid=a.tg_uid',
    "WHERE a.status=0 AND c.is_open_ai_trusteeship='Y' AND length(a.wallet_addr)=34",
    'AND d.cash_trx>c.trx_price_energy_32000 AND (a.max_buy_quantity=0 OR a.total_buy_quantity<a.max_buy_quantity)',
    'ORDER BY a.rid',
  ].join(' '))
  const bishu=await pool.query<Candidate>([
    "SELECT 'bishu'::text kind,a.rid,a.wallet_addr,c.per_bishu_energy_quantity target_energy",
    'FROM t_energy_ai_bishu a JOIN t_telegram_bot b ON b.rid=a.bot_rid',
    'JOIN t_energy_platform_bot c ON c.bot_rid=a.bot_rid',
    "WHERE a.status=0 AND c.is_open_bishu='Y' AND a.is_buy='N' AND length(a.wallet_addr)=34",
    'AND a.max_buy_quantity>a.total_buy_quantity ORDER BY a.rid',
  ].join(' '))
  const rows=[...trusteeship.rows,...bishu.rows]
  if (!rows.length) return empty()
  let next=0, updated=0, failed=0, skipped=0, stopped=false
  const workers=Array.from({length:Math.min(5,rows.length)},async()=>{
    while(next<rows.length){
      if(options.shouldContinue&&!options.shouldContinue()){stopped=true;return}
      const row=rows[next++]
      if((options.delayMs??1000)>0) await pause(options.delayMs??1000)
      if(options.shouldContinue&&!options.shouldContinue()){stopped=true;skipped++;return}
      const target=integer(row.target_energy)
      if(target===null){skipped++;continue}
      try{
        const resource=await getResource(row.wallet_addr,fetcher,options)
        if(!resource){failed++;continue}
        const margin=target>=131000?700:100, table=row.kind==='trusteeship'?'t_energy_ai_trusteeship':'t_energy_ai_bishu'
        const result=await pool.query(
          ['UPDATE '+table,'SET current_bandwidth_quantity=$2,current_energy_quantity=$3,',
           "is_buy=CASE WHEN $5::boolean AND is_buy='N' AND $3::bigint<GREATEST(0::bigint,$4::bigint-$6::bigint) THEN 'Y' ELSE is_buy END",
           'WHERE rid=$1 AND status=0'].join(' '),
          [row.rid,resource.bandwidth,resource.energy,target,options.allowPurchaseTrigger===true,margin])
        if(result.rowCount) updated++; else skipped++
      }catch{
        failed++; logger.error('AI energy resource refresh failed for record '+row.rid)
      }
    }
  })
  await Promise.all(workers)
  if(stopped) skipped+=Math.max(0,rows.length-next)
  return {checked:rows.length,updated,failed,skipped}
}
