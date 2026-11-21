import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run, type Identity } from './api.server'
import { BotServiceError } from './bot-service.server'
import { boundedFormData,saveMessageImage } from './media-storage.server'
import { MessageConfigService } from './message-config-service.server'
import { visibleNavigation } from '../lib/navigation'
import { annotatePluginConfigRows } from '../plugins/plugin-config-links.server'
const service=new MessageConfigService(db),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
const kindSchema=z.enum(['reply','ad']),id=z.coerce.number().int().positive().max(2147483647)
const route={reply:'admin.telegram.keyreply.index',ad:'admin.telegram.telegrambotad.index'}
const labels={reply:'关键字回复',ad:'定时广告'}
const permission=(u:Identity,k:'reply'|'ad',action:'add'|'update'|'delete'|'status'|'copy')=>can(u,({add:`添加${labels[k]}`,update:`修改${labels[k]}`,delete:k==='reply'?'删除关键字回复人':'删除定时广告',status:`修改${labels[k]}`,copy:k==='reply'?'复制关键字':'复制定时广告'})[action],`admin.telegram.${k==='reply'?'keyreply':'telegrambotad'}.${({add:'add',update:'update',delete:'delete',status:'change_status',copy:'copy_paste'})[action]}`)
const replyFields={bot_rid:id,key_type:z.coerce.number().int().min(1).max(2),monitor_word:z.string().trim().min(1).max(500),reply_photo:z.string().max(300).default(''),reply_content:z.string().max(2000).default(''),opt_type:z.coerce.number().int().min(1).max(11)}
const adFields={bot_rid:id,notice_cycle:z.coerce.number().int().min(1).max(17),notice_obj:z.string().max(200).default('-'),notice_photo:z.string().max(500).default(''),notice_ad:z.string().min(1).max(2000)}
export async function messageConfigApi(request:Request){return run(async()=>{
 let stored:{url:string;remove:()=>Promise<void>}|undefined
 try{
  const url=new URL(request.url);let body:unknown,upload:File|undefined
  if(request.method==='POST'){
   const expected=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:''
   if(request.headers.get('origin')!==expected)return Response.json({message:'请求来源无效'},{status:403,headers})
   const contentType=request.headers.get('content-type')||''
   if(contentType.startsWith('application/json')){const raw=await request.text();if(raw.length>32768)return Response.json({message:'输入内容过长'},{status:413,headers});try{body=JSON.parse(raw)}catch{return Response.json({message:'请检查输入内容'},{status:400,headers})}}
   else if(contentType.startsWith('multipart/form-data')){
    const form=await boundedFormData(request),payload=form.get('payload'),file=form.get('thumb')
    if(typeof payload!=='string'||payload.length>32768)return Response.json({message:'表单内容无效'},{status:400,headers})
    try{body=JSON.parse(payload)}catch{return Response.json({message:'表单内容无效'},{status:400,headers})}
    if(file!==null){if(!(file instanceof File))return Response.json({message:'图片文件无效'},{status:400,headers});upload=file}
   }else return Response.json({message:'请求格式无效'},{status:415,headers})
  }
  const kind=kindSchema.parse(request.method==='POST'?z.object({kind:kindSchema}).parse(body).kind:url.searchParams.get('kind')),user=await identity(request)
  if(!visibleNavigation(user).some(g=>g.items.some(i=>i.id===route[kind])))return Response.json({message:'没有访问权限'},{status:403,headers})
  if(request.method==='GET'){
   if(url.searchParams.get('action')==='options')return Response.json(await service.options(),{headers})
   const q=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(10),search:z.string().trim().max(200).default(''),bot:id.optional()}).parse(Object.fromEntries(url.searchParams))
   const listed=await service.list(kind,q.page,q.pageSize,q.search,q.bot)
   const rows=kind==='reply'?await annotatePluginConfigRows(db,'keyreply',listed.rows):listed.rows
   return Response.json({...listed,rows,permissions:{add:permission(user,kind,'add'),update:permission(user,kind,'update'),delete:permission(user,kind,'delete'),status:permission(user,kind,'status'),copy:permission(user,kind,'copy')}},{headers})
  }
  const action=z.object({action:z.enum(['add','update','delete','status','copy'])}).parse(body).action;if(!permission(user,kind,action))return Response.json({message:'没有操作权限'},{status:403,headers})
  if(upload&&!['add','update'].includes(action))return Response.json({message:'此操作不接受图片文件'},{status:400,headers})
  let data:unknown
  if(action==='add'||action==='update'){
   const schema=z.object({kind:kindSchema,action:z.enum(['add','update']),...(action==='update'?{rid:id}:{}),...(kind==='reply'?replyFields:adFields)}).strict();schema.parse(body)
   if(upload)stored=await saveMessageImage(upload)
   const input=schema.parse(upload?{...(body as Record<string,unknown>),[kind==='reply'?'reply_photo':'notice_photo']:stored!.url}:body)
   try{data=kind==='reply'?await service.saveReply(z.object(replyFields).parse(input),user.id,action==='update'?id.parse(input.rid):undefined):await service.saveAd(z.object(adFields).parse(input),user.id,action==='update'?id.parse(input.rid):undefined)}catch(error){if(stored)await stored.remove();throw error}
  }else if(action==='delete'){const input=z.object({kind:kindSchema,action:z.literal('delete'),rid:id}).strict().parse(body);data=await service.remove(kind,input.rid,user.id)}
  else if(action==='status'){const input=z.object({kind:kindSchema,action:z.literal('status'),rid:id,enabled:z.boolean()}).strict().parse(body);data=await service.status(kind,input.rid,input.enabled,user.id)}
  else{const input=z.object({kind:kindSchema,action:z.literal('copy'),source:id,target:id,overwrite:z.boolean()}).strict().parse(body);data=await service.copy(kind,input.source,input.target,input.overwrite,user.id)}
  return Response.json({ok:true,data,message:action==='delete'?'删除成功':action==='copy'?'复制完成':'保存成功'},{headers})
 }catch(error){if(stored)await stored.remove();if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers});throw error}
})}
