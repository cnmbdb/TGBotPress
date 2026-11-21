import { z } from 'zod'
import { can, identity, run, type Identity } from './api.server'
import { db } from './db.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const base = 'admin.energy.aibishu'
const pageRoute = base + '.index'
const statusLabels: Record<number,string> = { 0:'开启', 1:'关闭', 2:'管理员关闭' }
const buyLabels: Record<string,string> = { N:'无需下单', Y:'需要下单', B:'下单中' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const natural = z.coerce.number().int().min(0).max(2_147_483_647)
const money = z.string().trim().max(15).regex(/^\d{1,12}(?:\.\d{1,2})?$/)
const address = z.string().trim().length(34).regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/,'请输入有效的波场地址')
const access = (user: Identity) => can(user,'能量管理',pageRoute) && can(user,'笔数能量',pageRoute)
const permitted = (user: Identity, permission: string, action: string) => can(user,permission,base+'.'+action)

function originError(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected) return Response.json({message:'请求来源无效'},{status:403,headers})
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({message:'请求格式无效'},{status:415,headers})
  return null
}
function moneyValid(value: string) {
  const [whole, fraction=''] = value.split('.')
  return BigInt(whole)*100n + BigInt((fraction+'00').slice(0,2)) >= 0n
}
function clean(row: any) {
  return {
    ...row, rid:Number(row.rid), bot_rid:Number(row.bot_rid), status:Number(row.status), package_open:String(row.package_open).trim()==='Y',
    current_bandwidth_quantity:String(row.current_bandwidth_quantity ?? 0),
    current_energy_quantity:String(row.current_energy_quantity ?? 0),
    total_buy_energy_quantity:String(row.total_buy_energy_quantity ?? 0),
    total_buy_quantity:Number(row.total_buy_quantity ?? 0), max_buy_quantity:Number(row.max_buy_quantity ?? 0),
    bishu_stop_day:Number(row.bishu_stop_day ?? 0), total_buy_usdt:String(row.total_buy_usdt ?? '0'),
    status_label:statusLabels[Number(row.status)] ?? '未知状态',
    is_buy_label:buyLabels[String(row.is_buy).trim()] ?? '未知状态',
  }
}

export function energyAiBishuApi(request: Request) {
 return run(async()=>{
  const user=await identity(request)
  if(!access(user))return Response.json({message:'没有访问权限'},{status:403,headers})
  if(request.method==='GET'){
   const url=new URL(request.url)
   if(url.searchParams.get('action')==='options'){
    const result=await db.query('SELECT b.rid,b.bot_username,b.bot_firstname,COALESCE(e.is_open_bishu,\'N\') AS is_open_bishu FROM t_telegram_bot b LEFT JOIN (SELECT bot_rid,CASE WHEN bool_or(is_open_bishu=\'Y\') THEN \'Y\' ELSE \'N\' END AS is_open_bishu FROM t_energy_platform_bot GROUP BY bot_rid) e ON e.bot_rid=b.rid ORDER BY b.rid DESC')
    return Response.json({bots:result.rows.map(row=>({...row,rid:Number(row.rid),is_open_bishu:String(row.is_open_bishu).trim()==='Y'}))},{headers})
   }
   const input=z.object({
    page:z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),
    bot_rid:z.string().trim().max(12).default(''), tg_uid:z.string().trim().max(100).default(''), wallet_addr:z.string().trim().max(100).default(''),
   }).parse(Object.fromEntries(url.searchParams))
   const botId=input.bot_rid? id.parse(input.bot_rid):null
   const filters=['($1::int IS NULL OR a.bot_rid=$1)','($2=\'%%\' OR a.tg_uid ILIKE $2 ESCAPE \'!\')','($3=\'%%\' OR a.wallet_addr ILIKE $3 ESCAPE \'!\')'].join(' AND ')
   const values=[botId,'%'+input.tg_uid.replace(/[!%_]/g,c=>'!'+c)+'%','%'+input.wallet_addr.replace(/[!%_]/g,c=>'!'+c)+'%']
   const count=await db.query('SELECT count(*)::int AS total FROM t_energy_ai_bishu a WHERE '+filters,values)
   const result=await db.query(
    'SELECT a.rid,a.bot_rid,b.bot_username,b.bot_firstname,a.tg_uid,a.wallet_addr,a.status,a.is_buy,'+
    'a.current_bandwidth_quantity,a.current_energy_quantity,a.total_buy_energy_quantity,a.total_buy_quantity,a.max_buy_quantity,a.total_buy_usdt,a.bishu_stop_day,'+
    'to_char(a.create_time AT TIME ZONE \'Asia/Shanghai\',\'YYYY-MM-DD HH24:MI:SS\') AS create_time,a.back_comments,a.comments,COALESCE(e.is_open_bishu,\'N\') AS package_open '+
    'FROM t_energy_ai_bishu a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid LEFT JOIN (SELECT bot_rid,CASE WHEN bool_or(is_open_bishu=\'Y\') THEN \'Y\' ELSE \'N\' END AS is_open_bishu FROM t_energy_platform_bot GROUP BY bot_rid) e ON e.bot_rid=a.bot_rid '+
    'WHERE '+filters+' ORDER BY a.rid DESC LIMIT $4 OFFSET $5',[...values,input.pageSize,(input.page-1)*input.pageSize])
   return Response.json({
    rows:result.rows.map(clean),total:count.rows[0].total,page:input.page,pageSize:input.pageSize,
    canAdd:permitted(user,'添加地址笔数','add'),canEdit:permitted(user,'修改笔数能量','update'),
    canDelete:permitted(user,'删除笔数能量','delete'),canRefresh:permitted(user,'刷新笔数能量','refresh'),
    bots:(await db.query('SELECT b.rid,b.bot_username,b.bot_firstname,COALESCE(e.is_open_bishu,\'N\') AS is_open_bishu FROM t_telegram_bot b LEFT JOIN (SELECT bot_rid,CASE WHEN bool_or(is_open_bishu=\'Y\') THEN \'Y\' ELSE \'N\' END AS is_open_bishu FROM t_energy_platform_bot GROUP BY bot_rid) e ON e.bot_rid=b.rid ORDER BY b.rid DESC')).rows.map(row=>({...row,rid:Number(row.rid),is_open_bishu:String(row.is_open_bishu).trim()==='Y'})),
   },{headers})
  }
  if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
  const rejected=originError(request);if(rejected)return rejected
  let raw:unknown;try{raw=await request.json()}catch{return Response.json({message:'请求内容无效'},{status:400,headers})}
  const fields={
   bot_rid:id, tg_uid:z.string().trim().max(100).default(''), wallet_addr:address,
   total_buy_usdt:money, max_buy_quantity:natural,total_buy_quantity:natural,bishu_stop_day:natural,
   back_comments:z.string().trim().max(2000).default(''),
  }
  const payload=z.discriminatedUnion('action',[
   z.object({action:z.literal('add'),...fields}).strict(),
   z.object({action:z.literal('update'),rid:id,bot_rid:id,tg_uid:z.string().trim().max(100).default(''),wallet_addr:address,status:z.coerce.number().int().min(0).max(2),max_buy_quantity:natural,total_buy_quantity:natural,bishu_stop_day:natural,back_comments:z.string().trim().max(2000).default('')}).strict(),
   z.object({action:z.literal('delete'),rid:id}).strict(),
   z.object({action:z.literal('refresh'),rid:id}).strict(),
  ]).parse(raw)
  if(payload.action==='add'&&!permitted(user,'添加地址笔数','add'))return Response.json({message:'没有添加权限'},{status:403,headers})
  if(payload.action==='update'&&!permitted(user,'修改笔数能量','update'))return Response.json({message:'没有修改权限'},{status:403,headers})
  if(payload.action==='delete'&&!permitted(user,'删除笔数能量','delete'))return Response.json({message:'没有删除权限'},{status:403,headers})
  if(payload.action==='refresh'&&!permitted(user,'刷新笔数能量','refresh'))return Response.json({message:'没有刷新权限'},{status:403,headers})
  if(payload.action==='add'&&!moneyValid(payload.total_buy_usdt))return Response.json({message:'总购买 USDT 金额无效'},{status:400,headers})

  const client=await db.connect()
  try{
   await client.query('BEGIN')
   if(payload.action==='add'||payload.action==='update'){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[payload.wallet_addr])
    const duplicate=await client.query('SELECT rid FROM t_energy_ai_bishu WHERE wallet_addr=$1 AND ($2::int IS NULL OR rid<>$2) LIMIT 1',[payload.wallet_addr,payload.action==='update'?payload.rid:null])
    if(duplicate.rowCount){await client.query('ROLLBACK');return Response.json({message:'钱包地址已存在'},{status:409,headers})}
    const bot=await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1',[payload.bot_rid])
    if(!bot.rowCount){await client.query('ROLLBACK');return Response.json({message:'机器人不存在'},{status:404,headers})}
   }
   if(payload.action==='add'){
    const row=payload
    const created=await client.query(
     'INSERT INTO t_energy_ai_bishu(bot_rid,tg_uid,wallet_addr,total_buy_usdt,max_buy_quantity,total_buy_quantity,bishu_stop_day,back_comments,create_by,create_time,is_active) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),\'N\') RETURNING rid',
     [row.bot_rid,row.tg_uid,row.wallet_addr,row.total_buy_usdt,row.max_buy_quantity,row.total_buy_quantity,row.bishu_stop_day,row.back_comments,Number(user.id)])
    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.aibishu.add',created.rows[0].rid])
    await client.query('COMMIT');return Response.json({ok:true,message:'已添加地址笔数'},{headers})
   }
   if(payload.action==='update'){
    const row=payload
    const changed=await client.query('UPDATE t_energy_ai_bishu SET bot_rid=$2,tg_uid=$3,wallet_addr=$4,status=$5,max_buy_quantity=$6,total_buy_quantity=$7,bishu_stop_day=$8,back_comments=$9,update_by=$10,update_time=now() WHERE rid=$1 RETURNING rid',
     [row.rid,row.bot_rid,row.tg_uid,row.wallet_addr,row.status,row.max_buy_quantity,row.total_buy_quantity,row.bishu_stop_day,row.back_comments,Number(user.id)])
    if(!changed.rowCount){await client.query('ROLLBACK');return Response.json({message:'数据不存在'},{status:404,headers})}
    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.aibishu.update',row.rid])
    await client.query('COMMIT');return Response.json({ok:true,message:'笔数能量已更新'},{headers})
   }
   if(payload.action==='delete'){
    const deleted=await client.query('DELETE FROM t_energy_ai_bishu WHERE rid=$1 RETURNING rid',[payload.rid])
    if(!deleted.rowCount){await client.query('ROLLBACK');return Response.json({message:'数据不存在'},{status:404,headers})}
    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.aibishu.delete',payload.rid])
    await client.query('COMMIT');return Response.json({ok:true,message:'已删除笔数地址'},{headers})
   }
   const refreshed=await client.query("UPDATE t_energy_ai_bishu SET is_buy='N' WHERE rid=$1 RETURNING rid",[payload.rid])
   if(!refreshed.rowCount){await client.query('ROLLBACK');return Response.json({message:'数据不存在'},{status:404,headers})}
   await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.aibishu.refresh',payload.rid])
   await client.query('COMMIT');return Response.json({ok:true,message:'已刷新，下单状态已重置为无需下单'},{headers})
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 })
}
