import { z } from 'zod'
import { identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const input = z.object({ name:z.string().trim().min(1).max(100), description:z.string().trim().min(1).max(5000), command:z.string().trim().max(240).regex(/^npm (?:install|i) (?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9]+\.[0-9]+\.[0-9]+)?$/), image:z.string().max(280000).nullable(), etsAccessToken:z.string().min(20).max(4096).regex(/^[A-Za-z0-9._-]+$/).nullable() }).strict()
export function pluginMarketApi(request:Request) {
 return run(async()=>{
  const user=await identity(request)
  if(request.method==='GET'){
   try { const r=await fetch('https://ets.txsw.top/api/integrations/tgbotpress/listings',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)return Response.json({message:'ETS 插件目录暂不可用'},{status:502,headers});const data=await r.json() as {plugins?:unknown[]};return Response.json({listings:data.plugins??[]},{headers}) }
   catch{return Response.json({message:'ETS 插件目录暂不可用'},{status:502,headers})}
  }
  if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
  if(!user.roles.includes('超级管理员'))return Response.json({message:'没有操作权限'},{status:403,headers})
  const origin=process.env.PLATFORM_ORIGIN
  if(!origin||request.headers.get('origin')!==new URL(origin).origin||!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({message:'请求来源无效'},{status:403,headers})
  const body=input.parse(await request.json())
  if(!body.etsAccessToken)return Response.json({message:'请先登录 ETS 账号后上架'},{status:401,headers})
  const packageName=body.command.split(' ')[2]
  let response:Response
  try{response=await fetch('https://ets.txsw.top/api/integrations/tgbotpress/listings',{method:'POST',headers:{Authorization:`Bearer ${body.etsAccessToken}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({name:body.name,description:body.description,npm_package:packageName,image:body.image}),redirect:'error',signal:AbortSignal.timeout(12000)})}
  catch{return Response.json({message:'ETS 上架服务暂不可用'},{status:502,headers})}
  const result=await response.json().catch(()=>({error:'ETS 返回无效响应'})) as {error?:string;message?:string}
  if(!response.ok)return Response.json({message:response.status===401?'ETS 登录已过期，请重新登录':result.error||'ETS 上架失败'},{status:response.status,headers})
  return Response.json(result,{status:201,headers})
 })
}
