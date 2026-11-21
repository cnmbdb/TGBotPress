import { identity, run } from './api.server'
import { db } from './db.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const etsIdentityUrl = 'https://ets.txsw.top/api/integrations/tgbotpress/identity'
export function etsBindingApi(request: Request) {
 return run(async () => {
  const user = await identity(request)
  if (request.method === 'GET') {
   const result = await db.query<{ets_user_id:string;display_name:string|null;avatar_url:string|null}>('SELECT ets_user_id::text,display_name,avatar_url FROM t_platform_ets_account_binding WHERE admin_id=$1', [user.id])
   return Response.json({ linked: !!result.rows[0], userId: result.rows[0]?.ets_user_id ?? null, name: result.rows[0]?.display_name ?? null, avatar: result.rows[0]?.avatar_url ?? null }, {headers})
  }
  if (request.method === 'DELETE') {
   let expected=''; try { expected=new URL(process.env.PLATFORM_ORIGIN||'').origin } catch { return Response.json({message:'后台地址未配置'},{status:503,headers}) }
   if(request.headers.get('origin')!==expected)return Response.json({message:'请求来源无效'},{status:403,headers})
   await db.query('DELETE FROM t_platform_ets_account_binding WHERE admin_id=$1',[user.id])
   return Response.json({linked:false},{headers})
  }
  if (request.method !== 'POST') return Response.json({message:'请求方法不支持'},{status:405,headers})
  let expected = ''; try { expected = new URL(process.env.PLATFORM_ORIGIN || '').origin } catch { return Response.json({message:'后台地址未配置'},{status:503,headers}) }
  if (request.headers.get('origin') !== expected || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({message:'请求来源无效'},{status:403,headers})
  if (Number(request.headers.get('content-length') || 0) > 8192) return Response.json({message:'请求过大'},{status:413,headers})
  const body = await request.json() as { accessToken?: unknown }
  if (typeof body.accessToken !== 'string' || body.accessToken.length < 20 || body.accessToken.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(body.accessToken)) return Response.json({message:'登录凭证无效'},{status:400,headers})
  let response: Response
  try { response = await fetch(etsIdentityUrl, { headers:{ Authorization:`Bearer ${body.accessToken}`, Accept:'application/json' }, redirect:'error', signal:AbortSignal.timeout(10000) }) } catch { return Response.json({message:'插件平台暂不可用'},{status:502,headers}) }
  if (!response.ok) return Response.json({message:'插件平台身份验证失败'}, {status:response.status === 401 ? 401 : 502,headers})
  const payload = await response.json() as { id?: unknown; name?: unknown; avatar?: unknown }
  if (typeof payload.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id)) return Response.json({message:'插件平台响应无效'},{status:502,headers})
  const name=typeof payload.name==='string'?payload.name.slice(0,120):null
  const avatar=typeof payload.avatar==='string'&&payload.avatar.length<=2048?payload.avatar:null
  await db.query('INSERT INTO t_platform_ets_account_binding(admin_id,ets_user_id,display_name,avatar_url,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(admin_id) DO UPDATE SET ets_user_id=EXCLUDED.ets_user_id,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,updated_at=now()', [user.id,payload.id,name,avatar])
  return Response.json({linked:true,userId:payload.id,name,avatar},{headers})
 })
}
