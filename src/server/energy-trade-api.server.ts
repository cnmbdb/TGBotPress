import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statusLabels: Record<number,string> = { 6:'能量钱包未启用',7:'金额无对应套餐',8:'下单中',9:'下单成功',1:'待下单',5:'能量钱包未配置私钥',4:'下单失败' }
const idSchema=z.coerce.number().int().positive().max(2_147_483_647)
export function energyTradeApi(request:Request){return run(async()=>{
 const user=await identity(request),route='admin.energy.trade.index'
 if(!can(user,'能量管理',route)||!can(user,'钱包交易',route))return Response.json({message:'没有访问权限'},{status:403,headers})
 if(request.method==='GET'){
  const input=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),tx_hash:z.string().trim().max(100).default(''),transferfrom_address:z.string().trim().max(200).default(''),transferto_address:z.string().trim().max(200).default('')}).parse(Object.fromEntries(new URL(request.url).searchParams))
  const values=[`%${input.tx_hash.replace(/[!%_]/g,c=>'!'+c)}%`,`%${input.transferfrom_address.replace(/[!%_]/g,c=>'!'+c)}%`,`%${input.transferto_address.replace(/[!%_]/g,c=>'!'+c)}%`]
  const where="($1='%%' OR tx_hash ILIKE $1 ESCAPE '!') AND ($2='%%' OR transferfrom_address ILIKE $2 ESCAPE '!') AND ($3='%%' OR transferto_address ILIKE $3 ESCAPE '!')"
  const total=await db.query(`SELECT count(*)::int AS total FROM t_energy_wallet_trade_list WHERE ${where}`,values)
  const result=await db.query(`SELECT rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,CASE WHEN "timestamp" ~ '^[0-9]+$' THEN to_char(to_timestamp(("timestamp"::numeric/1000)::double precision) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') ELSE "timestamp" END AS transaction_time,process_status,to_char(process_time,'YYYY-MM-DD HH24:MI:SS') AS process_time,process_comments,to_char(get_time,'YYYY-MM-DD HH24:MI:SS') AS get_time FROM t_energy_wallet_trade_list WHERE ${where} ORDER BY rid DESC LIMIT $4 OFFSET $5`,[...values,input.pageSize,(input.page-1)*input.pageSize])
  return Response.json({rows:result.rows.map(row=>({...row,process_status_label:statusLabels[Number(row.process_status)]||`未知状态 (${row.process_status})`,can_reissue:[4,5,6,7].includes(Number(row.process_status))})),total:total.rows[0].total,page:input.page,pageSize:input.pageSize,canReissue:can(user,'兑换补发','admin.energy.trade.reorder'),telegramEnabled:process.env.PLATFORM_TELEGRAM_ACTIONS==='true'},{headers})
 }
 if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
 if(request.headers.get('content-type')?.includes('application/json')!==true)return Response.json({message:'请求格式无效'},{status:415,headers})
 let expectedOrigin='';try{expectedOrigin=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:''}catch{}
 if(!expectedOrigin||request.headers.get('origin')!==expectedOrigin)return Response.json({message:'请求来源无效'},{status:403,headers})
 let body:unknown;try{body=await request.json()}catch{return Response.json({message:'请求内容无效'},{status:400,headers})}
 const input=z.object({action:z.literal('reissue'),rid:idSchema}).strict().parse(body)
 if(!can(user,'兑换补发','admin.energy.trade.reorder'))return Response.json({message:'没有操作权限'},{status:403,headers})
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return Response.json({message:'当前开发环境未启用外部机器人操作'},{status:409,headers})
 const client=await db.connect();try{
  await client.query('BEGIN')
  const current=await client.query('SELECT process_status FROM t_energy_wallet_trade_list WHERE rid=$1 FOR UPDATE',[input.rid])
  if(!current.rowCount){await client.query('ROLLBACK');return Response.json({message:'交易数据不存在'},{status:404,headers})}
  if(![4,5,6,7].includes(Number(current.rows[0].process_status))){await client.query('ROLLBACK');return Response.json({message:'状态为失败时才能补发'},{status:409,headers})}
  await client.query("UPDATE t_energy_wallet_trade_list SET process_status=1,tg_notice_status_send='N' WHERE rid=$1",[input.rid])
  await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.trade.reissue',input.rid])
  await client.query('COMMIT');return Response.json({ok:true,message:'补发任务已提交'},{headers})
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
})}
