import { z } from 'zod'
import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk'
export type UsersIdentity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
export type UsersApiHost = { db: Pick<Pool, 'query' | 'connect'>; identity: (request: Request) => Promise<UsersIdentity>; can: (user: UsersIdentity, permission: string, route: string) => boolean; run: (handler: () => Promise<Response>) => Promise<Response> }
export function createUsersApi(host: UsersApiHost) {
const { db, can, identity, run } = host

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statusLabels: Record<number, string> = { 1: '使用中', 2: '已停用', 3: '用户不存在' }
const actionable = ['发送消息', '群发消息', '用户充值', '删除用户', '批量删除停用'] as const
function permissions(user: Awaited<ReturnType<typeof identity>>) {
  return Object.fromEntries(actionable.map(name => [name, can(user, name, `admin.groupuser.user.${name === '用户充值' ? 'rechargemanual' : name === '删除用户' ? 'delete' : name === '批量删除停用' ? 'batchdelete' : name === '群发消息' ? 'batchsendmessage' : 'sendmessage'}`)]))
}
function originAllowed(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  return !!origin && request.headers.get('origin') === origin && !!request.headers.get('content-type')?.startsWith('application/json')
}
async function telegramSend(token: string, chatId: string, message: string) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return { ok: false, description: '当前开发环境未启用外部机器人操作' }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }), signal: AbortSignal.timeout(12_000) })
    return await response.json() as { ok?: boolean; result?: unknown; description?: string }
  } catch { return { ok: false, description: 'Telegram 接口暂时无法连接' } }
}

function usersApi(request: Request) {
 return run(async()=>{
  const user=await identity(request)
  if(!can(user,'用户列表','admin.groupuser.user.index'))return Response.json({message:'没有访问权限'},{status:403,headers})
  if(request.method==='GET'){
   const url=new URL(request.url)
   if(url.searchParams.get('action')==='options'){
    const bots=await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC')
    return Response.json({bots:bots.rows},{headers})
   }
   const input=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15),username:z.string().trim().max(200).default(''),uid:z.string().trim().max(100).default(''),nickname:z.string().trim().max(200).default(''),botRid:z.union([z.literal('all'),z.coerce.number().int().positive()]).default('all')}).parse(Object.fromEntries(url.searchParams))
   const clean=input.username.replace(/^https?:\/\/t\.me\//i,'').replace(/^@/,'')
   const like=(v:string)=>`%${v.replace(/[!%_]/g,c=>`!${c}`)}%`
   const values=[like(clean),like(input.uid),like(input.nickname),input.botRid==='all'?null:input.botRid]
   const where="($1='%%' OR a.tg_username ILIKE $1 ESCAPE '!') AND ($2='%%' OR a.tg_uid::text ILIKE $2 ESCAPE '!') AND ($3='%%' OR a.tg_nickname ILIKE $3 ESCAPE '!') AND ($4::int IS NULL OR a.bot_rid=$4)"
   const total=await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot_user a WHERE ${where}`,values)
   const rows=await db.query(`SELECT a.rid,a.bot_rid,a.tg_uid::text AS tg_uid,a.tg_username,a.tg_nickname,a.status,a.bind_trc_wallet_addr,a.cash_trx::text AS cash_trx,a.cash_usdt::text AS cash_usdt,a.max_monitor_wallet,
    to_char(a.first_time,'YYYY-MM-DD HH24:MI:SS') AS first_time,to_char(a.last_time,'YYYY-MM-DD HH24:MI:SS') AS last_time,to_char(a.stop_time,'YYYY-MM-DD HH24:MI:SS') AS stop_time,b.bot_firstname,b.bot_username
    FROM t_telegram_bot_user a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where} ORDER BY a.rid DESC LIMIT $5 OFFSET $6`,[...values,input.pageSize,(input.page-1)*input.pageSize])
   return Response.json({rows:rows.rows.map(row=>({...row,status_label:statusLabels[row.status]||`未知状态 (${row.status})`})),total:total.rows[0].total,page:input.page,pageSize:input.pageSize,permissions:permissions(user),telegramEnabled:process.env.PLATFORM_TELEGRAM_ACTIONS==='true'},{headers})
  }
  if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
  if(!originAllowed(request))return Response.json({message:'请求来源无效'},{status:403,headers})
  const length=Number(request.headers.get('content-length')||0);if(length>12_000)return Response.json({message:'输入内容过长'},{status:413,headers})
  const raw=await request.text();if(raw.length>12_000)return Response.json({message:'输入内容过长'},{status:413,headers})
  let body:unknown;try{body=JSON.parse(raw)}catch{return Response.json({message:'请检查输入内容'},{status:400,headers})}
  const action=z.object({action:z.enum(['sendmessage','batchsendmessage','rechargemanual','delete','batchdelete'])}).parse(body).action
  const rights=permissions(user)
  const rightsForAction:Record<typeof action,typeof actionable[number]>={sendmessage:'发送消息',batchsendmessage:'群发消息',rechargemanual:'用户充值',delete:'删除用户',batchdelete:'批量删除停用'}
  if(!rights[rightsForAction[action]])return Response.json({message:'没有操作权限'},{status:403,headers})
  const id=z.coerce.number().int().positive().max(2147483647)
  if(action==='sendmessage'){
   const data=z.object({action:z.literal('sendmessage'),rid:id,message:z.string().trim().min(1).max(4096)}).strict().parse(body)
   const result=await db.query('SELECT u.rid,u.bot_rid,u.tg_uid::text AS tg_uid,u.status,b.bot_token FROM t_telegram_bot_user u LEFT JOIN t_telegram_bot b ON b.rid=u.bot_rid WHERE u.rid=$1',[data.rid])
   if(!result.rowCount)return Response.json({message:'数据不存在'},{status:404,headers})
   const row=result.rows[0];if(row.status!==1)return Response.json({message:'用户状态不为使用中'},{status:409,headers});if(!row.bot_token)return Response.json({message:'机器人数据不存在或未配置 Token'},{status:409,headers})
   const sent=await telegramSend(row.bot_token,row.tg_uid,data.message)
   if(sent.ok&&sent.result){await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'groupuser.user.send_message',data.rid]);return Response.json({ok:true,message:'发送成功'},{headers})}
   if(sent.description==='Forbidden: user is deactivated')await db.query('UPDATE t_telegram_bot_user SET status=3,stop_time=now() WHERE rid=$1 AND status=1',[data.rid])
   return Response.json({message:`发送失败：${sent.description||'Telegram 返回未知错误'}`},{status:502,headers})
  }
  if(action==='batchsendmessage'){
   if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return Response.json({message:'当前开发环境未启用外部机器人操作'},{status:409,headers})
   const data=z.object({action:z.literal('batchsendmessage'),bot_rid:id,message:z.string().trim().min(1).max(4096)}).strict().parse(body)
   const bot=await db.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1',[data.bot_rid]);if(!bot.rowCount||!bot.rows[0].bot_token)return Response.json({message:'机器人数据不存在或未配置 Token'},{status:404,headers})
   const recipients=await db.query("SELECT rid,tg_uid::text AS tg_uid FROM t_telegram_bot_user WHERE bot_rid=$1 AND status=1 ORDER BY rid",[data.bot_rid]);if(!recipients.rowCount)return Response.json({message:'机器人无用户数据'},{status:409,headers})
   let sentCount=0,failedCount=0,deactivatedCount=0
   for(let i=0;i<recipients.rows.length;i+=5){
    const batch=recipients.rows.slice(i,i+5)
    const results=await Promise.all(batch.map(async recipient=>({recipient,result:await telegramSend(bot.rows[0].bot_token,recipient.tg_uid,data.message)})))
    const inactive=results.filter(item=>item.result.description==='Forbidden: user is deactivated').map(item=>item.recipient.rid)
    sentCount+=results.filter(item=>item.result.ok&&item.result.result).length;failedCount+=results.filter(item=>!item.result.ok||!item.result.result).length;deactivatedCount+=inactive.length
    if(inactive.length)await db.query('UPDATE t_telegram_bot_user SET status=3,stop_time=now() WHERE rid=ANY($1::int[]) AND status=1',[inactive])
   }
   await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'groupuser.user.broadcast',data.bot_rid])
   return Response.json({ok:true,message:`群发完成：成功 ${sentCount}，失败 ${failedCount}，停用 ${deactivatedCount}`},{headers})
  }
  if(action==='rechargemanual'){
   const money=z.string().trim().regex(/^\d{1,14}(?:\.\d{1,6})?$/,'余额必须是非负数字，最多 6 位小数').optional().or(z.literal(''))
   const data=z.object({action:z.literal('rechargemanual'),rid:id,cash_trx:money,cash_usdt:money,max_monitor_wallet:z.string().trim().regex(/^\d{1,10}$/,'数量必须是非负整数').optional().or(z.literal(''))}).strict().parse(body)
   const updates:Array<[string,string]> = [];if(data.cash_trx)updates.push(['cash_trx',data.cash_trx]);if(data.cash_usdt)updates.push(['cash_usdt',data.cash_usdt]);if(data.max_monitor_wallet)updates.push(['max_monitor_wallet',data.max_monitor_wallet]);if(!updates.length)return Response.json({message:'请至少填写一个充值项'},{status:400,headers})
   const client=await db.connect();try{await client.query('BEGIN');const current=await client.query('SELECT rid FROM t_telegram_bot_user WHERE rid=$1 FOR UPDATE',[data.rid]);if(!current.rowCount){await client.query('ROLLBACK');return Response.json({message:'用户不存在'},{status:404,headers})}const fields=updates.map(([key])=>key),values=updates.map(([,value])=>value),set=fields.map((field,index)=>`${field}=$${index+2}`).join(',');await client.query(`UPDATE t_telegram_bot_user SET ${set} WHERE rid=$1`,[data.rid,...values]);await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'groupuser.user.manual_recharge',data.rid]);await client.query('COMMIT');return Response.json({ok:true,message:'充值成功'},{headers})}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  if(action==='delete'){
   const data=z.object({action:z.literal('delete'),rid:id}).strict().parse(body);const client=await db.connect();try{await client.query('BEGIN');const deleted=await client.query('DELETE FROM t_telegram_bot_user WHERE rid=$1 RETURNING rid',[data.rid]);if(!deleted.rowCount){await client.query('ROLLBACK');return Response.json({message:'用户不存在或已删除'},{status:404,headers})}await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'groupuser.user.delete',data.rid]);await client.query('COMMIT');return Response.json({ok:true,message:'删除成功'},{headers})}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  const data=z.object({action:z.literal('batchdelete'),bot_rid:id}).strict().parse(body);const client=await db.connect();try{await client.query('BEGIN');const deleted=await client.query('DELETE FROM t_telegram_bot_user WHERE bot_rid=$1 AND status IN (2,3) RETURNING rid',[data.bot_rid]);if(!deleted.rowCount){await client.query('ROLLBACK');return Response.json({message:'没有可删除的停用用户'},{status:404,headers})}await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'groupuser.user.batch_delete_inactive',data.bot_rid]);await client.query('COMMIT');return Response.json({ok:true,message:`已删除 ${deleted.rowCount} 个停用用户`},{headers})}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 })
}

return usersApi
}
