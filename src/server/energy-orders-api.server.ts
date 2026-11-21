import {z} from 'zod'
import {db} from './db.server'
import {can,identity,run} from './api.server'
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
const platformNames:Record<number,string>={1:'Neee.cc',2:'RentEnergysBot',3:'自己质押代理',4:'trongas.io',5:'机器人开发代理',6:'搜狐',7:'NL-API'}
const days:Record<number,string>={0:'1小时',1:'1天',3:'3天',30:'30天'}
const sources:Record<number,string>={1:'人工下单',2:'自动下单',3:'智能托管',4:'笔数套餐',5:'绑A送N'}
const recoveries:Record<number,string>={1:'不用回收',2:'待回收',3:'已回收'}
const id=z.coerce.number().int().positive().max(2_147_483_647)
async function recoverResource(ciphertext:string,from:string,to:string,amount:string,permissionId:number){
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')throw Object.assign(new Error('当前开发环境未启用外部能量操作'),{status:409})
 const token=process.env.TRON_SIGNER_TOKEN?.trim(),base=process.env.TRON_SIGNER_URL?.trim(),appEnv=(process.env.APP_ENV||'production').toLowerCase()
 if(!token||token.length<32||!base)throw Object.assign(new Error('能量签名服务未配置'),{status:503})
 let url:URL;try{url=new URL(base)}catch{throw Object.assign(new Error('能量签名服务地址无效'),{status:503})}
 if(url.protocol!=='https:'&&!['local','dev','development'].includes(appEnv))throw Object.assign(new Error('生产环境能量签名服务必须使用 HTTPS'),{status:503})
 const response=await fetch(new URL('/api/internal/tron/sign',url),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({operation:'undelegate_resource',private_key_ciphertext:ciphertext,from_address:from,to_address:to,amount,resource_type:'ENERGY',permission_id:permissionId}),signal:AbortSignal.timeout(30_000),redirect:'error'})
 const result=await response.json().catch(()=>null) as {code?:number;msg?:string;data?:{txid?:string}}|null
 if(!response.ok||!result||result.code!==200||!result.data?.txid)throw Object.assign(new Error(result?.msg||'能量回收失败'),{status:502})
 return result.data.txid
}
export function energyOrdersApi(request:Request){return run(async()=>{
 const user=await identity(request),route='admin.energy.order.index'
 if(!can(user,'能量管理',route)||!can(user,'能量订单',route))return Response.json({message:'没有访问权限'},{status:403,headers})
 if(request.method==='GET'){
  const url=new URL(request.url)
  if(url.searchParams.get('action')==='options'){const bots=await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC');return Response.json({bots:bots.rows},{headers})}
  const input=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),platformUid:z.string().trim().max(100).default(''),platformOrderId:z.string().trim().max(100).default(''),botRid:z.union([z.literal('all'),z.coerce.number().int().positive()]).default('all'),address:z.string().trim().max(50).default('')}).parse(Object.fromEntries(url.searchParams))
  const escape=(s:string)=>`%${s.replace(/[!%_]/g,c=>'!'+c)}%`,uid=escape(input.platformUid),orderId=escape(input.platformOrderId),address=input.address,bot=input.botRid==='all'?null:input.botRid
  const where="($1='%%' OR a.platform_uid ILIKE $1 ESCAPE '!') AND ($2='%%' OR a.platform_order_id ILIKE $2 ESCAPE '!') AND ($3::int IS NULL OR b.bot_rid=$3) AND ($4='' OR a.receive_address=$4)"
  const params=[uid,orderId,bot,address]
  const total=await db.query(`SELECT count(*)::int AS total FROM t_energy_platform_order a LEFT JOIN t_energy_platform_bot b ON a.energy_platform_bot_rid=b.rid LEFT JOIN t_telegram_bot c ON b.bot_rid=c.rid WHERE ${where}`,params)
  const result=await db.query(`SELECT a.rid,a.energy_platform_rid,a.energy_platform_bot_rid,a.platform_name,a.platform_uid,a.source_type,a.receive_address,a.platform_order_id,a.energy_amount,a.energy_day,to_char(a.energy_time,'YYYY-MM-DD HH24:MI:SS') AS energy_time,a.recovery_status,to_char(a.recovery_time,'YYYY-MM-DD HH24:MI:SS') AS recovery_time,a.use_trx,c.bot_username,b.bot_rid FROM t_energy_platform_order a LEFT JOIN t_energy_platform_bot b ON a.energy_platform_bot_rid=b.rid LEFT JOIN t_telegram_bot c ON b.bot_rid=c.rid WHERE ${where} ORDER BY a.rid DESC LIMIT $5 OFFSET $6`,[...params,input.pageSize,(input.page-1)*input.pageSize])
  const rows=result.rows.map(row=>({...row,platform_name_label:platformNames[Number(row.platform_name)]||`未知(${row.platform_name})`,energy_day_label:days[Number(row.energy_day)]||String(row.energy_day),source_type_label:sources[Number(row.source_type)]||`未知(${row.source_type})`,recovery_status_label:recoveries[Number(row.recovery_status)]||`未知(${row.recovery_status})`,can_mark_recovered:Number(row.recovery_status)===2}))
  return Response.json({rows,total:total.rows[0].total,page:input.page,pageSize:input.pageSize,canBatchRecover:can(user,'批量回收能量','admin.energy.order.batch_recovery_energy'),canMarkRecovered:can(user,'已回收','admin.energy.order.alreadyrecover'),externalEnabled:process.env.PLATFORM_TELEGRAM_ACTIONS==='true'},{headers})
 }
 if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
 if(request.headers.get('content-type')?.includes('application/json')!==true)return Response.json({message:'请求格式无效'},{status:415,headers})
 let expectedOrigin='';try{expectedOrigin=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:''}catch{}
 if(!expectedOrigin||request.headers.get('origin')!==expectedOrigin)return Response.json({message:'请求来源无效'},{status:403,headers})
 let body:unknown;try{body=await request.json()}catch{return Response.json({message:'请求内容无效'},{status:400,headers})}
 const actionSchema=z.discriminatedUnion('action',[z.object({action:z.literal('mark_recovered'),rid:id}).strict(),z.object({action:z.literal('batch_recover'),daili_address:z.string().trim().min(1).max(100),recovery_address:z.string().trim().min(1).max(50)}).strict()])
 const input=actionSchema.parse(body)
 if(input.action==='mark_recovered'){
  if(!can(user,'已回收','admin.energy.order.alreadyrecover'))return Response.json({message:'没有操作权限'},{status:403,headers})
  const client=await db.connect();try{await client.query('BEGIN');const row=await client.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=$1 FOR UPDATE',[input.rid]);if(!row.rowCount){await client.query('ROLLBACK');return Response.json({message:'订单不存在'},{status:404,headers})}if(Number(row.rows[0].recovery_status)!==2){await client.query('ROLLBACK');return Response.json({message:'仅待回收订单可标记已回收'},{status:409,headers})}await client.query('UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE rid=$1',[input.rid]);await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.order.mark_recovered',input.rid]);await client.query('COMMIT');return Response.json({ok:true,message:'已标记回收完成'},{headers})}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 if(!can(user,'批量回收能量','admin.energy.order.batch_recovery_energy'))return Response.json({message:'没有操作权限'},{status:403,headers})
 const client=await db.connect();try{
  await client.query('BEGIN')
  const platform=await client.query('SELECT rid,platform_apikey,permission_id FROM t_energy_platform WHERE platform_uid=$1 FOR UPDATE',[input.daili_address])
  if(!platform.rowCount){await client.query('ROLLBACK');return Response.json({message:'代理地址不存在'},{status:404,headers})}
  const key=String(platform.rows[0].platform_apikey||'');if(!key){await client.query('ROLLBACK');return Response.json({message:'代理地址未配置密钥'},{status:409,headers})}
  const orders=await client.query("SELECT rid,use_trx::text AS use_trx FROM t_energy_platform_order WHERE platform_uid=$1 AND receive_address=$2 AND recovery_status=2 ORDER BY rid FOR UPDATE",[input.daili_address,input.recovery_address])
  if(!orders.rowCount){await client.query('ROLLBACK');return Response.json({message:'地址无待回收能量'},{status:409,headers})}
  const amount=orders.rows.reduce((sum,row)=>sum+Number(row.use_trx||0),0);if(!Number.isFinite(amount)||amount<=0){await client.query('ROLLBACK');return Response.json({message:'待回收能量数量无效'},{status:409,headers})}
  const txid=await recoverResource(key,input.daili_address,input.recovery_address,String(amount),Number(platform.rows[0].permission_id))
  const ids=orders.rows.map(row=>row.rid);await client.query('UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE rid=ANY($1::int[])',[ids]);await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.order.batch_recover',platform.rows[0].rid]);await client.query('COMMIT');return Response.json({ok:true,message:'能量回收请求已提交',txid,count:ids.length},{headers})
 }catch(error){await client.query('ROLLBACK');const status=(error as {status?:unknown})?.status;if(typeof status==='number'&&[409,502,503].includes(status))return Response.json({message:error instanceof Error?error.message:'能量回收失败'},{status,headers});throw error}finally{client.release()}
})}
