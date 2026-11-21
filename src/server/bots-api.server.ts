import { z } from 'zod'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from './db.server'
import { identity, can, run, type Identity } from './api.server'
import { BotService, BotServiceError } from './bot-service.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const service = new BotService(db)
const id = z.coerce.number().int().positive().max(2147483647)
const token = z.string().trim().max(100).regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/)
const account = z.string().trim().max(100)
const comments = z.string().trim().max(255)
export function botPermissions(user: Identity) {
  const superAdmin=user.roles.includes('超级管理员')
  return { add:can(user,'添加机器人','admin.telegram.telegrambot.add'), update:can(user,'修改机器人','admin.telegram.telegrambot.update'), refresh:can(user,'更新机器人','admin.telegram.telegrambot.gengxin'), webhook:can(user,'注册Webhook','admin.telegram.telegrambot.regwebhook'), clone:superAdmin, delete:can(user,'删除机器人','admin.telegram.telegrambot.delete'), recharge:superAdmin }
}
export function isTronAddress(value: string) {
  if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let numeric=0n
  for(const letter of value) numeric=numeric*58n+BigInt(alphabet.indexOf(letter))
  let hex=numeric.toString(16); if(hex.length%2) hex='0'+hex
  const bytes=Buffer.from(hex,'hex')
  if(bytes.length!==25 || bytes[0]!==0x41) return false
  const expected=createHash('sha256').update(createHash('sha256').update(bytes.subarray(0,21)).digest()).digest().subarray(0,4)
  return timingSafeEqual(expected,bytes.subarray(21))
}
export function validLocalDate(value:string) {
  if(value==='') return true
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return false
  const parts=value.split(/[-T:]/).map(Number)
  const date=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]||0))
  return parts[0]>=1900 && date.getUTCFullYear()===parts[0] && date.getUTCMonth()===parts[1]-1 && date.getUTCDate()===parts[2] && date.getUTCHours()===parts[3] && date.getUTCMinutes()===parts[4] && date.getUTCSeconds()===(parts[5]||0)
}
export async function botManagement(request: Request) {
  return run(async()=> {
    try {
      if(request.method==='POST') {
        const origin=process.env.PLATFORM_ORIGIN && new URL(process.env.PLATFORM_ORIGIN).origin
        if(request.headers.get('origin')!==origin || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({message:'请求来源无效'},{status:403,headers})
      }
      const user=await identity(request)
      if(!can(user,'机器人列表','admin.telegram.telegrambot.index')) return Response.json({message:'没有访问权限'},{status:403,headers})
      if(request.method==='GET') {
        const url=new URL(request.url),action=url.searchParams.get('action') || 'list'
        if(action==='detail') return Response.json(await service.detail(id.parse(url.searchParams.get('rid'))),{headers})
        if(action==='options') return Response.json(await service.options(),{headers})
        if(action!=='list') return Response.json({message:'操作不存在'},{status:404,headers})
        const data=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(12),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(10),search:z.string().trim().max(100).default('')}).parse(Object.fromEntries(url.searchParams))
        const values=[`%${data.search}%`]
        const filter="($1='%%' OR bot_username ILIKE $1 OR bot_firstname ILIKE $1 OR bot_admin_username ILIKE $1 OR comments ILIKE $1)"
        const total=await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot WHERE ${filter}`,values)
        const rows=await db.query(`SELECT rid,bot_username,bot_firstname,bot_admin_username,comments,recharge_wallet_addr,to_char(get_tx_time,'YYYY-MM-DD"T"HH24:MI') AS get_tx_time,create_time AT TIME ZONE 'Asia/Shanghai' AS create_time,update_time AT TIME ZONE 'Asia/Shanghai' AS update_time,(bot_token<>'') AS token_configured FROM t_telegram_bot WHERE ${filter} ORDER BY rid DESC LIMIT $2 OFFSET $3`,[...values,data.pageSize,(data.page-1)*data.pageSize])
        return Response.json({rows:rows.rows,total:total.rows[0].total,permissions:botPermissions(user)}, {headers})
      }
      if(Number(request.headers.get('content-length') || 0)>16384) return Response.json({message:'输入内容过长'},{status:413,headers})
      const text=await request.text()
      if(text.length>16384) return Response.json({message:'输入内容过长'},{status:413,headers})
      let body:unknown
      try { body=JSON.parse(text) } catch { return Response.json({message:'请检查输入内容'},{status:400,headers}) }
      const action=z.object({action:z.enum(['add','update','refresh','webhook','clone','delete','recharge'])}).parse(body).action
      if(!botPermissions(user)[action]) return Response.json({message:'没有操作权限'},{status:403,headers})
      let result:unknown
      if(action==='add') {
        const data=z.object({action:z.literal('add'),bot_token:token,bot_admin_username:account,comments,clone_from_rid:id.optional()}).strict().parse(body)
        result=await service.add(data,user.id)
      } else if(action==='update') {
        const data=z.object({action:z.literal('update'),rid:id,bot_token:z.union([token,z.literal('')]).optional(),bot_admin_username:account,comments}).strict().parse(body)
        result=await service.update(data.rid,data,user.id)
      } else if(action==='clone') {
        const data=z.object({action:z.literal('clone'),rid:id,source:id.optional(),force:z.boolean().default(false)}).strict().parse(body)
        result=await service.clone(data.rid,data.source,data.force,user.id)
      } else if(action==='recharge') {
        const data=z.object({action:z.literal('recharge'),rid:id,address:z.string().trim().refine(value=>value==='' || isTronAddress(value)),date:z.string().refine(validLocalDate)}).strict().parse(body)
        result=await service.recharge(data.rid,data.address,data.date,user.id)
      } else {
        const data=z.object({action:z.enum(['refresh','webhook','delete']),rid:id}).strict().parse(body)
        result=action==='refresh' ? await service.refresh(data.rid,user.id) : action==='webhook' ? await service.webhook(data.rid,user.id) : await service.remove(data.rid,user.id)
      }
      return Response.json({ok:true,data:result,message:action==='clone'?'配置复制成功':action==='delete'?'删除成功':action==='webhook'?'Webhook 注册成功':action==='refresh'?'机器人信息已更新':'保存成功'},{headers})
    } catch(error) {
      if(error instanceof BotServiceError) return Response.json({message:error.message},{status:error.status,headers})
      throw error
    }
  })
}
