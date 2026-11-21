import { mkdir,unlink,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { imageSize } from 'image-size'
import { BotServiceError } from './bot-service.server'

const maxBytes=10*1024*1024,maxPixels=40_000_000
const extensions={jpg:'jpg',png:'png',gif:'gif',webp:'webp'} as const
export async function saveMessageImage(file:File){
 if(file.size<1||file.size>maxBytes)throw new BotServiceError(413,'图片大小需在 1 字节至 10 MB 之间')
 const bytes=Buffer.from(await file.arrayBuffer())
 let dimensions:ReturnType<typeof imageSize>
 try{dimensions=imageSize(bytes)}catch{throw new BotServiceError(400,'图片文件无法识别')}
 const type=dimensions.type as keyof typeof extensions
 if(!Object.hasOwn(extensions,type))throw new BotServiceError(415,'仅支持 PNG、JPG、GIF、WebP 图片')
 if(!dimensions.width||!dimensions.height||dimensions.width>12000||dimensions.height>12000||dimensions.width*dimensions.height>maxPixels)throw new BotServiceError(400,'图片尺寸过大')
 const now=new Date(),parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now),v=Object.fromEntries(parts.map(p=>[p.type,p.value]))
 const day=`${v.year}${v.month}${v.day}`,stamp=`${day}${v.hour}${v.minute}${v.second}`,relative=path.posix.join('news',day,`${stamp}${randomUUID().replaceAll('-','').slice(0,8)}.${extensions[type]}`)
 const publicOrigin=process.env.MEDIA_PUBLIC_ORIGIN||process.env.LEGACY_ORIGIN||process.env.APP_URL
 if(!publicOrigin)throw new BotServiceError(503,'图片访问域名尚未配置')
 let origin:URL
 try{origin=new URL(publicOrigin)}catch{throw new BotServiceError(503,'图片访问域名配置无效')}
 if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash)throw new BotServiceError(503,'图片访问域名配置无效')
 const gateway=process.env.R2_MEDIA_GATEWAY_URL,token=process.env.R2_MEDIA_GATEWAY_TOKEN
 if(gateway){
  if(!token)throw new BotServiceError(503,'R2 媒体存储尚未配置')
  const objectPath=relative.split('/').map(encodeURIComponent).join('/')
  const endpoint=new URL(objectPath,gateway.endsWith('/')?gateway:gateway+'/')
  const headers={authorization:'Bearer '+token,'content-type':file.type||'application/octet-stream'}
  let response:Response
  try{response=await fetch(endpoint,{method:'PUT',headers,body:bytes})}catch{throw new BotServiceError(503,'图片保存失败，请检查 R2 连接')}
  if(!response.ok)throw new BotServiceError(503,'图片保存失败，请检查 R2 权限')
  return{url:origin.origin+'/storage/'+relative.split('/').map(encodeURIComponent).join('/'),remove:async()=>{await fetch(endpoint,{method:'DELETE',headers}).catch(()=>{})}}
 }
 const root=path.resolve(process.env.MEDIA_STORAGE_ROOT||'/legacy-storage/app/public'),target=path.resolve(root,relative)
 if(!target.startsWith(root+path.sep))throw new BotServiceError(400,'图片路径无效')
 await mkdir(path.dirname(target),{recursive:true})
 try{await writeFile(target,bytes,{flag:'wx',mode:0o640})}catch{throw new BotServiceError(503,'图片保存失败，请检查共享存储权限')}
 return{url:`${origin.origin}/storage/${relative.split(path.sep).join('/')}`,remove:()=>unlink(target).catch(()=>{})}
}
export const uploadLimit=maxBytes+128*1024
export async function boundedFormData(request:Request){
 const length=Number(request.headers.get('content-length')||0)
 if(length>uploadLimit)throw new BotServiceError(413,'上传请求过大')
 if(!request.body)throw new BotServiceError(400,'上传内容为空')
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>uploadLimit){await reader.cancel();throw new BotServiceError(413,'上传请求过大')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 const contentType=request.headers.get('content-type')||''
 try{return await new Request('http://upload.local',{method:'POST',headers:{'content-type':contentType},body:bytes}).formData()}catch{throw new BotServiceError(400,'上传表单格式无效')}
}
