import {z} from 'zod'
import {db} from './db.server'
import {can,identity,run,type Identity} from './api.server'
import {BotServiceError} from './bot-service.server'
import {KeyboardRelationsService} from './keyboard-relations-service.server'
import {visibleNavigation} from '../lib/navigation'
import {annotatePluginConfigRows} from '../plugins/plugin-config-links.server'
const service=new KeyboardRelationsService(db),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
type Kind='reply'|'ad';const kinds=z.enum(['reply','ad']),id=z.coerce.number().int().positive().max(2147483647),integer=z.coerce.number().int().min(1).max(2)
const routes={reply:'admin.telegram.keyreplyboard.index',ad:'admin.telegram.telegrambotadkeyboard.index'}
const names={reply:{add:'添加关键字键盘',update:'修改关键字键盘',delete:'删除关键字键盘',quick:'按关键字快捷添加',quickBot:'按机器人快捷添加',quickBotDelete:'按机器人键盘删除'},ad:{add:'添加定时广告键盘',update:'修改定时广告键盘',delete:'删除定时广告键盘',quick:'快捷添加定时广告键盘'}}
function allowed(u:Identity,k:Kind,a:string){const n=names[k] as Record<string,string>;const permissionKey:Record<string,string>={add:'add',update:'update',delete:'delete',quick:'quick',quickBot:'quickBot',quickBotDelete:'quickBotDelete',fastadd:'quick',fastbotadd:'quickBot',fastbotdelete:'quickBotDelete'};const suffix:Record<string,string>={add:'add',update:'update',delete:'delete',quick:'fastadd',quickBot:'fastbotadd',quickBotDelete:'fastbotdelete',fastadd:'fastadd',fastbotadd:'fastbotadd',fastbotdelete:'fastbotdelete'};const name=n[permissionKey[a]];return !!name&&!!suffix[a]&&can(u,name,`admin.telegram.${k==='reply'?'keyreplyboard':'telegrambotadkeyboard'}.${suffix[a]}`)}
const fields={bot_rid:id,parent_rid:id,keyboard_rid:id}
export async function keyboardRelationsApi(request:Request){return run(async()=>{
 try{const url=new URL(request.url);let body:unknown
 if(request.method==='POST'){const expected=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:'';if(request.headers.get('origin')!==expected||!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({message:'请求来源无效'},{status:403,headers});const raw=await request.text();if(raw.length>16384)return Response.json({message:'输入内容过长'},{status:413,headers});try{body=JSON.parse(raw)}catch{return Response.json({message:'请检查输入内容'},{status:400,headers})}}
 const kind=kinds.parse(request.method==='POST'?z.object({kind:kinds}).parse(body).kind:url.searchParams.get('kind')),user=await identity(request)
 if(!visibleNavigation(user).some(g=>g.items.some(i=>i.id===routes[kind])))return Response.json({message:'没有访问权限'},{status:403,headers})
 if(request.method==='GET'){if(url.searchParams.get('action')==='options')return Response.json(await service.options(),{headers});const q=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(30),z.literal(40),z.literal(50),z.literal(60),z.literal(70),z.literal(80),z.literal(90)])).default(10),search:z.string().trim().max(200).default(''),bot:id.optional()}).parse(Object.fromEntries(url.searchParams));const listed=await service.list(kind,q.page,q.pageSize,q.search,q.bot);const rows=kind==='reply'?await annotatePluginConfigRows(db,'keyreply_keyboard',listed.rows):listed.rows;return Response.json({...listed,rows,permissions:{add:allowed(user,kind,'add'),update:allowed(user,kind,'update'),delete:allowed(user,kind,'delete'),quick:allowed(user,kind,'quick'),quickBot:kind==='reply'&&allowed(user,kind,'quickBot'),quickBotDelete:kind==='reply'&&allowed(user,kind,'quickBotDelete')}},{headers})}
 const action=z.object({action:z.enum(['add','update','delete','fastadd','fastbotadd','fastbotdelete'])}).parse(body).action;if(!allowed(user,kind,action))return Response.json({message:'没有操作权限'},{status:403,headers});let data:unknown
 if(action==='add'||action==='update'){const s=z.object({kind:kinds,action:z.enum(['add','update']),...(action==='update'?{rid:id}:{}),...fields}).strict(),input=s.parse(body);data=await service.save(kind,{bot_rid:id.parse(input.bot_rid),parent_rid:id.parse(input.parent_rid),keyboard_rid:id.parse(input.keyboard_rid)},user.id,action==='update'?id.parse(input.rid):undefined)}
 else if(action==='delete'){const input=z.object({kind:kinds,action:z.literal('delete'),rid:id}).strict().parse(body);data=await service.remove(kind,input.rid,user.id)}
 else if(action==='fastadd'){const input=z.object({kind:kinds,action:z.literal('fastadd'),parent_rid:id,keyboard_type:integer}).strict().parse(body);data=await service.quick(kind,input.parent_rid,input.keyboard_type,user.id)}
 else if(action==='fastbotadd'){const input=z.object({kind:z.literal('reply'),action:z.literal('fastbotadd'),bot_rid:id,keyboard_type:integer}).strict().parse(body);data=await service.quickBotReplies(input.bot_rid,input.keyboard_type,user.id)}
 else{const input=z.object({kind:z.literal('reply'),action:z.literal('fastbotdelete'),bot_rid:id,keyboard_rid:id}).strict().parse(body);data=await service.quickBotDelete(input.bot_rid,input.keyboard_rid,user.id)}
 return Response.json({ok:true,data,message:action==='delete'||action==='fastbotdelete'?'删除成功':'保存成功'},{headers})
 }catch(error){if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers});throw error}
})}
