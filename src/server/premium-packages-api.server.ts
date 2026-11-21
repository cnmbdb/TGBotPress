import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { can, identity, run, type Identity } from './api.server'
import { db } from './db.server'
import { priceUnits } from '@tgbotpress/plugin-premium'
import { BotServiceError } from './bot-service.server'
import { boundedFormData, saveMessageImage } from './media-storage.server'
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'},base='admin.premium.package'
const id=z.coerce.number().int().positive().max(2_147_483_647)
const access=(u:Identity)=>can(u,'会员管理',base+'.index')&&can(u,'会员套餐',base+'.index')
const perms={create:['添加会员套餐','add'],update:['修改能量套餐','update'],delete:['删除能量套餐','delete'],status:['修改能量套餐','change_status'],copy:['复制会员套餐','copy_paste']} as const
const permitted=(u:Identity,a:keyof typeof perms)=>can(u,perms[a][0],base+'.'+perms[a][1])
const month=z.union([z.literal(3),z.literal(6),z.literal(12)])
const money=z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/,'售价格式无效')
function priceValid(v:string){return priceUnits(v)!==null}
function originError(req:Request){const expected=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:'';if(!expected||req.headers.get('origin')!==expected)return Response.json({message:'请求来源无效'},{status:403,headers});return null}
async function parseBody(req:Request){
 const type=req.headers.get('content-type')||''
 if(type.startsWith('application/json')){const raw=await req.text();if(raw.length>32768)throw new BotServiceError(413,'表单内容过长');try{return{body:JSON.parse(raw),upload:undefined as File|undefined}}catch{throw new BotServiceError(400,'表单内容无效')}}
 if(type.startsWith('multipart/form-data')){const form=await boundedFormData(req),payload=form.get('payload'),file=form.get('thumb');if(typeof payload!=='string'||payload.length>32768)throw new BotServiceError(400,'表单内容无效');let body:unknown;try{body=JSON.parse(payload)}catch{throw new BotServiceError(400,'表单内容无效')}if(file!==null&&!(file instanceof File))throw new BotServiceError(400,'图片文件无效');return{body,upload:file instanceof File?file:undefined}}
 throw new BotServiceError(415,'请求格式无效')
}
export function premiumPackagesApi(req:Request){return run(async()=>{
 const user=await identity(req),url=new URL(req.url)
 if(!access(user))return Response.json({message:'没有访问权限'},{status:403,headers})
 if(req.method==='GET'){
  if(url.searchParams.get('action')==='options'){const [bots,platforms]=await Promise.all([db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC'),db.query('SELECT p.rid,p.bot_rid,p.platform_name,b.bot_firstname,b.bot_username,p.status FROM t_premium_platform p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid ORDER BY p.rid DESC')]);return Response.json({bots:bots.rows,platforms:platforms.rows},{headers})}
  if(url.searchParams.get('action')==='show'){const rid=id.parse(url.searchParams.get('rid'));const r=await db.query(`SELECT p.rid,p.bot_rid,p.premium_platform_rid,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.seq_sn,p.status,p.show_notes,p.package_pic,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time,b.bot_firstname,b.bot_username FROM t_premium_platform_package p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid WHERE p.rid=$1`,[rid]);if(!r.rowCount)return Response.json({message:'会员套餐不存在'},{status:404,headers});return Response.json({row:r.rows[0]},{headers})}
  const q=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),botRid:z.union([z.literal('all'),id]).default('all'),search:z.string().trim().max(50).default('')}).parse(Object.fromEntries(url.searchParams))
  const bot=q.botRid==='all'?null:q.botRid,search='%'+q.search.replace(/[!%_]/g,c=>'!'+c)+'%',where="($1::int IS NULL OR p.bot_rid=$1) AND ($2='%%' OR COALESCE(p.package_name,'') ILIKE $2 ESCAPE '!')",values=[bot,search]
  const [n,r]=await Promise.all([db.query('SELECT count(*)::int AS total FROM t_premium_platform_package p WHERE '+where,values),db.query(`SELECT p.rid,p.bot_rid,b.bot_firstname,b.bot_username,p.premium_platform_rid,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.seq_sn,p.status,p.show_notes,p.package_pic,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time FROM t_premium_platform_package p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid WHERE ${where} ORDER BY p.rid DESC LIMIT $3 OFFSET $4`,[...values,q.pageSize,(q.page-1)*q.pageSize])])
  return Response.json({rows:r.rows,total:n.rows[0].total,page:q.page,pageSize:q.pageSize,canAdd:permitted(user,'create'),canEdit:permitted(user,'update'),canDelete:permitted(user,'delete'),canStatus:permitted(user,'status'),canCopy:permitted(user,'copy')},{headers})
 }
 if(req.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
 const badOrigin=originError(req);if(badOrigin)return badOrigin
 let stored:{url:string;remove:()=>Promise<void>}|undefined
 try{
  const {body,upload}=await parseBody(req),action=z.object({action:z.enum(['create','update','delete','status','copy'])}).parse(body).action
  if(!permitted(user,action))return Response.json({message:'没有操作权限'},{status:403,headers})
  if(upload&&action!=='update')return Response.json({message:'仅编辑套餐时可以上传图片'},{status:400,headers})
  const c=await db.connect()
  try{
   await c.query('BEGIN');let rid:number|null=null,message=''
   if(action==='create'||action==='update'){
    const shape={premium_platform_rid:id,package_name:z.string().trim().min(1,'套餐名称不能为空').max(50),package_month:month,usdt_price:money,seq_sn:z.preprocess(v=>v===''||v===undefined||v===null?0:v,z.coerce.number().int().min(0).max(2_147_483_647)),show_notes:z.string().trim().max(1000).default('')}
    const input=z.object({action:z.enum(['create','update']),...(action==='update'?{rid:id}:{}),...shape}).strict().parse(body)
    if(!priceValid(input.usdt_price)){await c.query('ROLLBACK');return Response.json({message:'USDT 售价必须大于 0'},{status:400,headers})}
    const platform=await c.query('SELECT rid,bot_rid FROM t_premium_platform WHERE rid=$1 FOR UPDATE',[input.premium_platform_rid])
    if(!platform.rowCount){await c.query('ROLLBACK');return Response.json({message:'会员平台不存在'},{status:400,headers})}
    let image=''
    if(action==='update'){
     const old=await c.query('SELECT rid,package_pic FROM t_premium_platform_package WHERE rid=$1 FOR UPDATE',[input.rid])
     if(!old.rowCount){await c.query('ROLLBACK');return Response.json({message:'会员套餐不存在'},{status:404,headers})}
     image=old.rows[0].package_pic||''
    }
    if(upload){try{stored=await saveMessageImage(upload);image=stored.url}catch(error){await c.query('ROLLBACK');if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers});throw error}if(image.length>200){await c.query('ROLLBACK');throw new BotServiceError(400,'图片地址超过数据库限制')}}
    if(action==='create'){
     const created=await c.query(`INSERT INTO t_premium_platform_package(bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,show_notes,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING rid`,[platform.rows[0].bot_rid,input.premium_platform_rid,input.package_name,input.package_month,input.usdt_price,'premium_'+randomUUID().replaceAll('-',''),input.seq_sn,input.show_notes]);rid=created.rows[0].rid;message='会员套餐已添加'
    }else{
     const updated=await c.query(`UPDATE t_premium_platform_package SET bot_rid=$2,premium_platform_rid=$3,package_name=$4,package_month=$5,usdt_price=$6,seq_sn=$7,show_notes=$8,package_pic=$9,update_time=now() WHERE rid=$1 RETURNING rid`,[input.rid,platform.rows[0].bot_rid,input.premium_platform_rid,input.package_name,input.package_month,input.usdt_price,input.seq_sn,input.show_notes,image]);rid=updated.rows[0]?.rid;if(!rid){await c.query('ROLLBACK');return Response.json({message:'会员套餐不存在'},{status:404,headers})}message='会员套餐已更新'
    }
   }else if(action==='status'){
    const input=z.object({action:z.literal('status'),rid:id,enabled:z.boolean()}).strict().parse(body);rid=input.rid
    const changed=await c.query('UPDATE t_premium_platform_package SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid',[rid,input.enabled?0:1]);if(!changed.rowCount){await c.query('ROLLBACK');return Response.json({message:'会员套餐不存在'},{status:404,headers})}message=input.enabled?'会员套餐已启用':'会员套餐已停用'
   }else if(action==='delete'){
    const input=z.object({action:z.literal('delete'),rid:id}).strict().parse(body);rid=input.rid
    const removed=await c.query('DELETE FROM t_premium_platform_package WHERE rid=$1 RETURNING rid',[rid]);if(!removed.rowCount){await c.query('ROLLBACK');return Response.json({message:'会员套餐不存在'},{status:404,headers})}message='会员套餐已删除'
   }else{
    const input=z.object({action:z.literal('copy'),sourcePlatformRid:id,targetPlatformRid:id}).strict().parse(body)
    if(input.sourcePlatformRid===input.targetPlatformRid){await c.query('ROLLBACK');return Response.json({message:'来源平台和覆盖平台不能相同'},{status:400,headers})}
    const platforms=await c.query('SELECT rid,bot_rid FROM t_premium_platform WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE',[[input.sourcePlatformRid,input.targetPlatformRid]])
    if(platforms.rowCount!==2){await c.query('ROLLBACK');return Response.json({message:'来源或覆盖平台不存在'},{status:404,headers})}
    const from=platforms.rows.find(x=>Number(x.rid)===input.sourcePlatformRid),to=platforms.rows.find(x=>Number(x.rid)===input.targetPlatformRid)
    const source=await c.query('SELECT count(*)::int AS total FROM t_premium_platform_package WHERE premium_platform_rid=$1',[input.sourcePlatformRid])
    if(!Number(source.rows[0].total)){await c.query('ROLLBACK');return Response.json({message:'来源平台没有可复制套餐'},{status:400,headers})}
    await c.query('DELETE FROM t_premium_platform_package WHERE premium_platform_rid=$1',[input.targetPlatformRid])
    const copied=await c.query(`INSERT INTO t_premium_platform_package(bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,status,show_notes,package_pic,comments,create_time)
      SELECT $2,$3,package_name,package_month,usdt_price,'premium_'||md5(random()::text||clock_timestamp()::text||rid::text),seq_sn,status,show_notes,package_pic,comments,now()
      FROM t_premium_platform_package WHERE premium_platform_rid=$1 ORDER BY rid RETURNING rid`,[input.sourcePlatformRid,to.bot_rid,input.targetPlatformRid])
    rid=copied.rows[0]?.rid??null;message=`已复制 ${copied.rowCount} 个套餐并覆盖目标平台`
   }
   await c.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,base+'.'+action,rid]);await c.query('COMMIT');stored=undefined
   return Response.json({ok:true,message},{headers})
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }catch(error){if(stored)await stored.remove();if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers});throw error}
})}

