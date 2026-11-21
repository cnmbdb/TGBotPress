import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run, type Identity } from './api.server'
import { BotServiceError } from './bot-service.server'
import { TelegramConfigService, normalizeCustomEmojiId } from './telegram-config-service.server'
import { visibleNavigation } from '../lib/navigation'
import { telegramConfig, type ConfigKind } from '../config/telegram-config'
import { annotatePluginConfigRows } from '../plugins/plugin-config-links.server'
const service=new TelegramConfigService(db)
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
const id=z.coerce.number().int().positive().max(2147483647)
const integer=z.coerce.number().int().min(-2147483648).max(2147483647)
const kindSchema=z.enum(['command','keyboard'])
export function configPermissions(user:Identity,kind:ConfigKind){
 const command=kind==='command',prefix=`admin.telegram.${kind}.`
 return {add:can(user,command?'添加命令':'添加键盘名称',prefix+'add'),update:can(user,command?'修改命令':'修改键盘名称',prefix+'update'),delete:can(user,command?'删除命令':'删除键盘名称',prefix+'delete'),status:!command&&can(user,'修改键盘名称',prefix+'change_status'),sync:command&&can(user,'同步命令',prefix+'sync'),copy:command&&can(user,'复制命令',prefix+'copy_paste')}
}
const commandFields={bot_rid:id,command_type:z.coerce.number().int().min(1).max(3),command:z.string().trim().min(1).max(50),description:z.string().trim().min(1).max(100),seq_sn:integer}
const keyboardFields={keyboard_type:z.coerce.number().int().min(1).max(2),keyboard_name:z.string().trim().min(1).max(20),keyboard_icon_custom_emoji_id:z.string().max(500).default(''),inline_type:z.coerce.number().int().min(0).max(2),keyboard_value:z.string().max(500).default('-'),seq_sn:integer}
export async function telegramConfigApi(request:Request){return run(async()=>{
 try{
  let body:unknown
  const url=new URL(request.url)
  if(request.method==='POST'){
   const origin=process.env.PLATFORM_ORIGIN&&new URL(process.env.PLATFORM_ORIGIN).origin
   if(request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({message:'请求来源无效'},{status:403,headers})
   const raw=await request.text();if(raw.length>16384)return Response.json({message:'输入内容过长'},{status:413,headers})
   try{body=JSON.parse(raw)}catch{return Response.json({message:'请检查输入内容'},{status:400,headers})}
  }
  const kind=kindSchema.parse(request.method==='POST'?z.object({kind:kindSchema}).parse(body).kind:url.searchParams.get('kind'))
  const user=await identity(request)
  if(!visibleNavigation(user).some(group=>group.items.some(item=>item.id===telegramConfig[kind].route)))return Response.json({message:'没有访问权限'},{status:403,headers})
  if(request.method==='GET'){
   if(url.searchParams.get('action')==='options')return Response.json(await service.options(),{headers})
   const data=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(30),z.literal(40),z.literal(50),z.literal(60),z.literal(70),z.literal(80),z.literal(90)])).default(10),search:z.string().trim().max(100).default(''),bot:id.optional()}).parse(Object.fromEntries(url.searchParams))
   const listed=await service.list(kind,data.page,data.pageSize,data.search,data.bot)
   const rows=await annotatePluginConfigRows(db,kind,listed.rows)
   return Response.json({...listed,rows,permissions:configPermissions(user,kind)},{headers})
  }
  const action=z.object({action:z.enum(['add','update','delete','status','sync','copy'])}).parse(body).action
  if(!configPermissions(user,kind)[action])return Response.json({message:'没有操作权限'},{status:403,headers})
  let result:unknown
  if(action==='add'||action==='update'){
   const schema=z.object({kind:kindSchema,action:z.enum(['add','update']),...(action==='update'?{rid:id}:{}),...(kind==='command'?commandFields:keyboardFields)}).strict()
   const data=schema.parse(body)
   if(kind==='command'){
    const values=z.object(commandFields).parse(data)
    result=await service.saveCommand(values,user.id,action==='update'?id.parse(data.rid):undefined)
   }else{
    const values=z.object(keyboardFields).parse(data)
    result=await service.saveKeyboard({...values,keyboard_icon_custom_emoji_id:normalizeCustomEmojiId(values.keyboard_icon_custom_emoji_id)},user.id,action==='update'?id.parse(data.rid):undefined)
   }
  }else if(action==='delete'){
   const data=z.object({kind:kindSchema,action:z.literal('delete'),rid:id}).strict().parse(body);result=await service.remove(kind,data.rid,user.id)
  }else if(action==='status'){
   const data=z.object({kind:z.literal('keyboard'),action:z.literal('status'),rid:id,enabled:z.boolean()}).strict().parse(body);result=await service.status(data.rid,data.enabled,user.id)
  }else if(action==='copy'){
   const data=z.object({kind:z.literal('command'),action:z.literal('copy'),source:id,target:id,confirm:z.literal(true)}).strict().parse(body);result=await service.copyCommands(data.source,data.target,user.id)
  }else{
   const data=z.object({kind:z.literal('command'),action:z.literal('sync'),bot_rid:id}).strict().parse(body);result=await service.syncCommands(data.bot_rid,user.id)
  }
  return Response.json({ok:true,data:result,message:action==='delete'?'删除成功':action==='copy'?'复制成功':action==='sync'?'同步成功':'保存成功'},{headers})
 }catch(error){if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers});throw error}
})}
