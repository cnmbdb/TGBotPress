import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number }
type Special = { rid:number; bot_rid:number|null; tg_uid:string|null; wallet_addr:string; wallet_energy:string; max_energy:string; send_energy:string; per_energy:string; less_than_energy:string; status:number; bot_token:string|null }
type ListRow = { rid:number; wallet_addr:string; send_wallet_addr:string; daili_trx:string|null }
type Platform = { rid:number; platform_uid:string|null; platform_apikey:string|null; permission_id:number; platform_balance:string; tg_notice_obj:string|null }
type Json = Record<string,unknown>
const API_TIMEOUT=12_000
const SIGN_TIMEOUT=30_000
const MIN_SUN=1_000_000n

export function energyStakeSun(energy: bigint,totalEnergyWeight:bigint,totalEnergyLimit:bigint):bigint {
 if(energy<=0n||totalEnergyWeight<=0n||totalEnergyLimit<=0n)throw new Error('invalid_energy_ratio')
 const estimate=(energy*totalEnergyWeight*MIN_SUN+totalEnergyLimit-1n)/totalEnergyLimit
 return estimate<MIN_SUN?MIN_SUN:estimate
}
function trxAmount(sun:bigint){return (sun/MIN_SUN)+'.'+String(sun%MIN_SUN).padStart(6,'0')}
function parseTrx(value:unknown):bigint|null {
 const match=String(value??'').trim().match(/^(\d{1,12})(?:\.(\d{1,6}))?$/)
 return match?BigInt(match[1])*MIN_SUN+BigInt((match[2]??'').padEnd(6,'0')):null
}
function jsonObject(value:unknown):Json|null {
 if(typeof value==='string'){try{value=JSON.parse(value)}catch{return null}}
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:null
}
function html(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
function signerConfig(){
 const token=process.env.TRON_SIGNER_TOKEN?.trim(),base=process.env.TRON_SIGNER_URL?.trim()
 if(!token||token.length<32||!base)throw new Error('signer_not_configured')
 const url=new URL(base),environment=(process.env.APP_ENV||'production').toLowerCase()
 if(url.protocol!=='https:'&&!['local','dev','development'].includes(environment))throw new Error('signer_https_required')
 return {token,url}
}
function tronHeaders(){return {'Content-Type':'application/json',...(process.env.TRONGRID_API_KEY?{'TRON-PRO-API-KEY':process.env.TRONGRID_API_KEY}:{})}}
async function postTron(fetcher:typeof fetch,path:string,body:Record<string,unknown>){
 const response=await fetcher('https://api.trongrid.io'+path,{method:'POST',headers:tronHeaders(),body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(API_TIMEOUT)})
 const result=await response.json().catch(()=>null) as Json|null
 if(!response.ok||!result||result.Error)throw new Error('trongrid_response_invalid')
 return result
}
async function resourceEnergy(fetcher:typeof fetch,address:string):Promise<bigint>{
 let scanEnergy:bigint|null=null
 try{
  const url=new URL('https://apilist.tronscanapi.com/api/accountv2');url.searchParams.set('address',address)
  const key=process.env.TRONSCAN_API_KEY?.trim()
  const response=await fetcher(url,{headers:key?{'TRON-PRO-API-KEY':key}:{},redirect:'error',signal:AbortSignal.timeout(API_TIMEOUT)})
  const body=await response.json().catch(()=>null) as Json|null
  if(response.ok&&body?.activated===true){
   const remaining=jsonObject(body.bandwidth)?.energyRemaining
   if(typeof remaining==='number'&&Number.isSafeInteger(remaining)&&remaining>=0)scanEnergy=BigInt(remaining)
  }
 }catch{}
 if(scanEnergy!==null)return scanEnergy
 const account=await postTron(fetcher,'/wallet/getaccount',{address,visible:true})
 if(typeof account.address!=='string'||account.address.length===0)throw new Error('recipient_not_activated')
 const body=await postTron(fetcher,'/wallet/getaccountresource',{address,visible:true})
 const limit=BigInt(String(body.EnergyLimit??0)),used=BigInt(String(body.EnergyUsed??0))
 if(limit<0n||used<0n)throw new Error('invalid_energy_resource')
 return limit>used?limit-used:0n
}
async function requiredStake(fetcher:typeof fetch,address:string,energy:bigint){
 const resource=await postTron(fetcher,'/wallet/getaccountresource',{address,visible:true})
 const limit=BigInt(String(resource.TotalEnergyLimit??0)),weight=BigInt(String(resource.TotalEnergyWeight??0))
 const sun=energyStakeSun(energy,weight,limit)
 const maximum=await postTron(fetcher,'/wallet/getcandelegatedmaxsize',{owner_address:address,type:1,visible:true})
 const maxSun=BigInt(String(maximum.max_size??0))
 if(maxSun<sun)throw new Error('insufficient_delegatable_energy')
 return sun
}
async function signResource(fetcher:typeof fetch,platform:Platform,target:string,sun:bigint,operation:'delegate_resource'|'undelegate_resource'){
 if(!platform.platform_uid||!platform.platform_apikey)throw new Error('platform_key_unavailable')
 const {token,url}=signerConfig()
 const response=await fetcher(new URL('/api/internal/tron/sign',url),{
  method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify({operation,private_key_ciphertext:platform.platform_apikey,from_address:platform.platform_uid,to_address:target,amount:trxAmount(sun),resource_type:'ENERGY',permission_id:platform.permission_id}),
  redirect:'error',signal:AbortSignal.timeout(SIGN_TIMEOUT),
 })
 const result=await response.json().catch(()=>null) as {code?:number;data?:{txid?:string}}|null
 if(!response.ok||result?.code!==200||!result.data?.txid)throw new Error('signer_result_ambiguous')
 return result.data.txid
}
async function withSpecialLock<T>(pool:Database,rid:number,run:(client:PoolClient)=>Promise<T>):Promise<T|null>{
 const client=await pool.connect()
 try{
  const lock=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['energy-special:'+rid])
  if(!lock.rows[0]?.locked)return null
  try{return await run(client)}finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['energy-special:'+rid])}
 }finally{client.release()}
}
async function loadSpecial(client:PoolClient,rid:number){
 const result=await client.query<Special>("SELECT a.rid,a.bot_rid,a.tg_uid::text,a.wallet_addr,a.wallet_energy::text,a.max_energy::text,a.send_energy::text,a.per_energy::text,a.less_than_energy::text,a.status,b.bot_token FROM t_energy_special a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE a.rid=$1 AND a.status=1",[rid])
 return result.rows[0]??null
}
async function claimAction(client:PoolClient,values:{key:string;type:'delegate'|'recover';source:number;special:number;platform:number;amount:string;energy:number|null;target:string}){
 await client.query('BEGIN')
 try{
  const insert=await client.query("INSERT INTO t_platform_energy_special_action(idempotency_key,action_type,source_rid,energy_special_rid,energy_platform_rid,amount_trx,energy_amount,target_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",[values.key,values.type,values.source,values.special,values.platform,values.amount,values.energy,values.target])
  if(insert.rowCount){await client.query('COMMIT');return true}
  const found=await client.query<{id:string;state:string;updated_at:Date|string}>('SELECT id::text,state,updated_at FROM t_platform_energy_special_action WHERE idempotency_key=$1 FOR UPDATE',[values.key])
  const action=found.rows[0],age=action?Date.now()-new Date(action.updated_at).getTime():0
  if(action&&(action.state==='retryable'||(action.state==='claimed'&&age>90_000))){await client.query("UPDATE t_platform_energy_special_action SET state='claimed',attempts=attempts+1,error_code=NULL,updated_at=now() WHERE id=$1",[action.id]);await client.query('COMMIT');return true}
  if(action?.state==='signing'&&age>300_000)await client.query("UPDATE t_platform_energy_special_action SET state='manual',error_code='signer_result_unknown',updated_at=now() WHERE id=$1",[action.id])
  await client.query('COMMIT');return false
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}
}
async function actionState(client:PoolClient,key:string,state:'signing'|'succeeded'|'retryable'|'manual',error:string|null=null,txid:string|null=null){
 await client.query('UPDATE t_platform_energy_special_action SET state=$2,error_code=$3,tx_hash=$4,updated_at=now() WHERE idempotency_key=$1',[key,state,error,txid])
}
async function queueNotice(client:PoolClient,botRid:number,chatId:string,text:string,key:string){
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return
 await client.query("INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) VALUES('handleenergyspecial',$1,'energy_special',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",[key,key,botRid,chatId,text])
}
async function finalizeRecovery(client:PoolClient,listRid:number,key:string,txid:string){
 await client.query('BEGIN')
 try{await client.query('UPDATE t_energy_special_list SET status=2,huishou_time=now(),huishou_hash=$2 WHERE rid=$1 AND status=1',[listRid,txid]);await actionState(client,key,'succeeded',null,txid);await client.query('COMMIT')}
 catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}
}
async function recoverLists(client:PoolClient,special:Special,fetcher:typeof fetch,logger:Logger){
 const rows=await client.query<ListRow>("SELECT rid,wallet_addr,send_wallet_addr,daili_trx::text FROM t_energy_special_list WHERE status=1 AND wallet_addr=$1 ORDER BY rid LIMIT 20",[special.wallet_addr])
 let recovered=0
 for(const row of rows.rows){
  const listAmount=parseTrx(row.daili_trx)
  if(!listAmount)continue
  const found=await client.query<Platform>("SELECT rid,platform_uid,platform_apikey,permission_id,platform_balance::text,tg_notice_obj FROM t_energy_platform WHERE platform_name=3 AND platform_uid=$1 AND platform_apikey IS NOT NULL ORDER BY rid LIMIT 1",[row.send_wallet_addr])
  const platform=found.rows[0];if(!platform?.platform_uid||!platform.platform_apikey)continue
  try{signerConfig()}catch{logger.error('handleenergyspecial signer unavailable for recovery platform '+platform.rid);continue}
  const key='recover:'+row.rid,amount=trxAmount(listAmount)
  if(!await claimAction(client,{key,type:'recover',source:row.rid,special:special.rid,platform:platform.rid,amount,energy:null,target:row.wallet_addr}))continue
  await actionState(client,key,'signing')
  try{const txid=await signResource(fetcher,platform,row.wallet_addr,listAmount,'undelegate_resource');await finalizeRecovery(client,row.rid,key,txid);recovered++}
  catch{await actionState(client,key,'manual','signer_result_unknown');logger.error('handleenergyspecial recovery requires reconciliation for list '+row.rid)}
 }
 return recovered
}
async function finalizeDelegation(client:PoolClient,special:Special,platform:Platform,energy:number,sun:bigint,key:string,txid:string){
 await client.query('BEGIN')
 try{
  const current=await client.query<{send_energy:string;status:number;wallet_addr:string}>("SELECT send_energy::text,status,wallet_addr FROM t_energy_special WHERE rid=$1 FOR UPDATE",[special.rid])
  const row=current.rows[0]
  if(!row||row.status!==1||row.wallet_addr!==special.wallet_addr||row.send_energy!==special.send_energy){await actionState(client,key,'manual','special_changed_after_broadcast',txid);await client.query('COMMIT');return false}
  const update=await client.query('UPDATE t_energy_special SET send_energy=send_energy+$2 WHERE rid=$1 AND send_energy=$3 AND status=1 RETURNING rid',[special.rid,energy,special.send_energy])
  if(update.rowCount!==1)throw new Error('special_update_conflict')
  const amount=trxAmount(sun)
  await client.query('INSERT INTO t_energy_special_list(bot_rid,tg_uid,send_wallet_addr,wallet_addr,before_energy,daili_energy,daili_hash,daili_trx,status,daili_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,now())',[special.bot_rid,special.tg_uid,platform.platform_uid,special.wallet_addr,special.wallet_energy,energy,txid,amount])
  await actionState(client,key,'succeeded',null,txid)
  if(special.bot_rid&&special.tg_uid){const left=Math.max(0,Number(special.max_energy)-Number(special.send_energy)-energy);await queueNotice(client,special.bot_rid,special.tg_uid,'地址：<code>'+html(special.wallet_addr)+'</code>\n本次代理能量：'+energy+'\n剩余可代理能量：'+left,'handleenergyspecial:'+key+':user')}
  await client.query('COMMIT');return true
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}
}
async function processOne(pool:Database,rid:number,fetcher:typeof fetch,logger:Logger,shouldContinue:()=>boolean){
 return withSpecialLock(pool,rid,async client=>{
  const special=await loadSpecial(client,rid);if(!special||!shouldContinue())return {delegated:0,recovered:0}
  let available:bigint
  try{available=await resourceEnergy(fetcher,special.wallet_addr)}catch{logger.error('handleenergyspecial resource query failed for special '+rid);return {delegated:0,recovered:0}}
  await client.query('UPDATE t_energy_special SET wallet_energy=$2 WHERE rid=$1 AND status=1',[rid,available.toString()])
  if(available>=BigInt(special.less_than_energy))return {delegated:0,recovered:0}
  const recovered=await recoverLists(client,special,fetcher,logger)
  if(!shouldContinue())return {delegated:0,recovered}
  const energy=Math.min(Number(special.per_energy),Number(special.max_energy)-Number(special.send_energy))
  if(!Number.isSafeInteger(energy)||energy<=0)return {delegated:0,recovered}
  const platforms=await client.query<Platform>("SELECT rid,platform_uid,platform_apikey,permission_id,platform_balance::text,tg_notice_obj FROM t_energy_platform WHERE platform_name=3 AND status=0 AND platform_apikey IS NOT NULL AND platform_balance >= $1 ORDER BY seq_sn DESC,rid DESC LIMIT 1",[energy])
  const platform=platforms.rows[0];if(!platform?.platform_uid||!platform.platform_apikey)return {delegated:0,recovered}
  let sun:bigint
  try{sun=await requiredStake(fetcher,platform.platform_uid,BigInt(energy))}catch{logger.error('handleenergyspecial delegatable balance unavailable for platform '+platform.rid);return {delegated:0,recovered}}
  try{signerConfig()}catch{logger.error('handleenergyspecial signer unavailable for platform '+platform.rid);return {delegated:0,recovered}}
  const key='delegate:'+special.rid+':'+special.send_energy+':'+energy+':'+special.wallet_addr+':'+platform.rid
  const amount=trxAmount(sun)
  if(!await claimAction(client,{key,type:'delegate',source:special.rid,special:special.rid,platform:platform.rid,amount,energy,target:special.wallet_addr}))return {delegated:0,recovered}
  await actionState(client,key,'signing')
  try{const txid=await signResource(fetcher,platform,special.wallet_addr,sun,'delegate_resource');const ok=await finalizeDelegation(client,special,platform,energy,sun,key,txid);return {delegated:ok?1:0,recovered}}
  catch{
   await actionState(client,key,'manual','signer_result_unknown')
   if(platform.tg_notice_obj&&special.bot_rid)for(const chatId of platform.tg_notice_obj.split(',').map(value=>value.trim()).filter(Boolean))await queueNotice(client,special.bot_rid,chatId,'特殊能量代理提交结果不确定，需要人工核对地址：<code>'+html(special.wallet_addr)+'</code>','handleenergyspecial:'+key+':admin:'+chatId)
   logger.error('handleenergyspecial signer result requires reconciliation for special '+rid)
   return {delegated:0,recovered}
  }
 })
}
async function deliverOutbox(pool:Database,fetcher:typeof fetch,shouldContinue:()=>boolean,logger:Logger){
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return 0
 const owner=randomUUID(),claim=await pool.connect()
 let rows:Array<{id:string;bot_token:string|null;chat_id:string;message_text:string;attempts:number;max_attempts:number}>=[]
 try{
  await claim.query('BEGIN')
  const result=await claim.query<{id:string;bot_token:string|null;chat_id:string;message_text:string;attempts:number;max_attempts:number}>("WITH candidates AS (SELECT id,bot_rid FROM t_platform_job_outbox WHERE task_name='handleenergyspecial' AND ((status='pending' AND next_attempt_at<=now()) OR (status='processing' AND locked_until<=now())) ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED),claimed AS (UPDATE t_platform_job_outbox o SET status='processing',attempts=o.attempts+1,lock_owner=$1,locked_until=now()+interval '60 seconds',updated_at=now() FROM candidates c WHERE o.id=c.id RETURNING o.id::text,o.bot_rid,o.chat_id,o.message_text,o.attempts,o.max_attempts) SELECT c.id,b.bot_token,c.chat_id,c.message_text,c.attempts,c.max_attempts FROM claimed c LEFT JOIN t_telegram_bot b ON b.rid=c.bot_rid",[owner])
  rows=result.rows;await claim.query('COMMIT')
 }catch(error){await claim.query('ROLLBACK').catch(()=>undefined);throw error}finally{claim.release()}
 let sent=0
 for(const row of rows){
  if(!shouldContinue())break
  let ok=false
  try{if(row.bot_token){const response=await fetcher('https://api.telegram.org/bot'+row.bot_token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:row.chat_id,text:row.message_text,parse_mode:'HTML'}),redirect:'error',signal:AbortSignal.timeout(API_TIMEOUT)});const payload=await response.json().catch(()=>null) as {ok?:boolean}|null;ok=response.ok&&payload?.ok===true}}catch{}
  const client=await pool.connect()
  try{if(ok){await client.query("UPDATE t_platform_job_outbox SET status='sent',sent_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2",[row.id,owner]);sent++}else{const delay=Math.min(300,5*2**Math.max(0,row.attempts-1));await client.query("UPDATE t_platform_job_outbox SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+($3*interval '1 second'),last_error_code='telegram_delivery_failed',updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE id=$1 AND status='processing' AND lock_owner=$2",[row.id,owner,delay])}}finally{client.release()}
 }
 if(!shouldContinue())await pool.query("UPDATE t_platform_job_outbox SET status='pending',attempts=GREATEST(attempts-1,0),next_attempt_at=now(),updated_at=now(),lock_owner=NULL,locked_until=NULL WHERE status='processing' AND lock_owner=$1",[owner])
 if(rows.length>sent)logger.error('handleenergyspecial Telegram outbox delivery incomplete')
 return sent
}
export async function syncEnergySpecial(options:Options={}){
 if(!(options.enabled??process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS==='true'))return {skipped:true,scanned:0,delegated:0,recovered:0,failed:0,noticesSent:0}
 const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,shouldContinue=options.shouldContinue??(()=>true),limit=Math.max(1,Math.min(options.batchSize??10,50))
 if(!shouldContinue())return {skipped:true,scanned:0,delegated:0,recovered:0,failed:0,noticesSent:0}
 const candidates=await pool.query<{rid:number}>('SELECT rid FROM t_energy_special WHERE status=1 AND per_energy>0 AND less_than_energy>0 AND max_energy-send_energy>0 ORDER BY seq_sn DESC,rid DESC LIMIT $1',[limit])
 let scanned=0,delegated=0,recovered=0,failed=0
 for(const row of candidates.rows){if(!shouldContinue())break;scanned++;try{const result=await processOne(pool,row.rid,fetcher,logger,shouldContinue);delegated+=result?.delegated??0;recovered+=result?.recovered??0}catch{failed++;logger.error('handleenergyspecial failed for special '+row.rid)}}
 let noticesSent=0
 try{noticesSent=await deliverOutbox(pool,fetcher,shouldContinue,logger)}catch{logger.error('handleenergyspecial outbox delivery failed')}
 return {skipped:false,scanned,delegated,recovered,failed,noticesSent}
}
