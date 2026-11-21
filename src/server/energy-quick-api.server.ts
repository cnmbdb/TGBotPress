import { z } from 'zod'
import { db } from './db.server'
import { can,identity,run } from './api.server'
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
const statusLabels:Record<number,string>={6:'能量钱包未启用',7:'金额无对应套餐',8:'下单中',9:'下单成功',1:'待下单',5:'能量钱包未配置私钥',4:'下单失败'}
const idSchema=z.coerce.number().int().positive().max(2_147_483_647)
export function energyQuickApi(request:Request){return run(async()=>{
 const user=await identity(request),route='admin.energy.quick.index'
 if(!can(user,'能量管理',route)||!can(user,'快捷订单',route))return Response.json({message:'没有访问权限'},{status:403,headers})
 if(request.method==='GET'){
  const url=new URL(request.url)
  if(url.searchParams.get('action')==='options'){const bots=await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC');return Response.json({bots:bots.rows},{headers})}
  const input=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),botRid:z.union([z.literal('all'),z.coerce.number().int().positive()]).default('all'),wallet:z.string().trim().max(100).default('')}).parse(Object.fromEntries(url.searchParams))
  const wallet=`%${input.wallet.replace(/[!%_]/g,c=>'!'+c)}%`,bot=input.botRid==='all'?null:input.botRid
  const where="($1::int IS NULL OR a.bot_rid=$1) AND ($2='%%' OR a.wallet_addr ILIKE $2 ESCAPE '!')"
  const total=await db.query(`SELECT count(*)::int AS total FROM t_energy_quick_order a JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where}`,[bot,wallet])
  const result=await db.query(`SELECT a.rid,a.bot_rid,a.tg_uid,a.wallet_addr,a.quick_order_amount,a.quick_order_status,a.energy_amount,a.energy_day,a.status,a.package_rid,a.comments,a.package_name,a.pay_price::text AS pay_price,a.pay_type,to_char(a.pay_time,'YYYY-MM-DD HH24:MI:SS') AS pay_time,to_char(a.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time,b.bot_firstname,b.bot_username FROM t_energy_quick_order a JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`,[bot,wallet,input.pageSize,(input.page-1)*input.pageSize])
  return Response.json({rows:result.rows.map(row=>({...row,status_label:statusLabels[Number(row.status)]||`未知状态 (${row.status})`,can_reissue:[4,5,6,7].includes(Number(row.status))})),total:total.rows[0].total,page:input.page,pageSize:input.pageSize,canReissue:can(user,'补发','admin.energy.quick.reorder'),telegramEnabled:process.env.PLATFORM_TELEGRAM_ACTIONS==='true'},{headers})
 }
 if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
 if(request.headers.get('content-type')?.includes('application/json')!==true)return Response.json({message:'请求格式无效'},{status:415,headers})
 let expectedOrigin='';try{expectedOrigin=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:''}catch{}
 if(!expectedOrigin||request.headers.get('origin')!==expectedOrigin)return Response.json({message:'请求来源无效'},{status:403,headers})
 let body:unknown;try{body=await request.json()}catch{return Response.json({message:'请求内容无效'},{status:400,headers})}
 const input=z.object({action:z.literal('reissue'),rid:idSchema}).strict().parse(body)
 if(!can(user,'补发','admin.energy.quick.reorder'))return Response.json({message:'没有操作权限'},{status:403,headers})
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return Response.json({message:'当前开发环境未启用外部机器人操作'},{status:409,headers})
 const client=await db.connect();try{
  await client.query('BEGIN');const current=await client.query('SELECT status FROM t_energy_quick_order WHERE rid=$1 FOR UPDATE',[input.rid])
  if(!current.rowCount){await client.query('ROLLBACK');return Response.json({message:'交易数据不存在'},{status:404,headers})}
  if(![4,5,6,7].includes(Number(current.rows[0].status))){await client.query('ROLLBACK');return Response.json({message:'状态为失败时才能补发'},{status:409,headers})}
  await client.query('UPDATE t_energy_quick_order SET status=1 WHERE rid=$1',[input.rid])
  await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.quick_order.reissue',input.rid])
  await client.query('COMMIT');return Response.json({ok:true,message:'补发任务已提交'},{headers})
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
})}
