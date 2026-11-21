import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import argon2 from 'argon2'
import bcrypt from 'bcryptjs'
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential } from '@simplewebauthn/server'
import { z } from 'zod'
import { identity, type Identity } from './api.server'
import { db } from './db.server'
import { cookie, cookies, digest, isToken, token } from './security'

const SESSION = 'tg_platform_session'
const responseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const settingsSchema = z.object({ enabled: z.boolean(), rp_name: z.string().trim().min(1).max(80), rp_id: z.string().trim().min(1).max(253), origins: z.array(z.string().trim().min(1).max(500)).min(1).max(10), user_verification: z.enum(['required','preferred']), attachment: z.enum(['','platform','cross-platform']).default(''), allow_insecure_origin: z.boolean() }).strict()
const baseSettings = () => {
  const url = new URL(process.env.PLATFORM_ORIGIN || 'http://localhost')
  return { enabled: false, rp_name: 'TGBotPress', rp_id: url.hostname, origins: [url.origin], user_verification: 'required' as const, attachment: '' as const, allow_insecure_origin: false }
}
type PasskeySettings = ReturnType<typeof baseSettings>
class PasskeyError extends Error { constructor(public status: number, message: string) { super(message) } }
const fail = (status: number, message: string): never => { throw new PasskeyError(status, message) }
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const same = (a: string, b: string) => { const aa=Buffer.from(a), bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb) }
const b64 = (value: Uint8Array | Buffer) => Buffer.from(value).toString('base64url')
const fromB64 = (value: string) => Buffer.from(value, 'base64url')
async function storePublicKey(value: Uint8Array) {
  const type=await db.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='t_admin_passkey' AND column_name='public_key'")
  return type.rows[0]?.data_type==='bytea' ? Buffer.from(value) : `b64:${b64(value)}`
}
function loadPublicKey(value: unknown): Buffer {
  if(Buffer.isBuffer(value)) return value
  const text=String(value||'')
  return text.startsWith('b64:') ? fromB64(text.slice(4)) : Buffer.from(text,'utf8')
}
const truthy = (value: unknown) => [true,1,'1','t','true','yes'].includes(value as never)
function platformOrigin() { const value=process.env.PLATFORM_ORIGIN; if(!value) return fail(503,'后台来源尚未配置'); try { return new URL(value).origin } catch { return fail(503,'后台来源配置无效') } }
async function assertOrigin(request: Request) {
  const origin=request.headers.get('origin') || ''
  const allowed=[platformOrigin(),...(await readSettings()).origins]
  if (!allowed.includes(origin) || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(403,'请求来源无效')
}
function assertRpHost(host: string, rp: string) { return host===rp || host.endsWith(`.${rp}`) }
async function readSettings(): Promise<PasskeySettings> {
  const result=await db.query('SELECT passkey_config::text AS config FROM t_admin_security_settings WHERE rid=1')
  let saved: unknown
  try { saved=JSON.parse(result.rows[0]?.config || 'null') } catch { saved=null }
  const parsed=settingsSchema.partial().safeParse(saved)
  const settings={ ...baseSettings(), ...(parsed.success ? parsed.data : {}) } as PasskeySettings
  return settings
}
function validateSettings(value: unknown, request: Request, old: PasskeySettings) {
  const parsed=settingsSchema.safeParse(value)
  if(!parsed.success) return fail(422,'通行密钥设置格式无效')
  const next=parsed.data
  const rp=next.rp_id.toLowerCase()
  const host=new URL(platformOrigin()).hostname.toLowerCase()
  if(rp!==next.rp_id || isIP(rp) || (rp!=='localhost' && !rp.includes('.')) || !assertRpHost(host,rp)) fail(422,'RP ID 必须为当前域名或其有效父域名')
  const origins=[...new Set(next.origins)]
  if(origins.length!==next.origins.length) fail(422,'Origin 不能重复')
  for(const value of origins) {
    let origin: URL
    try { origin=new URL(value) } catch { return fail(422,'Origin 格式无效') }
    const localHttp=next.allow_insecure_origin && origin.protocol==='http:' && origin.hostname==='localhost'
    if(origin.origin!==value || (origin.protocol!=='https:' && !localHttp) || !assertRpHost(origin.hostname.toLowerCase(),rp)) fail(422,'Origin 须使用 HTTPS 且域名匹配 RP ID；本地 HTTP 仅限 localhost')
  }
  const requestOrigin=request.headers.get('origin') || ''
  if(next.enabled && !origins.includes(requestOrigin)) fail(422,'允许的 Origins 必须包含当前后台来源')
  return { ...next, rp_id:rp, origins }
}
function isSuperAdmin(user: Identity) { return user.roles.includes('超级管理员') }
function assertPasskeyOrigin(request: Request, settings: PasskeySettings) {
  const origin=request.headers.get('origin') || ''
  if(!settings.enabled) fail(409,'通行密钥尚未启用')
  if(!settings.origins.includes(origin)) fail(403,'当前来源未获准使用通行密钥')
  return origin
}
async function requireUser(request: Request) {
  try { return await identity(request) } catch { return fail(401,'请先登录') }
}
async function requireSuperAdmin(request: Request) {
  const user=await requireUser(request)
  if(!isSuperAdmin(user)) fail(403,'只有超级管理员可以修改通行密钥设置')
  return user
}
async function verifyPassword(adminId: string, password: string) {
  const row=await db.query('SELECT password FROM t_admin WHERE id=$1 AND status=1',[adminId])
  if(!row.rowCount) return false
  const stored=String(row.rows[0].password || '')
  try {
    if(stored.startsWith('$2')) return await bcrypt.compare(password,stored)
    if(stored.startsWith('$argon2')) return await argon2.verify(stored,password)
    return same(stored,sha256(password)) || same(stored,createHash('md5').update(password).digest('hex'))
  } catch { return false }
}
async function passwordReauth(adminId: string, password: unknown) {
  if(typeof password!=='string' || password.length>255 || !password) return fail(422,'请输入当前密码')
  const plain=password
  const existing=await db.query('SELECT attempts,locked_until FROM t_platform_passkey_reauth_attempt WHERE admin_id=$1',[adminId])
  if(Number(existing.rows[0]?.attempts||0)>=5 && existing.rows[0]?.locked_until && new Date(existing.rows[0].locked_until).getTime()>Date.now()) fail(429,'密码尝试过多，请稍后重试')
  if(await verifyPassword(adminId,plain)) { await db.query('DELETE FROM t_platform_passkey_reauth_attempt WHERE admin_id=$1',[adminId]); return }
  await db.query(`INSERT INTO t_platform_passkey_reauth_attempt(admin_id,attempts,locked_until,updated_at) VALUES($1,1,NULL,now())
    ON CONFLICT(admin_id) DO UPDATE SET
      attempts=CASE WHEN t_platform_passkey_reauth_attempt.updated_at<now()-interval '5 minutes' OR t_platform_passkey_reauth_attempt.locked_until<=now() THEN 1 ELSE t_platform_passkey_reauth_attempt.attempts+1 END,
      locked_until=CASE WHEN t_platform_passkey_reauth_attempt.updated_at<now()-interval '5 minutes' OR t_platform_passkey_reauth_attempt.locked_until<=now() THEN NULL WHEN t_platform_passkey_reauth_attempt.attempts+1>=5 THEN now()+interval '5 minutes' ELSE NULL END,
      updated_at=now()`,[adminId])
  fail(422,'当前密码错误')
}
function trustedIp(request: Request): { ip:string|null; trusted:boolean } {
  const configured=(process.env.TRUSTED_PROXIES||'').split(',').map(s=>s.trim()).filter(Boolean)
  const chain=(request.headers.get('x-forwarded-for')||'').split(',').map(s=>s.trim()).filter(ip=>isIP(ip))
  if(!configured.length || !chain.length) return {ip:null,trusted:false}
  const isProxy=(ip:string, rule:string) => {
    if(ip===rule) return true
    const [net,prefix,...rest]=rule.split('/')
    if(isIP(ip)!==4 || isIP(net)!==4 || !prefix || rest.length) return false
    const bits=Number(prefix); if(!Number.isInteger(bits)||bits<0||bits>32) return false
    const toNum=(v:string)=>v.split('.').reduce((n,x)=>((n<<8)|Number(x))>>>0,0)
    const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0
    return (toNum(ip)&mask)===(toNum(net)&mask)
  }
  for(let i=chain.length-1;i>=0;i--) if(!configured.some(rule=>isProxy(chain[i],rule))) return {ip:chain[i],trusted:true}
  return {ip:null,trusted:false}
}
function ipList(raw:string) { return raw.trim().split(/[\s,;]+/).filter(Boolean) }
function inIpRange(ip:string,entry:string) {
  if(ip===entry) return true
  const [network,prefix,...rest]=entry.split('/')
  if(rest.length || !prefix || isIP(ip)!==4 || isIP(network)!==4) return false
  const bits=Number(prefix); if(!Number.isInteger(bits)||bits<0||bits>32) return false
  const num=(value:string)=>value.split('.').reduce((n,x)=>((n<<8)|Number(x))>>>0,0)
  const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0
  return (num(ip)&mask)===(num(network)&mask)
}
function publicIp(ip:string|null) { if(!ip) return null; if(isIP(ip)===4){ const [a,b,c]=ip.split('.').map(Number); if(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113)) return null; return ip } return ip.toLowerCase().startsWith('fc')||ip.toLowerCase().startsWith('fd')||ip.toLowerCase().startsWith('fe80:')||ip==='::1'?null:ip }
function deviceType(ua:string) { const v=ua.toLowerCase(); return /ipad|tablet/.test(v)?'平板':/mobile|iphone|android/.test(v)?'手机':v?'电脑':'未知' }
function optionsSettingsHash(settings: PasskeySettings) { return sha256(JSON.stringify(settings)) }
async function createFlow(input: {purpose:'register'|'login'; adminId?:string; sessionHash?:string; origin:string; settings:PasskeySettings; challenge:string; userHandle?:string; passwordHash?:string}) {
  const raw=token()
  await db.query(`INSERT INTO t_platform_passkey_flow(token_hash,purpose,admin_id,session_hash,origin,settings_hash,challenge,user_handle,password_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '3 minutes')`,[digest(raw),input.purpose,input.adminId||null,input.sessionHash||null,input.origin,optionsSettingsHash(input.settings),input.challenge,input.userHandle||null,input.passwordHash||null])
  return raw
}
async function consumeFlow(raw: unknown, purpose:'register'|'login', origin:string, settings:PasskeySettings, adminId?:string, sessionHash?:string) {
  if(!isToken(raw)) return fail(400,'验证请求已失效，请重试')
  const result=await db.query(`DELETE FROM t_platform_passkey_flow WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING *`,[digest(raw as string),purpose])
  const flow=result.rows[0]
  if(!flow || String(flow.admin_id||'')!==String(adminId||'') || String(flow.session_hash||'')!==String(sessionHash||'') || flow.origin!==origin || flow.settings_hash!==optionsSettingsHash(settings)) fail(400,'验证请求已失效，请重试')
  return flow
}
async function assertJson(request:Request) { await assertOrigin(request); return request.json().catch(()=>fail(400,'请求数据格式无效')) }
async function audit(adminId:string, sessionHash:string, action:string) {
  await db.query("INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security/passkey',$2,now(),$3)",[adminId,sessionHash.slice(0,64),action])
}
async function status(request:Request) {
  const user=await requireUser(request)
  const settings=await readSettings()
  const credentials=await db.query('SELECT rid::text AS rid,name,rp_id,created_at,last_used_at FROM t_admin_passkey WHERE admin_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC',[user.id])
  return Response.json({settings,credentials:credentials.rows,canManage:isSuperAdmin(user)},{headers:responseHeaders})
}
async function saveSettings(request:Request) {
  const user=await requireSuperAdmin(request)
  const body=await assertJson(request) as Record<string,unknown>
  await passwordReauth(user.id,body.password)
  const old=await readSettings()
  const next=validateSettings(body.settings,request,old)
  if(next.rp_id!==old.rp_id) {
    const used=await db.query('SELECT 1 FROM t_admin_passkey WHERE revoked_at IS NULL LIMIT 1')
    if(used.rowCount) fail(422,'请先移除已有通行密钥，再修改 RP ID')
  }
  await db.query('INSERT INTO t_admin_security_settings(rid,passkey_config,updated_at) VALUES(1,$1::jsonb,now()) ON CONFLICT(rid) DO UPDATE SET passkey_config=EXCLUDED.passkey_config,updated_at=now()',[JSON.stringify(next)])
  const raw=cookies(request)[SESSION]||''
  await audit(user.id,raw,'更新通行密钥设置')
  return Response.json({message:'已保存',settings:next},{headers:responseHeaders})
}
async function registrationOptions(request:Request) {
  const user=await requireUser(request), body=await assertJson(request) as Record<string,unknown>
  await passwordReauth(user.id,body.password)
  const settings=await readSettings(), origin=assertPasskeyOrigin(request,settings)
  const client=await db.connect()
  let handle:string
  try {
    await client.query('BEGIN')
    const admin=await client.query('SELECT name,status,password,passkey_user_handle FROM t_admin WHERE id=$1 FOR UPDATE',[user.id])
    if(!admin.rowCount||Number(admin.rows[0].status)!==1) fail(403,'当前账号无法注册通行密钥')
    const count=await client.query('SELECT count(*)::int AS count FROM t_admin_passkey WHERE admin_id=$1 AND revoked_at IS NULL',[user.id])
    if(count.rows[0].count>=10) fail(422,'最多注册 10 个通行密钥')
    handle=admin.rows[0].passkey_user_handle || b64(randomBytes(32))
    if(!admin.rows[0].passkey_user_handle) await client.query('UPDATE t_admin SET passkey_user_handle=$2 WHERE id=$1',[user.id,handle])
    const credentialRows=await client.query('SELECT credential_id FROM t_admin_passkey WHERE admin_id=$1 AND rp_id=$2 AND revoked_at IS NULL',[user.id,settings.rp_id])
    const options=await generateRegistrationOptions({rpName:settings.rp_name,rpID:settings.rp_id,userName:String(admin.rows[0].name),userDisplayName:String(admin.rows[0].name),userID:fromB64(handle),attestationType:'none',timeout:60_000,excludeCredentials:credentialRows.rows.map(row=>({id:String(row.credential_id)})),authenticatorSelection:{residentKey:'required',userVerification:settings.user_verification,authenticatorAttachment:settings.attachment||undefined}})
    const flow=await createFlow({purpose:'register',adminId:user.id,sessionHash:digest(cookies(request)[SESSION]||''),origin,settings,challenge:options.challenge,userHandle:handle,passwordHash:sha256(String(admin.rows[0].password))})
    await client.query('COMMIT')
    return Response.json({options,flow_token:flow},{headers:responseHeaders})
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error } finally { client.release() }
}
async function registrationFinish(request:Request) {
  const user=await requireUser(request), body=await assertJson(request) as Record<string,unknown>
  const settings=await readSettings(), origin=assertPasskeyOrigin(request,settings)
  const flow=await consumeFlow(body.flow_token,'register',origin,settings,user.id,digest(cookies(request)[SESSION]||''))
  const credentialSchema=z.object({id:z.string().min(1).max(1400),rawId:z.string().min(1).max(1400),type:z.literal('public-key')}).passthrough()
  const parsed=credentialSchema.safeParse(body.credential)
  if(!parsed.success) return fail(422,'通行密钥响应无效')
  if(parsed.data.id!==parsed.data.rawId) return fail(422,'通行密钥响应无效')
  let verified
  try { verified=await verifyRegistrationResponse({response:parsed.data as unknown as RegistrationResponseJSON,expectedChallenge:String(flow.challenge),expectedOrigin:origin,expectedRPID:settings.rp_id,requireUserVerification:settings.user_verification==='required'}) } catch { return fail(422,'通行密钥验证失败，请重新注册') }
  if(!verified.verified || !verified.registrationInfo) return fail(422,'通行密钥验证失败，请重新注册')
  const info=verified.registrationInfo, credential=info.credential
  const name=typeof body.name==='string'&&body.name.trim()?body.name.trim():'通行密钥'
  if(name.length>80) fail(422,'密钥名称最多 80 个字符')
  const writer=await db.connect()
  try {
    await writer.query('BEGIN')
    const current=await writer.query('SELECT password,status,passkey_user_handle FROM t_admin WHERE id=$1 FOR UPDATE',[user.id])
    if(!current.rowCount||Number(current.rows[0].status)!==1||sha256(String(current.rows[0].password))!==flow.password_hash||current.rows[0].passkey_user_handle!==flow.user_handle) fail(409,'账号状态已变化，请重新注册')
    const count=await writer.query('SELECT count(*)::int AS count FROM t_admin_passkey WHERE admin_id=$1 AND revoked_at IS NULL',[user.id])
    if(Number(count.rows[0].count)>=10) fail(422,'最多注册 10 个通行密钥')
    await writer.query(`INSERT INTO t_admin_passkey(admin_id,name,credential_id,public_key,user_handle,rp_id,sign_count,backup_eligible,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`,[user.id,name,credential.id,await storePublicKey(credential.publicKey),flow.user_handle,settings.rp_id,credential.counter,info.credentialDeviceType==='multiDevice'])
    const raw=cookies(request)[SESSION]||''
    await writer.query("INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security/passkey',$2,now(),'注册通行密钥')",[user.id,raw.slice(0,64)])
    await writer.query('COMMIT')
  } catch(error) {
    await writer.query('ROLLBACK').catch(()=>{})
    if(error instanceof PasskeyError) throw error
    if((error as {code?:string}).code==='23505') fail(409,'该通行密钥已注册')
    throw error
  } finally { writer.release() }
  return Response.json({message:'通行密钥已注册'},{headers:responseHeaders})
}
async function revoke(request:Request) {
  const user=await requireUser(request), body=await assertJson(request) as Record<string,unknown>
  await passwordReauth(user.id,body.password)
  const id=z.coerce.number().int().positive().safeParse(body.rid)
  if(!id.success) fail(422,'通行密钥编号无效')
  const result=await db.query('UPDATE t_admin_passkey SET revoked_at=now() WHERE rid=$1 AND admin_id=$2 AND revoked_at IS NULL RETURNING rid',[id.data,user.id])
  if(!result.rowCount) fail(404,'通行密钥不存在')
  await audit(user.id,cookies(request)[SESSION]||'','移除通行密钥 #'+id.data)
  return Response.json({message:'通行密钥已移除'},{headers:responseHeaders})
}
async function authOptions(request:Request) {
  const settings=await readSettings(), origin=assertPasskeyOrigin(request,settings)
  const options=await generateAuthenticationOptions({rpID:settings.rp_id,userVerification:settings.user_verification,timeout:60_000})
  const flow=await createFlow({purpose:'login',origin,settings,challenge:options.challenge})
  return Response.json({options,flow_token:flow},{headers:responseHeaders})
}
async function authFinish(request:Request) {
  const body=await assertJson(request), settings=await readSettings(), origin=assertPasskeyOrigin(request,settings)
  const flow=await consumeFlow((body as Record<string,unknown>).flow_token,'login',origin,settings)
  const parsed=z.object({id:z.string().min(1).max(1400),rawId:z.string().min(1).max(1400),type:z.literal('public-key')}).passthrough().safeParse((body as Record<string,unknown>).credential)
  if(!parsed.success) return fail(401,'通行密钥验证失败')
  if(parsed.data.id!==parsed.data.rawId) return fail(401,'通行密钥验证失败')
  const credential=parsed.data as unknown as AuthenticationResponseJSON
  const client=await db.connect()
  try {
    await client.query('BEGIN')
    const keyResult=await client.query('SELECT * FROM t_admin_passkey WHERE credential_id=$1 AND rp_id=$2 AND revoked_at IS NULL FOR UPDATE',[credential.id,settings.rp_id])
    if(!keyResult.rowCount) fail(401,'通行密钥验证失败')
    const key=keyResult.rows[0]
    if(typeof credential.response.userHandle!=='string'||credential.response.userHandle!==key.user_handle) fail(401,'通行密钥验证失败')
    const adminResult=await client.query('SELECT id::text,name,password,status,white_ip,passkey_user_handle FROM t_admin WHERE id=$1 FOR UPDATE',[key.admin_id])
    if(!adminResult.rowCount||Number(adminResult.rows[0].status)!==1||adminResult.rows[0].passkey_user_handle!==key.user_handle) fail(401,'通行密钥验证失败')
    const verified=await verifyAuthenticationResponse({response:credential,expectedChallenge:String(flow.challenge),expectedOrigin:origin,expectedRPID:settings.rp_id,requireUserVerification:settings.user_verification==='required',credential:{id:String(key.credential_id),publicKey:Uint8Array.from(loadPublicKey(key.public_key)),counter:key.backup_eligible?0:Number(key.sign_count)}})
    if(!verified.verified) fail(401,'通行密钥验证失败')
    const admin=adminResult.rows[0]
    const loginSettings=await client.query('SELECT ip_whitelist_enabled,ip_whitelist,session_lifetime_minutes FROM t_admin_security_settings WHERE rid=1')
    const login=loginSettings.rows[0]||{}
    const trusted=trustedIp(request), ip=trusted.trusted?trusted.ip:null
    const lists:string[]=[]
    if(truthy(login.ip_whitelist_enabled)) lists.push(String(login.ip_whitelist||''))
    if(String(admin.white_ip||'').trim()) lists.push(String(admin.white_ip))
    if(lists.some(raw=>!trusted.trusted||!ip||!ipList(raw).length||ipList(raw).some(entry=>!isIP(entry.split('/')[0]))||!ipList(raw).some(entry=>inIpRange(ip,entry)))) fail(401,'通行密钥验证失败')
    const lifetime=[30,120,480,1440,10080,43200].includes(Number(login.session_lifetime_minutes))?Number(login.session_lifetime_minutes):120
    const now=new Date(), expires=new Date(now.getTime()+lifetime*60_000), deviceSecret=token(), platformSession=token(), ua=(request.headers.get('user-agent')||'').slice(0,1000)
    const d=await client.query(`INSERT INTO t_admin_device_session(admin_id,session_hash,login_ip,public_ip,location,device_type,user_agent,login_time,last_seen_at,expires_at)
      VALUES($1,$2,$3,$4,'未知',$5,$6,now(),now(),$7) RETURNING rid`,[admin.id,deviceSecret,ip,publicIp(ip),deviceType(ua),ua,expires])
    await client.query(`INSERT INTO t_admin_login_log(admin_name,login_ip,login_time,admin_id,login_location,public_ip,device_type,user_agent,session_hash)
      VALUES($1,$2,now(),$3,'未知',$4,$5,$6,$7)`,[admin.name,ip,admin.id,publicIp(ip),deviceType(ua),ua,deviceSecret])
    await client.query("INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'管理员登录',$2,now(),'通行密钥登录成功')",[admin.id,deviceSecret])
    await client.query('UPDATE t_admin_passkey SET sign_count=$2,last_used_at=now() WHERE rid=$1',[key.rid,Math.max(Number(key.sign_count),verified.authenticationInfo.newCounter)])
    await client.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,$4)',[digest(platformSession),admin.id,d.rows[0].rid,expires])
    await client.query('COMMIT')
    return Response.json({ok:true},{headers:{...responseHeaders,'Set-Cookie':cookie(SESSION,platformSession,lifetime*60)}})
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); if(error instanceof PasskeyError) throw error; return fail(401,'通行密钥验证失败') } finally { client.release() }
}
export async function passkeyManagementApi(request:Request) {
  try {
    if(request.method==='GET') return await status(request)
    await assertOrigin(request)
    const body=await request.json().catch(()=>fail(400,'请求数据格式无效')) as Record<string,unknown>
    const action=body.action
    if(action==='save-settings') return await saveSettings(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}))
    if(action==='register-options') return await registrationOptions(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}))
    if(action==='register-finish') return await registrationFinish(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}))
    if(action==='revoke') return await revoke(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}))
    return Response.json({message:'未知操作'},{status:400,headers:responseHeaders})
  } catch(error) {
    if(error instanceof PasskeyError) return Response.json({message:error.message},{status:error.status,headers:responseHeaders})
    if(error instanceof z.ZodError) return Response.json({message:'通行密钥设置格式无效'},{status:422,headers:responseHeaders})
    console.error('Passkey management failed',error instanceof Error?error.name:'UnknownError')
    return Response.json({message:'通行密钥服务暂不可用'},{status:503,headers:responseHeaders})
  }
}
export async function passkeyAuthApi(request:Request) {
  try {
    if(request.method==='GET') {
      const settings=await readSettings()
      return Response.json({enabled:settings.enabled,available:settings.enabled},{headers:responseHeaders})
    }
    await assertOrigin(request)
    const body=await request.json().catch(()=>fail(400,'请求数据格式无效')) as Record<string,unknown>
    const action=body.action
    if(action==='options') return await authOptions(request)
    if(action==='finish') return await authFinish(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}))
    return Response.json({message:'未知操作'},{status:400,headers:responseHeaders})
  } catch(error) {
    if(error instanceof PasskeyError) return Response.json({message:error.message},{status:error.status,headers:responseHeaders})
    console.error('Passkey authentication failed',error instanceof Error?error.name:'UnknownError')
    return Response.json({message:'通行密钥验证失败'},{status:401,headers:responseHeaders})
  }
}
