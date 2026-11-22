import { authDestination, authDestinationKey } from './auth-destination'
import { visibleNavigation } from '../lib/navigation'
import { z } from 'zod'
import { db } from './db.server'
import { token, digest, isToken, equalTokens, cookies, cookie } from './security'
import { cloudflareAccessRequired, trustedRequestHostname, verifyCloudflareAccessJwt } from './cloudflare-access.server'

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const SESSION = 'tg_platform_session'
const PENDING = 'tg_platform_pending'
const modelType = 'App\\Models\\Admin\\Admin'
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
export type Identity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
export async function run(handler: () => Promise<Response>) {
  try { return await handler() } catch (error) {
    if (error instanceof HttpError) return Response.json({ message: error.message }, { status: error.status, headers })
    if (error instanceof z.ZodError) return Response.json({ message: '请检查输入内容' }, { status: 400, headers })
    console.error('Platform request failed', error instanceof Error ? error.name : 'UnknownError')
    return Response.json({ message: '服务暂不可用，请稍后重试' }, { status: 503, headers })
  }
}
function redirect(url: string, setCookie?: string) {
  return new Response(null, { status: 302, headers: { ...headers, Location: url, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } })
}
function origins() {
  const platform = process.env.PLATFORM_ORIGIN; const legacy = process.env.LEGACY_ORIGIN
  if (!platform || !legacy) throw new HttpError(503, '新后台地址尚未配置')
  return { platform: new URL(platform).origin, legacy: new URL(legacy).origin }
}
export async function authStart(request: Request) {
  if (cloudflareAccessRequired()) throw new HttpError(410, '后台登录已切换到 Cloudflare Access')
  const destination = authDestinationKey(new URL(request.url).searchParams.get("destination"))
  const platformOrigin = process.env.PLATFORM_ORIGIN
  if (!platformOrigin) throw new HttpError(503, '新后台地址尚未配置')
  const target = new URL('/login', new URL(platformOrigin).origin)
  target.searchParams.set('destination', destination)
  return redirect(target.href)
}
export async function authCallback(request: Request) {
  if (cloudflareAccessRequired()) throw new HttpError(410, '后台登录已切换到 Cloudflare Access')
  const url = new URL(request.url), state = url.searchParams.get('state'), code = url.searchParams.get('code')
  const [pendingState = '', verifier = '', destination = 'home'] = (cookies(request)[PENDING] || '').split('.')
  if (!isToken(code) || !isToken(state) || !isToken(verifier) || !equalTokens(state, pendingState)) throw new HttpError(400, '登录凭据无效，请重新登录')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`DELETE FROM t_platform_auth_ticket WHERE token_hash=$1 AND state=$2 AND challenge=$3 AND expires_at > now() RETURNING admin_id,device_session_id`, [digest(code), state, digest(verifier)])
    if (!result.rowCount) throw new HttpError(400, '登录凭据已过期或已使用')
    const { admin_id, device_session_id } = result.rows[0], session = token()
    const inserted = await client.query(`INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at)
      SELECT $1,a.id,d.rid,d.expires_at FROM t_admin a JOIN t_admin_device_session d ON d.admin_id=a.id
      WHERE a.id=$2 AND d.rid=$3 AND a.status=1 AND d.revoked_at IS NULL AND d.expires_at>now() RETURNING admin_id`, [digest(session), admin_id, device_session_id])
    if (!inserted.rowCount) throw new HttpError(401, '原登录会话已失效')
    await client.query('COMMIT')
    const response = redirect(authDestination(destination), cookie(SESSION, session, 2_592_000))
    response.headers.append('Set-Cookie', cookie(PENDING, '', 0))
    return response
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function bindAccessAdmin(email: string, bootstrapEmail: string) {
  if (email !== bootstrapEmail) throw new HttpError(403, '此 Cloudflare Access 邮箱未绑定管理员')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cloudflare-access-admin-bootstrap'))")
    let binding = await client.query<{admin_id:string}>(`SELECT b.admin_id::text FROM t_platform_access_admin_binding b JOIN t_admin a ON a.id=b.admin_id WHERE b.email=$1 AND a.status=1`, [email])
    if (!binding.rowCount) {
      const existing = await client.query('SELECT 1 FROM t_platform_access_admin_binding LIMIT 1')
      if (existing.rowCount) throw new HttpError(403, '此 Cloudflare Access 邮箱未绑定管理员')
      const admins = await client.query<{id:string}>(`SELECT a.id::text FROM t_admin a WHERE a.status=1 AND EXISTS (
        SELECT 1 FROM t_model_has_roles m JOIN t_roles r ON r.id=m.role_id
        WHERE m.model_id=a.id AND m.model_type=$1 AND r.guard_name='web' AND r.name='超级管理员'
      ) ORDER BY a.id LIMIT 2`, [modelType])
      if (admins.rowCount !== 1) throw new HttpError(403, '首次 Access 绑定要求恰好有一个启用的超级管理员')
      await client.query('INSERT INTO t_platform_access_admin_binding(email,admin_id) VALUES($1,$2)', [email, admins.rows[0].id])
      binding = { rowCount: 1, rows: [{ admin_id: admins.rows[0].id }] } as typeof binding
    }
    await client.query('COMMIT')
    return binding.rows[0].admin_id
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error } finally { client.release() }
}

async function cloudflareAccessAdmin(request: Request) {
  const issuer = (process.env.CF_ACCESS_ISSUER || '').trim()
  const audience = (process.env.CF_ACCESS_AUD || '').trim()
  const bootstrapEmail = (process.env.CF_ACCESS_ADMIN_EMAIL || '').trim().toLowerCase()
  const allowedEmails = (process.env.CF_ACCESS_ADMIN_EMAILS || bootstrapEmail).split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const adminHost = (process.env.PLATFORM_ADMIN_HOST || '').trim().toLowerCase()
  if (!issuer || !audience || !bootstrapEmail || !allowedEmails.length || !adminHost) throw new HttpError(503, 'Cloudflare Access 后台身份配置不完整')
  if (trustedRequestHostname(request) !== adminHost) throw new HttpError(421, '请使用指定后台域名访问')
  const assertion = request.headers.get('cf-access-jwt-assertion') || ''
  if (!assertion) throw new HttpError(401, '请先通过 Cloudflare Access 邮箱验证')
  let claims
  try { claims = await verifyCloudflareAccessJwt(assertion, { issuer, audience }) }
  catch { throw new HttpError(401, 'Cloudflare Access 身份验证失败，请重新验证') }
  const email = claims.email || ''
  if (!allowedEmails.includes(email)) throw new HttpError(403, '此邮箱未获准访问管理后台')
  const adminId = await bindAccessAdmin(email, bootstrapEmail)
  const tokenHash = digest(assertion)
  const session = await db.query('INSERT INTO t_platform_access_session(token_hash,admin_id,expires_at) VALUES($1,$2,to_timestamp($3)) ON CONFLICT(token_hash) DO NOTHING RETURNING admin_id', [tokenHash, adminId, claims.exp])
  if (session.rowCount) await db.query("INSERT INTO t_platform_audit_log(admin_id,action) VALUES($1,'cloudflare_access.login')", [adminId])
  else {
    const updated = await db.query('UPDATE t_platform_access_session SET last_seen_at=now() WHERE token_hash=$1 AND admin_id=$2 AND expires_at>now() RETURNING admin_id', [tokenHash, adminId])
    if (!updated.rowCount) throw new HttpError(401, 'Cloudflare Access 会话已失效，请重新验证')
  }
  const admin = await db.query<{id:string;name:string}>(`SELECT id::text,name FROM t_admin WHERE id=$1 AND status=1`, [adminId])
  if (!admin.rowCount) throw new HttpError(403, '管理员账号已停用')
  return admin.rows[0]
}

export async function identity(request: Request): Promise<Identity> {
  let user: { id: string; name: string }
  if (cloudflareAccessRequired()) user = await cloudflareAccessAdmin(request)
  else {
    const raw = cookies(request)[SESSION]
    if (!isToken(raw)) throw new HttpError(401, '请先登录')
    const currentTime = db.dialect === 'mysql' ? 'UTC_TIMESTAMP(6)' : "(now() AT TIME ZONE 'UTC')"
    const result = await db.query(`SELECT a.id::text,a.name FROM t_platform_session s JOIN t_admin a ON a.id=s.admin_id JOIN t_admin_device_session d ON d.rid=s.device_session_id AND d.admin_id=a.id
      WHERE s.token_hash=$1 AND s.expires_at > ${currentTime} AND a.status=1 AND d.revoked_at IS NULL AND d.expires_at > ${currentTime}`, [digest(raw)])
    if (!result.rowCount) throw new HttpError(401, '登录已过期，请重新登录')
    user = result.rows[0]
    const cfConfig = await (await import('./cloudflare-config.server')).getCloudflareConfig()
    const currentHost = trustedRequestHostname(request)
    if (cfConfig.domainEnabled && currentHost !== cfConfig.hostname.toLowerCase()) throw new HttpError(421, '请使用指定后台域名访问')
  }
  const roles = await db.query(`SELECT r.name FROM t_roles r JOIN t_model_has_roles m ON m.role_id=r.id WHERE m.model_id=$1 AND m.model_type=$2 AND r.guard_name='web'`, [user.id, modelType])
  const permissions = await db.query(`SELECT DISTINCT p.name,p.route FROM t_permissions p WHERE p.guard_name='web' AND (p.id IN (SELECT permission_id FROM t_model_has_permissions WHERE model_id=$1 AND model_type=$2) OR p.id IN (SELECT rp.permission_id FROM t_role_has_permissions rp JOIN t_model_has_roles mr ON mr.role_id=rp.role_id WHERE mr.model_id=$1 AND mr.model_type=$2))`, [user.id, modelType])
  return { ...user, roles: roles.rows.map(r=>r.name), permissions: permissions.rows.map(p=>p.name), routes: permissions.rows.map(p=>p.route).filter(Boolean) }
}
export function can(user: Identity, permission: string, route: string) {
  return user.roles.includes('超级管理员') || user.permissions.includes(permission) || user.routes.includes(route)
}
function requirePermission(user: Identity, permission: string, route: string) { if (!can(user, permission, route)) throw new HttpError(403, '没有操作权限') }
function assertOrigin(request: Request) {
  let platform = ''
  try { platform = new URL(process.env.PLATFORM_ORIGIN || '').origin } catch { throw new HttpError(503, '新后台地址尚未配置') }
  if (request.headers.get('origin') !== platform || !request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(403, '请求来源无效')
}
export async function me(request: Request) {
  const user = await identity(request)
  const params = new URL(request.url).searchParams
  if ((params.get('scope') === 'dashboard' || params.get('allowUnlicensed') === 'dashboard') && !can(user, '仪表盘', 'admin.home')) throw new HttpError(403, '没有访问权限')
  if (params.get('allowUnlicensed') === 'config' && !(can(user, '系统设置', 'admin.setting.config.index') && can(user, '配置信息', 'admin.setting.config.index'))) throw new HttpError(403, '没有访问权限')
  return Response.json(user, { headers })
}
export async function logout(request: Request) {
  assertOrigin(request)
  const raw = cookies(request)[SESSION]
  if (isToken(raw)) await db.query('DELETE FROM t_platform_session WHERE token_hash=$1', [digest(raw)])
  const responseHeaders = { ...headers, 'Set-Cookie': cookie(SESSION, '', 0) }
  if (cloudflareAccessRequired()) {
    const assertion = request.headers.get('cf-access-jwt-assertion') || ''
    if (assertion) await db.query('DELETE FROM t_platform_access_session WHERE token_hash=$1', [digest(assertion)])
    const issuer = process.env.CF_ACCESS_ISSUER || ''
    const returnTo = new URL('/login?loggedOut=1', process.env.PLATFORM_ORIGIN || '')
    const accessLogoutUrl = new URL('/cdn-cgi/access/logout', issuer)
    accessLogoutUrl.searchParams.set('returnTo', returnTo.href)
    return Response.json({ ok: true, accessLogoutUrl: accessLogoutUrl.href }, { headers: responseHeaders })
  }
  return Response.json({ ok: true }, { headers: responseHeaders })
}
export async function health(pool: Pick<typeof db, 'query'> = db, processMode = process.env.PLATFORM_PROCESS_MODE) {
  await pool.query('SELECT 1')
  if (processMode === 'all') {
    const worker = await pool.query(
      "SELECT 1 FROM t_platform_job_leader WHERE task_name=$1 AND lease_expires_at>now() AND updated_at>now()-interval '45 seconds' LIMIT 1",
      ['platform-job-scheduler'],
    )
    if (worker.rowCount !== 1) {
      return Response.json({ status: 'not_ready', runtime: 'typescript', database: 'connected', worker: 'not_ready' }, { status: 503, headers })
    }
    return Response.json({ status: 'ok', runtime: 'typescript', database: 'connected', worker: 'ready' }, { headers })
  }
  return Response.json({ status: 'ok', runtime: 'typescript', database: 'connected' }, { headers })
}
export async function bots(request: Request) {
  const user = await identity(request)
  requirePermission(user, '机器人列表', 'admin.telegram.telegrambot.index')
  const url = new URL(request.url)
  const { page, pageSize, search } = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(10), search: z.string().trim().max(100).default('') }).parse(Object.fromEntries(url.searchParams))
  const values = [`%${search}%`]
  const filter = `($1='%%' OR bot_username ILIKE $1 OR bot_firstname ILIKE $1 OR comments ILIKE $1)`
  const count = await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot WHERE ${filter}`,values)
  const rows = await db.query(`SELECT rid,bot_username,bot_firstname,bot_admin_username,comments,create_time AT TIME ZONE 'Asia/Shanghai' AS create_time,update_time AT TIME ZONE 'Asia/Shanghai' AS update_time,(bot_token<>'') AS token_configured FROM t_telegram_bot WHERE ${filter} ORDER BY rid DESC LIMIT $2 OFFSET $3`,[...values,pageSize,(page-1)*pageSize])
  return Response.json({ rows: rows.rows, total: count.rows[0].total, page, pageSize, canEdit: can(user,'修改机器人','admin.telegram.telegrambot.update') }, { headers })
}
export async function updateBot(request: Request) {
  assertOrigin(request)
  const user = await identity(request)
  requirePermission(user,'修改机器人','admin.telegram.telegrambot.update')
  const data = z.object({ rid: z.number().int().positive(), comments: z.string().trim().max(255) }).strict().parse(await request.json())
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const changed = await client.query('UPDATE t_telegram_bot SET comments=$2,update_by=$3,update_time=now() WHERE rid=$1 RETURNING rid',[data.rid,data.comments,user.id])
    if (!changed.rowCount) throw new HttpError(404,'机器人不存在')
    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'telegram.bot.update_comments',data.rid])
    await client.query('COMMIT')
    return Response.json({ ok: true }, { headers })
  } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function legacyPage(request: Request) {
  const user = await identity(request)
  const route = new URL(request.url).searchParams.get('route') || 'admin.home'
  const page = visibleNavigation(user).flatMap(group => group.items).find(item => item.id === route)
  if (!page) throw new HttpError(403, '没有访问权限或页面不存在')
  return redirect(new URL(page.path, origins().legacy).href)
}
