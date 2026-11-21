import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'
import { placeOrder, placeBishuCountOrder, recoverBishuEnergy, type Platform } from './ai-energy-order-worker.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type BishuRow = {
  rid:number; bot_rid:number; tg_uid:string; wallet_addr:string; max_buy_quantity:number; total_buy_quantity:number
  total_buy_energy_quantity:number; per_bishu_energy_quantity:number; per_energy_day_bishu:number; is_notice:string; is_notice_admin:string
  poll_group:string; energy_platform_bot_rid:number; bot_status:number; is_active:string; is_open_bishu:string
  recovery_type:number; dealer_type:number; agent_tg_uid:string|null; agent_per_price:string|null
}
type Options = { pool?:Database; fetcher?:typeof fetch; logger?:Logger; shouldContinue?:()=>boolean; enabled?:boolean; batchSize?:number; now?:()=>number }
type PackageResult = { kind:'success'; value:{orderId:string; useTrx:string}; platformNoOrder?:boolean } | { kind:'rejected'; message:string }
const allowedDays = new Set([0,1,3,30])

async function claim(pool:Database, keepGoing:()=>boolean):Promise<BishuRow|null> {
  if(!keepGoing()) return null
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const result=await client.query<BishuRow>("SELECT a.rid,a.bot_rid,a.tg_uid::text,a.wallet_addr,a.max_buy_quantity,a.total_buy_quantity,a.total_buy_energy_quantity,b.per_bishu_energy_quantity,b.per_energy_day_bishu,a.is_notice,a.is_notice_admin,b.poll_group,b.rid AS energy_platform_bot_rid,b.status AS bot_status,a.is_active,b.is_open_bishu,b.bishu_recovery_type AS recovery_type,b.bishu_daili_type AS dealer_type,b.agent_tg_uid::text,b.agent_per_price::text FROM t_energy_ai_bishu a JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid WHERE a.is_buy='Y' AND a.status=0 AND a.is_active='Y' AND b.is_open_bishu='Y' AND b.status=0 AND b.per_bishu_energy_quantity>=65000 AND a.max_buy_quantity>a.total_buy_quantity ORDER BY a.rid LIMIT 1 FOR UPDATE OF a SKIP LOCKED")
    const row=result.rows[0]
    if(!row){await client.query('ROLLBACK');return null}
    await client.query("UPDATE t_energy_ai_bishu SET is_buy='B',update_time=now() WHERE rid=$1 AND is_buy='Y'",[row.rid])
    await client.query('COMMIT')
    return row
  } catch(error){await client.query('ROLLBACK');throw error} finally{client.release()}
}
async function update(pool:Database,row:BishuRow,values:{isBuy?:'Y'|'N';message:string;notify?:boolean}) {
  await pool.query("UPDATE t_energy_ai_bishu SET is_buy=COALESCE($2,is_buy),comments=$3,is_notice_admin=CASE WHEN $4 THEN 'Y' ELSE is_notice_admin END,update_time=now() WHERE rid=$1 AND is_buy='B'",[row.rid,values.isBuy??null,values.message.slice(0,1800),values.notify??false])
}
function packageCount(row:BishuRow){return Math.max(0,row.max_buy_quantity-row.total_buy_quantity)}
function multiplication(value:string,count:number){
  if(!/^\d+(?:\.\d{1,6})?$/.test(value)) return null
  const [whole,fraction='']=value.split('.'),units=BigInt(whole)*1_000_000n+BigInt((fraction+'000000').slice(0,6))
  const total=units*BigInt(count),integer=total/1_000_000n,decimal=(total%1_000_000n).toString().padStart(6,'0').replace(/0+$/,'')
  return decimal?`${integer}.${decimal}`:String(integer)
}
async function checkAgent(pool:Database,row:BishuRow,count:number){
  if(!row.agent_tg_uid)return {fee:null as string|null,error:null as string|null}
  const fee=row.agent_per_price??''
  const required=multiplication(fee,count)
  if(!required||Number(fee)<=0)return {fee:null,error:'代理地址对应用户未设置有效每笔金额'}
  const user=await pool.query<{rid:number;enough:boolean}>('SELECT rid,cash_trx >= $3::numeric AS enough FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2',[row.bot_rid,row.agent_tg_uid,required])
  if(!user.rowCount)return {fee:null,error:'代理用户未关注该机器人，无法扣款'}
  if(!user.rows[0].enough)return {fee:null,error:`代理用户 TRX 余额不足，需要 ${required}`}
  return {fee:required,error:null}
}
async function platforms(pool:Database,row:BishuRow,mode:number):Promise<Platform[]>{
  if(mode===2)return (await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_name=4 AND platform_apikey IS NOT NULL AND platform_balance>0 ORDER BY seq_sn DESC,rid",[row.poll_group])).rows
  if(mode===3)return (await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_name=6 AND platform_apikey IS NOT NULL AND platform_balance>0 ORDER BY seq_sn DESC,rid",[row.poll_group])).rows
  if(mode===4)return (await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_name=7 AND platform_apikey IS NOT NULL AND platform_balance>0 ORDER BY seq_sn DESC,rid",[row.poll_group])).rows
  return (await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_apikey IS NOT NULL AND ((platform_name=3 AND platform_balance >= $2) OR (platform_name IN (1,2,4,5,6) AND platform_balance>0)) ORDER BY random() LIMIT 100",[row.poll_group,row.per_bishu_energy_quantity])).rows
}
async function saveSuccess(pool:Database,row:BishuRow,platform:Platform,result:{orderId:string;useTrx:string},fee:string|null,mode:number,allRemaining:boolean,recordOrder:boolean,now:()=>number){
  const client=await pool.connect();let accountingIssue=false
  try{
    await client.query('BEGIN')
    const locked=await client.query("SELECT rid FROM t_energy_ai_bishu WHERE rid=$1 AND is_buy='B' FOR UPDATE",[row.rid])
    if(!locked.rowCount)throw new Error('AI_BISHU_CLAIM_STATE_CHANGED')
    if(recordOrder)await client.query('INSERT INTO t_energy_platform_order(energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,receive_address,platform_order_id,energy_amount,energy_day,energy_time,source_type,recovery_status,use_trx) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),4,$9,$10::numeric)',[platform.rid,row.energy_platform_bot_rid,platform.platform_name,platform.platform_uid,row.wallet_addr,result.orderId,row.per_bishu_energy_quantity,mode===4?0:row.per_energy_day_bishu,Number(platform.platform_name)===3?2:1,result.useTrx])
    if(fee&&row.agent_tg_uid){const debited=await client.query('UPDATE t_telegram_bot_user SET cash_trx=cash_trx-$3::numeric WHERE bot_rid=$1 AND tg_uid=$2 AND cash_trx >= $3::numeric RETURNING rid',[row.bot_rid,row.agent_tg_uid,fee]);accountingIssue=!debited.rowCount}
    const nextCount=allRemaining?row.max_buy_quantity:row.total_buy_quantity+1
    const shouldAddEnergy=mode===1||mode===4
    const message=accountingIssue?'SUCCESS；供应商已下单，代理余额扣款需人工核对':'SUCCESS '+new Date(now()).toISOString()
    await client.query("UPDATE t_energy_ai_bishu SET is_buy='N',comments=$2,is_notice=CASE WHEN $3 AND is_notice='N' THEN 'Y' WHEN NOT $3 THEN 'N' ELSE is_notice END,is_notice_admin=CASE WHEN $4 THEN 'Y' ELSE is_notice_admin END,total_buy_energy_quantity=total_buy_energy_quantity+CASE WHEN $9 THEN $5::bigint ELSE 0 END,total_buy_quantity=CASE WHEN $6 THEN max_buy_quantity ELSE total_buy_quantity+1 END,energy_platform_rid=CASE WHEN $7 THEN $8 ELSE energy_platform_rid END,last_energy_time=CASE WHEN $9 THEN now() ELSE last_energy_time END,update_time=now() WHERE rid=$1",[row.rid,message,shouldAddEnergy,accountingIssue,row.per_bishu_energy_quantity,allRemaining,mode===2||mode===3,platform.rid,shouldAddEnergy])
    await client.query('COMMIT')
    return accountingIssue
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
async function runOne(pool:Database,fetcher:typeof fetch,row:BishuRow,keepGoing:()=>boolean,logger:Logger,now:()=>number){
  const mode=Number(row.dealer_type),remaining=packageCount(row)
  if(row.bot_status!==0||row.is_open_bishu!=='Y'||row.is_active!=='Y'){await update(pool,row,{isBuy:'N',message:'笔数能量或机器人未启用'});return 'failed' as const}
  if(!allowedDays.has(row.per_energy_day_bishu)||!Number.isSafeInteger(row.per_bishu_energy_quantity)||row.per_bishu_energy_quantity<65000||remaining<=0){await update(pool,row,{isBuy:'N',message:'笔数能量数量、时长或剩余次数无效',notify:true});return 'failed' as const}
  if(![1,2,3,4].includes(mode)){await update(pool,row,{isBuy:'N',message:'未知的笔数代理模式',notify:true});return 'failed' as const}
  const chargeCount=(mode===2||mode===3)?remaining:1
  const agent=await checkAgent(pool,row,chargeCount)
  if(agent.error){await update(pool,row,{isBuy:'Y',message:agent.error});return 'failed' as const}
  if(mode===1&&row.recovery_type===2){
    try{await recoverBishuEnergy(pool,fetcher,row)}catch{logger.error('AI bishu previous energy recovery failed for row '+row.rid)}
  }
  const candidates=await platforms(pool,row,mode)
  if(!candidates.length){await update(pool,row,{isBuy:'Y',message:'无可用能量平台，请检查平台余额或配置'});return 'failed' as const}
  const errors:string[]=[]
  for(const platform of candidates){
    if(!keepGoing()){await update(pool,row,{isBuy:'Y',message:'TanStack worker 停止，订单可重试'});return 'failed' as const}
    let result:PackageResult
    try{
      if(mode===2)result=await placeBishuCountOrder(fetcher,platform,row.wallet_addr,remaining,'trongas',now)
      else if(mode===3)result=await placeBishuCountOrder(fetcher,platform,row.wallet_addr,remaining,'sohu',now)
      else if(mode===1&&Number(platform.platform_name)===5)result=await placeBishuCountOrder(fetcher,platform,row.wallet_addr,remaining,'developer',now)
      else {
        const energyDay=mode===4?0:(Number(platform.platform_name)===3?row.per_energy_day_bishu:(row.per_energy_day_bishu>=30?1:row.per_energy_day_bishu))
        result=await placeOrder(fetcher,{energy_amount:row.per_bishu_energy_quantity,energy_day:energyDay,wallet_addr:row.wallet_addr},platform,now,mode===1?'bishu':'standard')
      }
    }catch{
      logger.error('AI bishu supplier result is ambiguous; manual review required for row '+row.rid)
      await update(pool,row,{isBuy:'N',message:'供应商请求结果不确定，请人工核查；禁止自动重试',notify:true})
      return 'manual' as const
    }
    if(result.kind==='rejected'){errors.push('平台 '+platform.rid+'：'+result.message);continue}
    try{
      const allRemaining=(mode===2||mode===3||(mode===1&&Number(platform.platform_name)===5))
      const recordOrder=mode===4||(mode===1&&Number(platform.platform_name)!==5)
      const fee=agent.fee
      const accountingIssue=await saveSuccess(pool,row,platform,result.value,fee,mode,allRemaining,recordOrder,now)
      if(accountingIssue)logger.error('AI bishu supplier succeeded but agent debit requires reconciliation for row '+row.rid)
      return accountingIssue?'manual':'succeeded'
    }catch{
      logger.error('AI bishu supplier succeeded but local accounting needs manual reconciliation for row '+row.rid)
      await update(pool,row,{isBuy:'N',message:'供应商已下单但本地记账失败，请人工核查；禁止自动重试',notify:true}).catch(()=>undefined)
      return 'manual' as const
    }
  }
  await update(pool,row,{isBuy:'N',message:errors.join('；')||'能量平台下单失败',notify:true})
  return 'failed' as const
}

/** Migrates activated AI count-package purchases across legacy provider modes 1-7. */
export async function syncAiBishuOrders(options:Options={}){
  if(!(options.enabled??process.env.PLATFORM_ENERGY_ORDER_ACTIONS==='true'))return {skipped:true,scanned:0,succeeded:0,failed:0,manual:0}
  const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,keepGoing=options.shouldContinue??(()=>true),now=options.now??Date.now
  let scanned=0,succeeded=0,failed=0,manual=0
  const batchSize=Math.max(1,Math.min(20,Math.floor(options.batchSize??5)))
  try{await pool.query("UPDATE t_energy_ai_bishu SET is_buy='N',is_notice_admin='Y',comments='下单进程中断，供应商结果不确定，请人工核查',update_time=now() WHERE is_buy='B' AND COALESCE(update_time,create_time)<now()-interval '5 minutes'")}catch{logger.error('AI bishu stale claims could not be reconciled');return {skipped:false,scanned:0,succeeded:0,failed:1,manual:1}}
  for(let i=0;i<batchSize&&keepGoing();i++){
    let row:BishuRow|null
    try{row=await claim(pool,keepGoing)}catch{logger.error('AI bishu order claim failed');failed++;break}
    if(!row)break
    scanned++
    try{const result=await runOne(pool,fetcher,row,keepGoing,logger,now);if(result==='succeeded')succeeded++;else if(result==='manual')manual++;else failed++}
    catch{logger.error('AI bishu order processing failed for row '+row.rid);await update(pool,row,{isBuy:'Y',message:'下单流程异常，订单已释放，可重试'}).catch(()=>undefined);failed++}
  }
  return {skipped:false,scanned,succeeded,failed,manual}
}
