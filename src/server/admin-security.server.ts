import { isIP } from "node:net"
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto"
import bcrypt from "bcryptjs"
import argon2 from "argon2"
import nodemailer from "nodemailer"
import { z } from "zod"
import { db } from "./db.server"
import { identity, run, type Identity } from "./api.server"
import { cookies, digest } from "./security"

const SESSION_COOKIE = "tg_platform_session"
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const lifetimes = [30, 120, 480, 1440, 10080, 43200]
const methods = ["captcha", "email", "claw", "turnstile"] as const
const saveSchema = z.object({
  action: z.literal("save-settings"),
  ip_whitelist_enabled: z.boolean().optional(),
  ip_whitelist: z.string().max(5000).optional(),
  verification_enabled: z.boolean().optional(),
  verification_methods: z.array(z.enum(methods)).min(1).max(4).optional(),
  session_lifetime_minutes: z.number().int().refine(value => lifetimes.includes(value)).optional(),
}).strict()
type Settings = {
  ip_whitelist_enabled: boolean; ip_whitelist: string; verification_enabled: boolean;
  verification_methods: string[]; verification_method: string; session_lifetime_minutes: number;
}
class SecurityRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
function isSuperAdmin(user: Identity) { return user.roles.includes("超级管理员") }
function canView(user: Identity) { return isSuperAdmin(user) || user.permissions.includes("系统设置") }
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get("origin") !== new URL(origin).origin || !request.headers.get("content-type")?.startsWith("application/json")) {
    throw new SecurityRequestError(403, "请求来源无效")
  }
}
function configuredTurnstile() {
  const enabled = ["1", "true", "yes", "on"].includes((process.env.TURNSTILE_ENABLE || "").toLowerCase())
  return enabled && Boolean(process.env.TURNSTILE_SITE_KEY?.trim()) && Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}
function mailReady() {
  const driver = (process.env.MAIL_DRIVER || process.env.MAIL_MAILER || "smtp").trim().toLowerCase()
  const from = (process.env.MAIL_FROM_ADDRESS || "").trim()
  const senderReady = Boolean(from) && from !== "hello@example.com"
  if (driver === "smtp") {
    const host = (process.env.MAIL_HOST || "").trim()
    return senderReady && Boolean(host) && host !== "smtp.mailgun.org" && Boolean(process.env.MAIL_USERNAME?.trim()) && Boolean(process.env.MAIL_PASSWORD?.trim())
  }
  if (driver === "sendmail") return senderReady
  if (driver === "mailgun") return senderReady && Boolean(process.env.MAILGUN_DOMAIN) && Boolean(process.env.MAILGUN_SECRET)
  if (driver === "ses") return senderReady && Boolean(process.env.AWS_ACCESS_KEY_ID) && Boolean(process.env.AWS_SECRET_ACCESS_KEY) && Boolean(process.env.AWS_DEFAULT_REGION)
  if (driver === "sparkpost") return senderReady && Boolean(process.env.SPARKPOST_SECRET)
  return false
}
function normalizeMethods(value: unknown) {
  const parsed = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : []
  return methods.filter(method => parsed.includes(method))
}
function defaults(): Settings {
  const lifetime = Number(process.env.SESSION_LIFETIME || 120)
  const ready = configuredTurnstile()
  return {
    ip_whitelist_enabled: false, ip_whitelist: "", verification_enabled: ready,
    verification_methods: [ready ? "turnstile" : "captcha"],
    verification_method: ready ? "turnstile" : "captcha",
    session_lifetime_minutes: lifetimes.includes(lifetime) ? lifetime : 120,
  }
}
function parseIpList(raw: string) {
  const items = raw.trim().split(/[\s,;]+/).filter(Boolean)
  const invalid = items.filter(item => isIP(item) === 0)
  const valid = [...new Set(items.filter(item => isIP(item) !== 0))]
  return { valid, invalid }
}
function ipToV4(value: string): number | null {
  if (isIP(value) !== 4) return null
  return value.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0)
}
function matchesProxy(ip: string, entry: string) {
  if (ip === entry) return true
  const [network, prefixText, ...extra] = entry.split("/")
  const candidate = ipToV4(ip), base = ipToV4(network)
  if (candidate === null || base === null || extra.length || prefixText === undefined) return false
  const prefix = Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (candidate & mask) === (base & mask)
}
function trustedClientIp(request: Request): { ip: string | null; trusted: boolean } {
  const configured = (process.env.TRUSTED_PROXIES || "").split(",").map(item => item.trim()).filter(Boolean)
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",").map(item => item.trim()).filter(item => isIP(item) !== 0)
  if (!configured.length) return { ip: null, trusted: false }
  if (!forwarded.length) return { ip: null, trusted: false }
  for (let index = forwarded.length - 1; index >= 0; index--) {
    const current = forwarded[index]
    if (!configured.some(proxy => matchesProxy(current, proxy))) return { ip: current, trusted: true }
  }
  return { ip: forwarded[0] || null, trusted: false }
}
function validIp(value: unknown) {
  const ip = String(value || "").trim()
  return isIP(ip) ? ip : null
}
function emailCodeHash(adminId: string, email: string, code: string) {
  const secret = process.env.APP_KEY || ""
  if (secret.length < 32) throw new SecurityRequestError(503, "邮箱验证暂不可用")
  return createHmac("sha256", secret).update(`${adminId}|${email}|${code}`).digest("hex")
}
async function verifyAdminPassword(adminId: string, password: string) {
  const result = await db.query("SELECT password FROM t_admin WHERE id=$1 AND status=1", [adminId])
  if (!result.rowCount) return false
  const stored = String(result.rows[0].password || "")
  try {
    if (stored.startsWith("$2")) return await bcrypt.compare(password, stored)
    if (stored.startsWith("$argon2")) return await argon2.verify(stored, password)
    const sha = createHash("sha256").update(password).digest("hex")
    const md5 = createHash("md5").update(password).digest("hex")
    const compare = (candidate: string) => {
      const a = Buffer.from(stored), b = Buffer.from(candidate)
      return a.length === b.length && timingSafeEqual(a, b)
    }
    return compare(sha) || compare(md5)
  } catch { return false }
}
async function sendEmailCode(user: Identity, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityRequestError(400, "请求内容无效")
  const body = z.object({ action: z.literal("send-email-code"), email: z.string().trim().email().max(254) .transform(value => value.toLowerCase()), password: z.string().min(1).max(255) }).strict().parse(input)
  if (!await verifyAdminPassword(user.id, body.password)) throw new SecurityRequestError(422, "当前密码错误")
  if (!mailReady()) throw new SecurityRequestError(422, "邮件发送参数未配置完整")
  const duplicate = await db.query("SELECT 1 FROM t_admin WHERE id<>$1 AND lower(security_email)=lower($2) LIMIT 1", [user.id, body.email])
  if (duplicate.rowCount) throw new SecurityRequestError(422, "该邮箱已绑定到其他管理员")
  const recent = await db.query("SELECT created_at FROM t_platform_admin_email_binding WHERE admin_id=$1", [user.id])
  if (recent.rowCount && new Date(recent.rows[0].created_at).getTime() > Date.now() - 60_000) throw new SecurityRequestError(429, "请稍后再发送验证码")
  const code = String(randomInt(100000, 1000000))
  const host = (process.env.MAIL_HOST || "").trim()
  const port = Number(process.env.MAIL_PORT || ((process.env.MAIL_ENCRYPTION || "").toLowerCase() === "ssl" ? 465 : 587))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SecurityRequestError(503, "邮件服务配置无效")
  const encryption = (process.env.MAIL_ENCRYPTION || "tls").trim().toLowerCase()
  const transport = nodemailer.createTransport({
    host, port, secure: encryption === "ssl" || encryption === "smtps" || port === 465,
    requireTLS: encryption === "tls" || encryption === "starttls",
    auth: process.env.MAIL_USERNAME || process.env.MAIL_PASSWORD ? { user: process.env.MAIL_USERNAME || "", pass: process.env.MAIL_PASSWORD || "" } : undefined,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  })
  try {
    await transport.sendMail({
      from: { name: process.env.MAIL_FROM_NAME || "TGBotPress", address: process.env.MAIL_FROM_ADDRESS || "" },
      to: body.email, subject: "TGBotPress 管理员邮箱验证",
      text: `您的 TGBotPress 管理后台邮箱验证码为 ${code}，10 分钟内有效。`,
    })
  } catch { throw new SecurityRequestError(502, "验证码邮件发送失败，请检查邮件配置") }
  finally { transport.close() }
  await db.query(`INSERT INTO t_platform_admin_email_binding(admin_id,email,code_hash,attempts,created_at,expires_at)
    VALUES($1,$2,$3,0,now(),now()+interval '10 minutes')
    ON CONFLICT(admin_id) DO UPDATE SET email=EXCLUDED.email,code_hash=EXCLUDED.code_hash,attempts=0,created_at=now(),expires_at=EXCLUDED.expires_at`,
  [user.id, body.email, emailCodeHash(user.id, body.email, code)])
  return { message: "验证码已发送" }
}
async function confirmEmail(user: Identity, request: Request, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityRequestError(400, "请求内容无效")
  const body = z.object({ action: z.literal("confirm-email"), code: z.string().regex(/^\d{6}$/) }).strict().parse(input)
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const challenge = await client.query("SELECT email,code_hash,attempts,expires_at FROM t_platform_admin_email_binding WHERE admin_id=$1 FOR UPDATE", [user.id])
    if (!challenge.rowCount || new Date(challenge.rows[0].expires_at).getTime() <= Date.now() || Number(challenge.rows[0].attempts) >= 5) {
      await client.query("DELETE FROM t_platform_admin_email_binding WHERE admin_id=$1", [user.id])
      await client.query("COMMIT")
      throw new SecurityRequestError(422, "验证码错误或已过期")
    }
    const row = challenge.rows[0]
    const expected = Buffer.from(String(row.code_hash)), actual = Buffer.from(emailCodeHash(user.id, String(row.email), body.code))
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = Number(row.attempts) + 1
      if (attempts >= 5) await client.query("DELETE FROM t_platform_admin_email_binding WHERE admin_id=$1", [user.id])
      else await client.query("UPDATE t_platform_admin_email_binding SET attempts=$2 WHERE admin_id=$1", [user.id, attempts])
      await client.query("COMMIT")
      throw new SecurityRequestError(422, "验证码错误或已过期")
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(row.email)])
    const duplicate = await client.query("SELECT 1 FROM t_admin WHERE id<>$1 AND lower(security_email)=lower($2) LIMIT 1", [user.id, row.email])
    if (duplicate.rowCount) throw new SecurityRequestError(409, "该邮箱已绑定到其他管理员")
    await client.query("UPDATE t_admin SET security_email=$2,security_email_verified_at=now(),updated_at=now() WHERE id=$1", [user.id, row.email])
    await client.query("DELETE FROM t_platform_admin_email_binding WHERE admin_id=$1", [user.id])
    const session = cookies(request)[SESSION_COOKIE] || ""
    await client.query("INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security',$2,now(),'验证并绑定安全邮箱')", [user.id, digest(session)])
    await client.query("COMMIT")
    return { message: "邮箱已验证", email: String(row.email) }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally { client.release() }
}
function publicIp(value: unknown) {
  const ip = validIp(value)
  if (!ip) return null
  const version = isIP(ip)
  const lower = ip.toLowerCase()
  if (version === 4) {
    const [a, b, c] = ip.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      || (a === 203 && b === 0 && c === 113)) return null
    return ip
  }
  if (lower.startsWith("::ffff:")) return publicIp(lower.slice(7))
  const first = Number.parseInt(lower.split(":")[0] || "0", 16)
  if (first < 0x2000 || first > 0x3fff || lower.startsWith("2001:db8:")
    || lower.startsWith("2001:0:") || lower.startsWith("2001:10:") || lower.startsWith("2001:20:")
    || lower.startsWith("2001:2:") || lower.startsWith("2002:")) return null
  return ip
}
async function settings(): Promise<Settings> {
  const result = await db.query("SELECT ip_whitelist_enabled,ip_whitelist,verification_enabled,verification_method,session_lifetime_minutes FROM t_admin_security_settings WHERE rid=1")
  if (!result.rowCount) return defaults()
  const row = result.rows[0]
  const selected = normalizeMethods(row.verification_method)
  const methodsValue = selected.length ? selected : ["captcha"]
  return {
    ip_whitelist_enabled: [true, 1, "1", "t", "true", "yes"].includes(row.ip_whitelist_enabled),
    ip_whitelist: String(row.ip_whitelist || ""), verification_enabled: [true, 1, "1", "t", "true", "yes"].includes(row.verification_enabled),
    verification_methods: methodsValue, verification_method: methodsValue[0],
    session_lifetime_minutes: lifetimes.includes(Number(row.session_lifetime_minutes)) ? Number(row.session_lifetime_minutes) : defaults().session_lifetime_minutes,
  }
}
async function cleanupOldLogs() {
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const lock = await client.query(
      "INSERT INTO t_platform_security_maintenance(task_key,last_run) VALUES('admin-login-log-6-months',now()) ON CONFLICT(task_key) DO UPDATE SET last_run=now() WHERE t_platform_security_maintenance.last_run < now()-interval '1 day' RETURNING task_key",
    )
    if (lock.rowCount) await client.query("DELETE FROM t_admin_login_log WHERE login_time < now()-interval '6 months'")
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally { client.release() }
}
async function currentDeviceId(request: Request, adminId: string) {
  const session = cookies(request)[SESSION_COOKIE]
  if (!session) return null
  const result = await db.query(
    "SELECT device_session_id::text FROM t_platform_session WHERE token_hash=$1 AND admin_id=$2 AND expires_at>now()",
    [digest(session), adminId],
  )
  return result.rows[0]?.device_session_id || null
}
async function pageData(request: Request, user: Identity) {
  await cleanupOldLogs()
  const current = await settings()
  const deviceId = await currentDeviceId(request, user.id)
  const logs = await db.query(
    "SELECT rid,login_time,login_location,login_ip,public_ip,device_type,user_agent FROM t_admin_login_log WHERE admin_id=$1 OR (admin_id IS NULL AND admin_name=$2) ORDER BY login_time DESC NULLS LAST LIMIT 30",
    [user.id, user.name],
  )
  const devices = await db.query(
    "SELECT rid::text AS rid,login_ip,login_time,last_seen_at,expires_at,device_type,user_agent FROM t_admin_device_session WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY last_seen_at DESC LIMIT 20",
    [user.id],
  )
  const admin = await db.query("SELECT security_email,security_email_verified_at FROM t_admin WHERE id=$1", [user.id])
  const unverified = await db.query(
    "SELECT count(*)::int AS count FROM t_admin WHERE status=1 AND (security_email IS NULL OR security_email='' OR security_email_verified_at IS NULL)",
  )
  const passkeySettings = await db.query("SELECT passkey_config::text FROM t_admin_security_settings WHERE rid=1")
  const passkeyRows = await db.query(
    "SELECT to_regclass('public.t_admin_passkey') IS NOT NULL AS available",
  )
  let credentials: any[] = []
  if (passkeyRows.rows[0]?.available) {
    const keys = await db.query("SELECT rid::text AS rid,name,rp_id,created_at,last_used_at FROM t_admin_passkey WHERE admin_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC", [user.id])
    credentials = keys.rows
  }
  let passkey = {
    enabled: false, rp_name: "TGBotPress", rp_id: new URL(process.env.PLATFORM_ORIGIN || "http://localhost").hostname,
    origins: [new URL(process.env.PLATFORM_ORIGIN || "http://localhost").origin],
    user_verification: "required", attachment: "", allow_insecure_origin: false,
  } as Record<string, any>
  try {
    const saved = JSON.parse(passkeySettings.rows[0]?.passkey_config || "null")
    if (saved && typeof saved === "object") passkey = { ...passkey, ...saved }
  } catch {}
  const trusted = trustedClientIp(request)
  return {
    settings: current,
    logs: logs.rows.map(row => ({
      rid: row.rid, time: row.login_time, location: row.login_location || "未知",
      deviceIp: publicIp(row.login_ip) || "未知", publicIp: publicIp(row.public_ip) || "—",
      deviceType: row.device_type || "未知",
    })),
    devices: devices.rows.map(row => ({
      rid: row.rid, ip: publicIp(row.login_ip) || "未知", loginTime: row.login_time,
      lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, deviceType: row.device_type || "未知",
      userAgent: row.user_agent || "", current: String(row.rid) === String(deviceId),
    })),
    email: { address: admin.rows[0]?.security_email || "", verified: Boolean(admin.rows[0]?.security_email_verified_at), mailReady: mailReady(), allAdminsVerified: Number(unverified.rows[0]?.count || 0) === 0 },
    passkey: { settings: passkey, credentials, available: Boolean(passkeyRows.rows[0]?.available) },
    currentIp: trusted.ip, clientIpTrusted: trusted.trusted,
    canManage: isSuperAdmin(user),
  }
}
function operationLog(adminId: string, ref: string, content: string) {
  return db.query(
    "INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security',$2,now(),$3)",
    [adminId, ref, content.slice(0, 500)],
  )
}
async function securityActivity(user: Identity, rid: number) {
  const login = await db.query(
    `SELECT l.rid,l.login_time,l.login_location,l.login_ip,l.public_ip,l.device_type,l.user_agent,
      (SELECT COALESCE(json_agg(activity), '[]'::json) FROM (
        SELECT o.opt_time,o.opt_module,o.opt_content
        FROM t_sys_admin_opt_log o
        WHERE o.admin_id=$2 AND o.opt_time>=l.login_time
          AND o.opt_time<COALESCE((SELECT min(next_login.login_time) FROM t_admin_login_log next_login
            WHERE next_login.login_time>l.login_time AND (next_login.admin_id=$2 OR (next_login.admin_id IS NULL AND next_login.admin_name=$3))), 'infinity'::timestamp)
        ORDER BY o.opt_time DESC LIMIT 100
      ) activity) AS operations
     FROM t_admin_login_log l
     WHERE l.rid=$1 AND (l.admin_id=$2 OR (l.admin_id IS NULL AND l.admin_name=$3))`,
    [rid, user.id, user.name],
  )
  if (!login.rowCount) throw new SecurityRequestError(404, "登录记录不存在")
  const record = login.rows[0]
  return {
    login: { time: record.login_time, location: record.login_location || "未知", deviceIp: validIp(record.login_ip) || "未知", publicIp: publicIp(record.public_ip) || "—", deviceType: record.device_type || "未知", userAgent: record.user_agent || "未知" },
    operations: record.operations || [],
  }
}
async function saveSettings(user: Identity, request: Request, input: z.infer<typeof saveSchema>) {
  if (!isSuperAdmin(user)) throw new SecurityRequestError(403, "只有超级管理员可以修改登录安全设置")
  const current = await settings()
  const next: Settings = {
    ...current,
    ...(input.ip_whitelist_enabled === undefined ? {} : { ip_whitelist_enabled: input.ip_whitelist_enabled }),
    ...(input.ip_whitelist === undefined ? {} : { ip_whitelist: input.ip_whitelist }),
    ...(input.verification_enabled === undefined ? {} : { verification_enabled: input.verification_enabled }),
    ...(input.verification_methods === undefined ? {} : { verification_methods: [...new Set(input.verification_methods)].sort((a,b) => methods.indexOf(a)-methods.indexOf(b)) }),
    ...(input.session_lifetime_minutes === undefined ? {} : { session_lifetime_minutes: input.session_lifetime_minutes }),
    verification_method: current.verification_method,
  }
  next.verification_method = next.verification_methods[0] || "captcha"
  if (input.ip_whitelist !== undefined) {
    const parsed = parseIpList(input.ip_whitelist)
    if (parsed.invalid.length) throw new SecurityRequestError(422, `IP 格式无效：${parsed.invalid.slice(0, 3).join("、")}`)
    if (parsed.valid.length > 100) throw new SecurityRequestError(422, "最多设置 100 个 IP 地址")
    next.ip_whitelist = parsed.valid.join("\n")
  }
  if (next.ip_whitelist_enabled) {
    const parsed = parseIpList(next.ip_whitelist)
    if (!parsed.valid.length) throw new SecurityRequestError(422, "请先填写至少一个有效 IP，再开启限制")
    const trusted = trustedClientIp(request)
    if (!trusted.trusted || !trusted.ip) throw new SecurityRequestError(422, "当前请求无法确认真实 IP。请配置 TRUSTED_PROXIES 后再开启白名单。")
    if (!parsed.valid.includes(trusted.ip)) throw new SecurityRequestError(422, "当前访问 IP 不在白名单中，已阻止保存以免锁定管理员")
  }
  if (next.verification_enabled && next.verification_methods.includes("turnstile")) {
    const cf = await (await import("./cloudflare-config.server")).getCloudflareConfig()
    if (!cf.turnstileEnabled || !cf.turnstileSiteKey || !cf.turnstileSecret) throw new SecurityRequestError(422, "请先在 Cloudflare 设置中配置并启用 Turnstile")
  }
  if (next.verification_enabled && next.verification_methods.includes("email")) {
    if (!mailReady()) throw new SecurityRequestError(422, "邮件发送参数未配置完整，暂不能启用邮箱验证码")
    const missing = await db.query("SELECT count(*)::int AS count FROM t_admin WHERE status=1 AND (security_email IS NULL OR security_email='' OR security_email_verified_at IS NULL)")
    if (Number(missing.rows[0]?.count || 0) > 0) throw new SecurityRequestError(422, `还有 ${missing.rows[0].count} 个启用中的管理员未验证邮箱`)
  }
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      "INSERT INTO t_admin_security_settings(rid,ip_whitelist_enabled,ip_whitelist,verification_enabled,verification_method,session_lifetime_minutes,updated_at) VALUES(1,$1,$2,$3,$4,$5,now()) ON CONFLICT(rid) DO UPDATE SET ip_whitelist_enabled=EXCLUDED.ip_whitelist_enabled,ip_whitelist=EXCLUDED.ip_whitelist,verification_enabled=EXCLUDED.verification_enabled,verification_method=EXCLUDED.verification_method,session_lifetime_minutes=EXCLUDED.session_lifetime_minutes,updated_at=now()",
      [next.ip_whitelist_enabled, next.ip_whitelist, next.verification_enabled, next.verification_methods.join(","), next.session_lifetime_minutes],
    )
    if (current.session_lifetime_minutes !== next.session_lifetime_minutes) {
      await client.query("UPDATE t_admin_device_session SET expires_at=login_time+($1 * interval '1 minute') WHERE revoked_at IS NULL AND expires_at>now()", [next.session_lifetime_minutes])
      await client.query("UPDATE t_platform_session s SET expires_at=d.expires_at FROM t_admin_device_session d WHERE s.device_session_id=d.rid AND s.admin_id=d.admin_id AND d.revoked_at IS NULL")
    }
    await client.query(
      "INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security',$2,now(),'更新登录安全设置')",
      [user.id, digest(cookies(request)[SESSION_COOKIE] || "")],
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally { client.release() }
  return next
}
async function revokeDevice(user: Identity, request: Request, rid: string) {
  const device = await db.query("SELECT session_hash FROM t_admin_device_session WHERE rid=$1 AND admin_id=$2 AND revoked_at IS NULL", [rid, user.id])
  if (!device.rowCount) throw new SecurityRequestError(404, "设备记录不存在或已下线")
  const session = cookies(request)[SESSION_COOKIE] || ""
  const currentHash = session ? digest(session) : ""
  const isCurrent = Boolean(currentHash && currentHash === device.rows[0].session_hash)
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query("UPDATE t_admin_device_session SET revoked_at=now(),expires_at=now() WHERE rid=$1 AND admin_id=$2 AND revoked_at IS NULL", [rid, user.id])
    await client.query("DELETE FROM t_platform_session WHERE device_session_id=$1 AND admin_id=$2", [rid, user.id])
    await client.query(
      "INSERT INTO t_sys_admin_opt_log(admin_id,opt_module,opt_ref_sn,opt_time,opt_content) VALUES($1,'admin/setting/security',$2,now(),$3)",
      [user.id, currentHash || null, `强制下线设备 #${rid}`],
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally { client.release() }
  return { isCurrent }
}
export async function adminSecurityApi(request: Request) {
  return run(async () => {
    try {
    const user = await identity(request)
    if (!canView(user)) throw new SecurityRequestError(403, "没有访问权限")
    const url = new URL(request.url)
    if (request.method === "GET") {
      const rid = url.searchParams.get("activity")
      return Response.json(rid ? await securityActivity(user, z.coerce.number().int().positive().parse(rid)) : await pageData(request, user), { headers })
    }
    if (request.method !== "POST") return Response.json({ message: "不支持的请求方式" }, { status: 405, headers })
    assertOrigin(request)
    const input = await request.json()
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityRequestError(400, "请求内容无效")
    const action = (input as Record<string, unknown>).action
    if (action === "send-email-code") return Response.json(await sendEmailCode(user, input), { headers })
    if (action === "confirm-email") return Response.json(await confirmEmail(user, request, input), { headers })
    if (action === "save-settings") {
      const parsed = saveSchema.parse(input)
      return Response.json({ message: "已保存", settings: await saveSettings(user, request, parsed) }, { headers })
    }
    if (action === "revoke-device") {
      const parsed = z.object({ action: z.literal("revoke-device"), rid: z.string().regex(/^[1-9][0-9]{0,18}$/) }).strict().parse(input)
      return Response.json({ message: "设备已下线", ...(await revokeDevice(user, request, parsed.rid)) }, { headers })
    }
    throw new SecurityRequestError(400, "操作不受支持")
    } catch (error) {
      if (error instanceof SecurityRequestError) return Response.json({ message: error.message }, { status: error.status, headers })
      throw error
    }
  })
}
