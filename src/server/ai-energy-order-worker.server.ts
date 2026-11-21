import { constants, createHash, createPrivateKey, privateDecrypt, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Pool } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; now?: () => number }
type Candidate = { rid:number; bot_rid:number; tg_uid:string; wallet_addr:string; energy_amount:number; energy_day:number; trx_price_energy_32000:number; trx_price_energy_65000:number; is_notice:string; is_notice_admin:string; total_buy_energy_quantity:number; total_used_trx:string; total_buy_quantity:number; poll_group:string; energy_platform_bot_rid:number; agent_tg_uid:string|null; agent_per_price:string|null; recovery_type:string }
export type Platform = { rid:number; platform_name:number; platform_uid:string; platform_apikey:string; permission_id:number; platform_balance:string; seq_sn:number; comments?:string|null }
export type EnergyPurchaseRequest = Pick<Candidate, 'energy_amount'|'energy_day'|'wallet_addr'>
type Purchase = { orderId:string; useTrx:string }
export type ProviderResult = { kind:'success'; value:Purchase } | { kind:'rejected'; message:string }
type SignerResponse = { code?:number; data?:{ txid?:string; use_trx?:string|number } }

function privateKey():KeyObject {
  const path=process.env.TRON_RSA_PRIVATE_KEY_PATH
  const raw=(path?readFileSync(path,'utf8'):process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g,'\n').trim()
  if(!raw) throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE')
  return createPrivateKey(raw)
}
function decryptApiKey(ciphertext:string) {
  const key=privateKey(),bytes=(key.asymmetricKeyDetails?.modulusLength??0)/8
  if(!Number.isSafeInteger(bytes)||bytes<256) throw new Error('RSA_KEY_INVALID')
  const versioned=ciphertext.startsWith('v2:'),encoded=(versioned?ciphertext.slice(3):ciphertext).replace(/-/g,'+').replace(/_/g,'/')
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('RSA_CIPHERTEXT_INVALID')
  const encrypted=Buffer.from(encoded,'base64')
  if(!encrypted.length||encrypted.length%bytes) throw new Error('RSA_CIPHERTEXT_INVALID')
  const parts:Buffer[]=[]
  for(let i=0;i<encrypted.length;i+=bytes) parts.push(privateDecrypt(versioned
    ? {key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'}
    : {key,padding:constants.RSA_PKCS1_PADDING},encrypted.subarray(i,i+bytes)))
  return Buffer.concat(parts).toString('utf8')
}
function signerConfig() {
  const token=process.env.TRON_SIGNER_TOKEN?.trim(),base=process.env.TRON_SIGNER_URL?.trim()
  if(!token||token.length<32||!base) throw new Error('TRON_SIGNER_NOT_CONFIGURED')
  const url=new URL(base),env=(process.env.APP_ENV||'production').toLowerCase()
  if(url.protocol!=='https:'&&!['local','dev','development'].includes(env)) throw new Error('TRON_SIGNER_HTTPS_REQUIRED')
  return {token,url}
}
async function requestJson(fetcher:typeof fetch,url:string|URL,init:RequestInit={}) {
  let response:Response
  try { response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(20_000)}) }
  catch { throw new Error('AI_ENERGY_PROVIDER_RESULT_UNKNOWN') }
  const payload=await response.json().catch(()=>null) as Record<string,any>|null
  if(!response.ok||!payload||typeof payload!=='object'||Array.isArray(payload)) throw new Error('AI_ENERGY_PROVIDER_RESULT_UNKNOWN')
  return payload
}
function rejection(value:unknown):ProviderResult {
  const text=typeof value==='string'?value:JSON.stringify(value)
  return {kind:'rejected',message:(text||'供应商拒绝下单').slice(0,180)}
}
function externalSupplierBase(raw:string):URL {
  const url=new URL(raw),host=url.hostname.toLowerCase(),localHttp=['local','dev','development'].includes((process.env.APP_ENV||'production').toLowerCase())
  const ipv4=isIP(host)===4?host.split('.').map(Number):null
  const privateIp=ipv4&&(ipv4[0]===0||ipv4[0]===10||ipv4[0]===127||ipv4[0]>=224||(ipv4[0]===169&&ipv4[1]===254)||(ipv4[0]===172&&ipv4[1]>=16&&ipv4[1]<=31)||(ipv4[0]===192&&ipv4[1]===168)||(ipv4[0]===100&&ipv4[1]>=64&&ipv4[1]<=127))
  if(!(url.protocol==='https:'||(localHttp&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||host==='localhost'||host.endsWith('.localhost')||(isIP(host)!==0&&(privateIp||isIP(host)===6))) throw new Error('UNSAFE_ENERGY_PROVIDER_URL')
  return url
}
export async function placeOrder(fetcher:typeof fetch,row:EnergyPurchaseRequest,platform:Platform,now:()=>number,mode:'standard'|'bishu'='standard'):Promise<ProviderResult> {
  const name=Number(platform.platform_name),amount=Number(row.energy_amount)
  if(!platform.platform_apikey) return rejection('平台密钥为空')
  if(name===3) {
    const {token,url}=signerConfig()
    const body={operation:'delegate_resource',private_key_ciphertext:platform.platform_apikey,from_address:platform.platform_uid,to_address:row.wallet_addr,amount:String(amount),resource_type:'ENERGY',permission_id:Number(platform.permission_id||0)}
    const result=await requestJson(fetcher,new URL('/api/internal/tron/sign',url),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}) as SignerResponse
    const txid=result.data?.txid,used=String(result.data?.use_trx??'')
    if(result.code!==200||!txid||! /^\d+(?:\.\d{1,6})?$/.test(used)) return rejection('自有质押平台签名失败')
    return {kind:'success',value:{orderId:txid,useTrx:used}}
  }
  let secret:string
  try { secret=decryptApiKey(platform.platform_apikey) } catch { return rejection('平台凭据解密失败') }
  if(name===1) {
    const params:Record<string,string>={uid:String(platform.platform_uid),resource_type:'0',receive_address:row.wallet_addr,amount:String(amount),freeze_day:String(row.energy_day),time:String(Math.floor(now()/1000))}
    const signature=Object.keys(params).sort().map(key=>key+params[key]).join('')
    params.sign=createHash('md5').update(secret+signature).digest('hex')
    const result=await requestJson(fetcher,'https://api.tronqq.com/openapi/v2/order/submit',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(params)})
    if(Number(result.status)!==200||!result.data?.order_no) return rejection(result.msg??result)
    return {kind:'success',value:{orderId:String(result.data.order_no),useTrx:'0'}}
  }
  if(name===2) {
    const type=row.energy_day===1?'day':row.energy_day===3?'3day':'hour'
    const url=new URL('https://api.wallet.buzz')
    for(const [key,value] of Object.entries({api:'getEnergy',apikey:secret,address:row.wallet_addr,amount:String(Math.max(amount,33000)),type})) url.searchParams.set(key,value)
    const result=await requestJson(fetcher,url)
    if(result.status!=='success'||!result.txid) return rejection(result)
    return {kind:'success',value:{orderId:String(result.txid),useTrx:'0'}}
  }
  if(name===4) {
    const rentTime=row.energy_day===1?24:row.energy_day===3?72:1
    const body={username:platform.platform_uid,password:secret,resType:'ENERGY',payNums:amount,rentTime,resLock:0,receiveAddress:row.wallet_addr}
    const result=await requestJson(fetcher,'https://trongas.io/api/pay',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)})
    const orderId=result.data?.orderId,used=String(result.data?.orderMoney??'')
    if(Number(result.code)!==10000||!orderId||! /^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId:String(orderId),useTrx:used}}
  }
  if(name===5) {
    if(row.energy_day!==0) return rejection('机器人开发代理仅支持租用1小时')
    const raw=process.env.THIRD_URL?.trim()
    if(!raw) return rejection('机器人开发代理地址未配置')
    const base=externalSupplierBase(raw)
    const target=new URL('/api/thirdpart/shanzuorder',base)
    const result=await requestJson(fetcher,target,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({tg_uid:platform.platform_uid,payNums:amount,rentTime:1,receiveAddress:row.wallet_addr})})
    const orderId=result.data?.orderId,used=String(result.data?.orderMoney??'0')
    if(Number(result.code)!==200||!orderId||! /^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId:String(orderId),useTrx:used}}
  }
  if(name===6) {
    const period=row.energy_day===1?'1day':row.energy_day===3?'3day':'1h'
    const result=await requestJson(fetcher,'https://admin.weidubot.cc/api/trc_api/frozen_energy',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({token:secret,type:mode==='bishu'?'both':'energy',count:amount,period,trx_amount:mode==='bishu'?0.35:0,address:row.wallet_addr})})
    const orderId=result.data?.order_sn,used=String(result.data?.amount??'0')
    if(Number(result.code)!==1||!orderId||! /^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId:String(orderId),useTrx:used}}
  }
  if(name===7) {
    const fromComment=String(platform.comments??'').match(/nl_api_url=([^\s]+)/i)?.[1]
    const base=externalSupplierBase(process.env.NL_API_BASE_URL?.trim()||fromComment||'https://tgnl-home.hfz.pw')
    const target=new URL('/v1/delegate_tran',base)
    const result=await requestJson(fetcher,target,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({username:platform.platform_uid,password:secret,energy:amount,day:row.energy_day,receiver_address:row.wallet_addr})})
    if(!((result.success===true)||result.tx_hash||result.txHash)) return rejection(result)
    const orderId=String(result.tx_hash??result.txHash??('NLAPI_'+Math.floor(now()/1000))),used=String(result.cost_trx??'0')
    if(!/^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId,useTrx:used}}
  }
  return rejection('不支持的能量平台')
}
export async function placeBishuCountOrder(fetcher:typeof fetch,platform:Platform,wallet:string,count:number,mode:'developer'|'trongas'|'sohu',now:()=>number):Promise<ProviderResult> {
  if(!Number.isSafeInteger(count)||count<=0||!platform.platform_apikey) return rejection('平台凭据或剩余笔数无效')
  if(mode==='developer') {
    const raw=process.env.THIRD_URL?.trim()
    if(!raw) return rejection('机器人开发代理地址未配置')
    const base=externalSupplierBase(raw),target=new URL('/api/thirdpart/bishuorder',base)
    const result=await requestJson(fetcher,target,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({tg_uid:platform.platform_uid,maxDelegateNums:count,receiveAddress:wallet})})
    const orderId=result.data?.orderId,used=String(result.data?.orderMoney??'0')
    if(Number(result.code)!==200||!orderId||!/^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId:String(orderId),useTrx:used}}
  }
  let secret:string
  try { secret=decryptApiKey(platform.platform_apikey) } catch { return rejection('平台凭据解密失败') }
  if(mode==='trongas') {
    const result=await requestJson(fetcher,'https://trongas.io/api/auto/add',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({username:platform.platform_uid,password:secret,resType:'ENERGY',autoType:0,payment:Number(process.env.TRONGASID_BISHU_PAYMENT??0),autoLimitNums:65000,everyAutoNums:65000,endTime:2556115199,rentTime:24,maxDelegateNums:count,chromeIndex:String(Math.floor(now())),receiveAddress:wallet})})
    const orderId=result.data?.orderId,used=String(result.data?.orderMoney??'0')
    if(Number(result.code)!==10000||!orderId||!/^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
    return {kind:'success',value:{orderId:String(orderId),useTrx:used}}
  }
  const result=await requestJson(fetcher,'https://admin.weidubot.cc/api/trc_api/delegate_energy_times',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({token:secret,times:count,address:wallet})})
  if(Number(result.code)!==1) return rejection(result)
  const orderId=String(result.data?.order_sn??result.data?.orderId??('SOHU_TIMES_'+Math.floor(now())))
  const used=String(result.data?.amount??'0')
  if(!/^\d+(?:\.\d{1,6})?$/.test(used)) return rejection(result)
  return {kind:'success',value:{orderId,useTrx:used}}
}

export async function recoverBishuEnergy(pool:Database,fetcher:typeof fetch,row:{energy_platform_bot_rid:number;wallet_addr:string;poll_group:string}) {
  const platforms=await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_name=3 AND platform_apikey IS NOT NULL",[row.poll_group])
  for(const platform of platforms.rows) {
    const pending=await pool.query<{amount:string}>("SELECT COALESCE(sum(use_trx),0)::text AS amount FROM t_energy_platform_order WHERE platform_uid=$1 AND energy_platform_bot_rid=$2 AND receive_address=$3 AND recovery_status=2 AND source_type=4",[platform.platform_uid,row.energy_platform_bot_rid,row.wallet_addr])
    const amount=pending.rows[0]?.amount??'0'
    if(!/^\d+(?:\.\d+)?$/.test(amount)||Number(amount)<=0) continue
    const {token,url}=signerConfig()
    const result=await requestJson(fetcher,new URL('/api/internal/tron/sign',url),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({operation:'undelegate_resource',private_key_ciphertext:platform.platform_apikey,from_address:platform.platform_uid,to_address:row.wallet_addr,amount,resource_type:'ENERGY',permission_id:Number(platform.permission_id||0)})}) as SignerResponse
    if(result.code===200&&result.data?.txid) await pool.query("UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE platform_uid=$1 AND energy_platform_bot_rid=$2 AND receive_address=$3 AND recovery_status=2 AND source_type=4",[platform.platform_uid,row.energy_platform_bot_rid,row.wallet_addr])
  }
}

async function recoverTrusteeshipEnergy(pool:Database,fetcher:typeof fetch,row:Candidate,platforms:Platform[]) {
  if(row.recovery_type!=='2') return
  for(const platform of platforms.filter(item=>Number(item.platform_name)===3)) {
    const pending=await pool.query<{amount:string}>('SELECT COALESCE(sum(use_trx),0)::text AS amount FROM t_energy_platform_order WHERE platform_uid=$1 AND energy_platform_bot_rid=$2 AND receive_address=$3 AND recovery_status=2 AND source_type=3',[platform.platform_uid,row.energy_platform_bot_rid,row.wallet_addr])
    const amount=pending.rows[0]?.amount??'0'
    if(!/^\d+(?:\.\d+)?$/.test(amount)||Number(amount)<=0) continue
    try {
      const {token,url}=signerConfig()
      const result=await requestJson(fetcher,new URL('/api/internal/tron/sign',url),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({operation:'undelegate_resource',private_key_ciphertext:platform.platform_apikey,from_address:platform.platform_uid,to_address:row.wallet_addr,amount,resource_type:'ENERGY',permission_id:Number(platform.permission_id||0)})}) as SignerResponse
      if(result.code===200&&result.data?.txid) await pool.query("UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE platform_uid=$1 AND energy_platform_bot_rid=$2 AND receive_address=$3 AND recovery_status=2 AND source_type=3",[platform.platform_uid,row.energy_platform_bot_rid,row.wallet_addr])
    } catch { /* Legacy continues purchasing after a recovery attempt fails. */ }
  }
}
async function claimOne(pool:Database,shouldContinue:()=>boolean):Promise<Candidate|null> {
  if(!shouldContinue()) return null
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const selected=await client.query<Candidate>("SELECT a.rid,a.bot_rid,a.tg_uid::text,a.wallet_addr,a.per_buy_energy_quantity AS energy_amount,b.per_energy_day AS energy_day,b.trx_price_energy_32000,b.trx_price_energy_65000,a.is_notice,a.is_notice_admin,a.total_buy_energy_quantity,a.total_used_trx::text,a.total_buy_quantity,b.poll_group,b.rid AS energy_platform_bot_rid,b.agent_tg_uid::text,b.agent_per_price::text,b.ai_trusteeship_recovery_type AS recovery_type FROM t_energy_ai_trusteeship a JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid WHERE a.is_buy='Y' AND a.status=0 AND b.is_open_ai_trusteeship='Y' AND b.status=0 AND a.per_buy_energy_quantity>=65000 AND b.trx_price_energy_32000>0 AND b.trx_price_energy_65000>0 AND b.per_energy_day IN (0,1,3) ORDER BY a.rid LIMIT 1 FOR UPDATE OF a SKIP LOCKED")
    const row=selected.rows[0]
    if(!row) { await client.query('ROLLBACK'); return null }
    await client.query("UPDATE t_energy_ai_trusteeship SET is_buy='B',update_time=now() WHERE rid=$1 AND is_buy='Y'",[row.rid])
    await client.query('COMMIT')
    return row
  } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function updateFailure(pool:Database,row:Candidate,message:string,manual:boolean,notify:boolean) {
  await pool.query("UPDATE t_energy_ai_trusteeship SET is_buy=$2,comments=$3,is_notice_admin=CASE WHEN $4 THEN 'Y' ELSE is_notice_admin END,update_time=now() WHERE rid=$1 AND is_buy='B'",[row.rid,manual?'N':'Y',message.slice(0,1800),notify])
}
async function finishPurchase(pool:Database,row:Candidate,platform:Platform,purchase:Purchase,now:()=>number) {
  const client=await pool.connect(),price=String(row.energy_amount===65000?row.trx_price_energy_32000:row.trx_price_energy_65000)
  try {
    await client.query('BEGIN')
    const locked=await client.query<{rid:number}>("SELECT rid FROM t_energy_ai_trusteeship WHERE rid=$1 AND is_buy='B' FOR UPDATE",[row.rid])
    if(!locked.rowCount) throw new Error('AI_ENERGY_CLAIM_STATE_CHANGED')
    const owner=await client.query("UPDATE t_telegram_bot_user SET cash_trx=cash_trx-$3::numeric WHERE bot_rid=$1 AND tg_uid=$2 AND cash_trx >= $3::numeric RETURNING rid",[row.bot_rid,row.tg_uid,price])
    let accountingIssue=!owner.rowCount,agentIssue=false
    if(owner.rowCount&&row.agent_tg_uid&&row.agent_per_price&&Number(row.agent_per_price)>0) {
      const agent=await client.query("UPDATE t_telegram_bot_user SET cash_trx=cash_trx-$3::numeric WHERE bot_rid=$1 AND tg_uid=$2 AND cash_trx >= $3::numeric RETURNING rid",[row.bot_rid,row.agent_tg_uid,row.agent_per_price])
      agentIssue=!agent.rowCount
      accountingIssue ||= agentIssue
    }
    await client.query('INSERT INTO t_energy_platform_order(energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,receive_address,platform_order_id,energy_amount,energy_day,energy_time,source_type,recovery_status,use_trx) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),3,$9,$10::numeric)',[platform.rid,row.energy_platform_bot_rid,platform.platform_name,platform.platform_uid,row.wallet_addr,purchase.orderId,row.energy_amount,row.energy_day,Number(platform.platform_name)===3?2:1,purchase.useTrx])
    await client.query("UPDATE t_energy_ai_trusteeship SET is_buy='N',comments=$2,is_notice=CASE WHEN is_notice='N' THEN 'Y' ELSE is_notice END,is_notice_admin=CASE WHEN $3 THEN 'Y' ELSE is_notice_admin END,total_buy_energy_quantity=total_buy_energy_quantity+$4,total_used_trx=total_used_trx+$5::numeric,total_buy_quantity=total_buy_quantity+1,last_buy_time=now(),last_used_trx=$5::numeric,update_time=now() WHERE rid=$1",[row.rid,accountingIssue?'外部下单成功，余额扣款需要人工核对':'SUCCESS '+new Date(now()).toISOString(),accountingIssue,row.energy_amount,price])
    await client.query('COMMIT')
    return {accountingIssue,agentIssue}
  } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function processTrusteeship(pool:Database,fetcher:typeof fetch,row:Candidate,shouldContinue:()=>boolean,logger:Logger,now:()=>number) {
  const amount=row.energy_amount,price=row.energy_amount===65000?row.trx_price_energy_32000:row.trx_price_energy_65000
  const user=await pool.query<{rid:number;cash_trx:string}>("SELECT rid,cash_trx::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2",[row.bot_rid,row.tg_uid])
  if(!user.rows[0]) { await updateFailure(pool,row,'找不到机器人用户数据',false,true); return 'failed' }
  if(Number(user.rows[0].cash_trx)<price) { await updateFailure(pool,row,'用户TRX余额不足，需要：'+price,false,true); return 'failed' }
  if(row.agent_tg_uid) {
    if(!row.agent_per_price||Number(row.agent_per_price)<=0) { await updateFailure(pool,row,'代理地址未设置有效每笔金额',false,true); return 'failed' }
    const agent=await pool.query<{cash_trx:string}>("SELECT cash_trx::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2",[row.bot_rid,row.agent_tg_uid])
    if(!agent.rows[0]||Number(agent.rows[0].cash_trx)<Number(row.agent_per_price)) { await updateFailure(pool,row,'代理用户未关注机器人或TRX余额不足',false,true); return 'failed' }
  }
  const platforms=await pool.query<Platform>("SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_apikey IS NOT NULL AND ((platform_name=3 AND platform_balance >= $2) OR (platform_name IN (1,2,4) AND platform_balance > 0)) ORDER BY seq_sn DESC,rid LIMIT 100",[row.poll_group,amount])
  if(!platforms.rows.length) { await updateFailure(pool,row,'无可用能量平台，请质押或充值平台',false,true); return 'failed' }
  await recoverTrusteeshipEnergy(pool,fetcher,row,platforms.rows)
  const errors:string[]=[]
  for(const platform of platforms.rows) {
    if(!shouldContinue()) { await updateFailure(pool,row,'TanStack worker 停止，订单保留待重试',false,false); return 'skipped' }
    let result:ProviderResult
    try { result=await placeOrder(fetcher,row,platform,now) }
    catch {
      logger.error('AI trusteeship supplier result is ambiguous; manual review required for record '+row.rid)
      await updateFailure(pool,row,'能量平台请求结果不确定，需要人工核查',true,true)
      return 'manual'
    }
    if(result.kind==='rejected') { errors.push('平台 '+platform.rid+'：'+result.message); continue }
    try {
      const completed=await finishPurchase(pool,row,platform,result.value,now)
      if(completed.accountingIssue) logger.error('AI trusteeship supplier succeeded but account debit needs reconciliation for record '+row.rid)
      return 'succeeded'
    } catch {
      logger.error('AI trusteeship supplier succeeded but local accounting failed; manual review required for record '+row.rid)
      await updateFailure(pool,row,'Supplier succeeded but local accounting failed; automatic retry disabled for manual review',true,true)
      return 'manual'
    }
  }
  await updateFailure(pool,row,errors.join('；')||'能量平台下单失败',false,true)
  return 'failed'
}

/** Migrates the legacy AI trusteeship purchase path; calls that may rent or delegate energy are opt-in only. */
export async function syncAiEnergyOrders(options:Options={}) {
  if(!(options.enabled??process.env.PLATFORM_ENERGY_ORDER_ACTIONS==='true')) return {skipped:true,scanned:0,succeeded:0,failed:0,manual:0}
  const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,shouldContinue=options.shouldContinue??(()=>true),now=options.now??Date.now
  const batchSize=Math.max(1,Math.min(20,Math.floor(options.batchSize??5)))
  let scanned=0,succeeded=0,failed=0,manual=0
  try { await pool.query("UPDATE t_energy_ai_trusteeship SET is_buy='N',is_notice_admin='Y',comments='下单进程中断，结果不确定，请人工核查',update_time=now() WHERE is_buy='B' AND COALESCE(update_time,create_time)<now()-interval '5 minutes'") } catch { logger.error('AI energy stale claims could not be reconciled'); return {skipped:false,scanned:0,succeeded:0,failed:1,manual:1} }
  for(let i=0;i<batchSize&&shouldContinue();i++) {
    let row:Candidate|null
    try { row=await claimOne(pool,shouldContinue) } catch { logger.error('AI energy order claim failed'); failed++; break }
    if(!row) break
    scanned++
    try {
      const result=await processTrusteeship(pool,fetcher,row,shouldContinue,logger,now)
      if(result==='succeeded') succeeded++
      else if(result==='manual') manual++
      else if(result==='failed') failed++
    } catch(error) {
      logger.error('AI energy order processing failed for record '+row.rid+(error instanceof Error?' ('+error.message+')':''))
      try { await updateFailure(pool,row,'下单流程异常，已释放订单等待重试',false,false) } catch { logger.error('AI energy order claim release failed for record '+row.rid) }
      failed++
    }
  }
  return {skipped:false,scanned,succeeded,failed,manual}
}

