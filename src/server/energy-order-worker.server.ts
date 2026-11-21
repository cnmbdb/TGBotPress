import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Candidate = { rid:number; transferfrom_address:string; amount:string; bot_rid:number; energy_platform_bot_rid:number; per_bishu_usdt_price:string; bishu_stop_day:number }
type Existing = { rid:number; status:number; is_buy:string; total_buy_usdt:string; max_buy_quantity:number; total_buy_quantity:number; bishu_stop_day:number }
type Options = { pool?:Database; logger?:Logger; shouldContinue?:()=>boolean; enabled?:boolean; batchSize?:number }
const STOP=()=>true

async function processTrade(client:PoolClient,row:Candidate) {
  const count=await client.query<{quantity:string}>(
    'SELECT floor($1::numeric / NULLIF($2::numeric,0))::integer::text AS quantity WHERE $1::numeric > 0 AND $2::numeric > 0',
    [row.amount,row.per_bishu_usdt_price],
  )
  const quantity=Number(count.rows[0]?.quantity)
  if(!Number.isSafeInteger(quantity)||quantity<1) {
    await client.query("UPDATE t_energy_wallet_trade_list SET process_status=4,process_comments='笔数套餐金额或单价无效',process_time=now() WHERE rid=$1 AND process_status=8",[row.rid])
    return false
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.transferfrom_address])
  const existing=await client.query<Existing>(
    'SELECT rid,status,is_buy,total_buy_usdt::text,total_buy_quantity,max_buy_quantity,bishu_stop_day FROM t_energy_ai_bishu WHERE wallet_addr=$1 ORDER BY rid LIMIT 1 FOR UPDATE',
    [row.transferfrom_address],
  )
  if(existing.rows[0]) {
    const address=existing.rows[0]
    const isBuy=address.total_buy_quantity===address.max_buy_quantity?'Y':address.status===1?'Y':address.is_buy
    await client.query(
      "UPDATE t_energy_ai_bishu SET is_buy=$2,total_buy_usdt=total_buy_usdt+$3::numeric,max_buy_quantity=max_buy_quantity+$4,status=CASE WHEN status=1 THEN 0 ELSE status END,bishu_stop_day=CASE WHEN $5>0 AND bishu_stop_day<$5 THEN $5 ELSE bishu_stop_day END,update_time=now() WHERE rid=$1",
      [address.rid,isBuy,row.amount,quantity,row.bishu_stop_day],
    )
  } else {
    await client.query(
      "INSERT INTO t_energy_ai_bishu(bot_rid,tg_uid,wallet_addr,status,total_buy_usdt,max_buy_quantity,create_by,create_time,is_buy,bishu_stop_day,is_active) VALUES($1,'',$2,0,$3::numeric,$4,0,now(),'Y',$5,'N')",
      [row.bot_rid,row.transferfrom_address,row.amount,quantity,row.bishu_stop_day],
    )
  }
  await client.query(
    "UPDATE t_energy_wallet_trade_list SET process_status=9,process_comments='成功,笔数套餐增加：'||$2::text,process_time=now(),energy_platform_bot_rid=$3,tg_notice_status_send='N' WHERE rid=$1 AND process_status=8",
    [row.rid,quantity,row.energy_platform_bot_rid],
  )
  return true
}

export async function syncEnergyOrder(options:Options={}) {
  if(!(options.enabled??process.env.PLATFORM_ENERGY_ORDER_ACTIONS==='true')) return {skipped:true,scanned:0,succeeded:0,failed:0}
  const pool=options.pool??db, logger=options.logger??console, shouldContinue=options.shouldContinue??STOP
  const batchSize=Math.max(1,Math.min(100,Math.floor(options.batchSize??20)))
  let scanned=0,succeeded=0,failed=0
  for(let i=0;i<batchSize&&shouldContinue();i++) {
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const claim=await client.query<Candidate>(
        "SELECT a.rid,a.transferfrom_address,a.amount,b.bot_rid,b.rid AS energy_platform_bot_rid,b.per_bishu_usdt_price,b.bishu_stop_day FROM t_energy_wallet_trade_list a JOIN t_energy_platform_bot b ON a.transferto_address=b.receive_wallet WHERE a.process_status=1 AND lower(a.coin_name)='usdt' ORDER BY a.rid LIMIT 1 FOR UPDATE OF a SKIP LOCKED",
      )
      const row=claim.rows[0]
      if(!row) { await client.query('ROLLBACK'); break }
      scanned++
      await client.query("UPDATE t_energy_wallet_trade_list SET process_status=8,process_comments='笔数套餐处理中' WHERE rid=$1 AND process_status=1",[row.rid])
      if(!shouldContinue()) { await client.query('ROLLBACK'); break }
      if(await processTrade(client,row)) succeeded++
      else failed++
      await client.query('COMMIT')
    } catch {
      try { await client.query('ROLLBACK') } catch {}
      failed++
      logger.error('energyOrder transaction failed')
      break
    } finally { client.release() }
  }
  return {skipped:false,scanned,succeeded,failed}
}
