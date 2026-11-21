import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { digest } from './security'

const raw = process.env.TG_ADMIN_SECURITY_TEST_DB_URL
const dbUrl = raw ? new URL(raw) : null
const octets = dbUrl?.hostname.split('.').map(Number)
const privateHost = dbUrl?.hostname === 'postgres' || (process.env.TG_ADMIN_SECURITY_TEST_ALLOW_PRIVATE_DB === '1' && octets?.length === 4 && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)))
if (!raw || !dbUrl || !privateHost || !dbUrl.username.startsWith('admin_security_test_') || !dbUrl.pathname.slice(1).startsWith('admin_security_test_')) throw new Error('Admin security integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST = dbUrl.hostname
process.env.DB_PORT = dbUrl.port || '5432'
process.env.DB_DATABASE = dbUrl.pathname.slice(1)
process.env.DB_USERNAME = dbUrl.username
process.env.DB_PASSWORD = dbUrl.password
process.env.PLATFORM_ORIGIN = 'https://admin-security.test'
process.env.TRUSTED_PROXIES = '127.0.0.1'
process.env.APP_KEY = 'base64:' + 'a'.repeat(48)
process.env.MAIL_DRIVER = 'smtp'
process.env.MAIL_ENCRYPTION = 'none'
process.env.MAIL_USERNAME = 'fixture-user'
process.env.MAIL_PASSWORD = 'fixture-password'
process.env.MAIL_FROM_ADDRESS = 'noreply@example.test'

const setup = new pg.Pool({ connectionString: raw, max: 4, options: '-c timezone=Asia/Shanghai' })
await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(30) NOT NULL UNIQUE,password varchar(255) NOT NULL,status smallint NOT NULL DEFAULT 1,white_ip varchar(3000) NOT NULL DEFAULT \'\',security_email varchar(254),security_email_verified_at timestamp,passkey_user_handle varchar(64),created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_ip varchar(64),public_ip varchar(64),location varchar(255),device_type varchar(32),user_agent text,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(64) NOT NULL,config_val text)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\')')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_admin_security_settings(rid integer PRIMARY KEY,ip_whitelist_enabled boolean NOT NULL DEFAULT false,ip_whitelist text NOT NULL DEFAULT \'\',verification_enabled boolean NOT NULL DEFAULT false,verification_method varchar(100) NOT NULL DEFAULT \'captcha\',session_lifetime_minutes integer NOT NULL DEFAULT 120,passkey_config jsonb,updated_at timestamp)')
await setup.query('CREATE TABLE t_platform_security_maintenance(task_key varchar(100) PRIMARY KEY,last_run timestamp NOT NULL)')
await setup.query('CREATE TABLE t_admin_login_log(rid bigserial PRIMARY KEY,admin_name varchar(30),admin_id bigint,login_time timestamp,login_location varchar(255),login_ip varchar(64),public_ip varchar(64),device_type varchar(32),user_agent text)')
await setup.query('CREATE TABLE t_admin_passkey(rid bigserial PRIMARY KEY,admin_id bigint,name varchar(80),rp_id varchar(253),created_at timestamp,last_used_at timestamp,revoked_at timestamp)')
await setup.query('CREATE TABLE t_admin_passkey_unused(rid bigserial PRIMARY KEY)')
await setup.query('CREATE TABLE t_platform_admin_email_binding(admin_id bigint PRIMARY KEY,email varchar(254) NOT NULL,code_hash char(64) NOT NULL,attempts integer NOT NULL DEFAULT 0,created_at timestamp NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint,action varchar(100),resource_id bigint,created_at timestamp DEFAULT now())')
await setup.query('CREATE TABLE t_sys_admin_opt_log(rid bigserial PRIMARY KEY,admin_id bigint,opt_module varchar(100),opt_ref_sn char(64),opt_time timestamp,opt_content text)')
const passwordHash = await bcrypt.hash('AdminPass!234', 4)
await setup.query('INSERT INTO t_admin(id,name,password,status,white_ip) VALUES(1,\'root-security\',$1,1,\'\'),(2,\'reader-security\',$1,1,\'\')', [passwordHash])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'安全查看员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'系统设置','admin.setting.security.index',0)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_model_has_permissions(permission_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at,device_type,login_ip,public_ip) VALUES(11,1,encode(digest(repeat('a',64),'sha256'),'hex'),now(),now(),now()+interval '1 day','电脑','10.0.0.2','8.8.8.8'),(12,2,encode(digest(repeat('b',64),'sha256'),'hex'),now(),now(),now()+interval '1 day','手机','10.0.0.2','10.0.0.2')")
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')', [digest('a'.repeat(64)), digest('b'.repeat(64))])
await setup.query("INSERT INTO t_admin_login_log(admin_name,admin_id,login_time,login_location,login_ip,public_ip,device_type,user_agent) VALUES('root-security',1,now(),'未知','10.0.0.2','8.8.8.8','电脑','fixture'),('root-security',1,now()-interval '7 months','旧记录','8.8.4.4','8.8.4.4','电脑','old fixture')")
await setup.query("INSERT INTO t_admin_security_settings(rid,passkey_config) VALUES(1,'{}')")

const smtpMessages: string[] = []
const smtp = createServer(socket => {
  socket.write('220 admin-security.test ESMTP\r\n')
  let dataMode = false, current = ''
  socket.on('data', chunk => {
    const text = chunk.toString()
    if (dataMode) {
      current += text
      if (current.includes('\r\n.\r\n')) { smtpMessages.push(current); dataMode = false; current = ''; socket.write('250 queued\r\n') }
      return
    }
    for (const line of text.split('\r\n').filter(Boolean)) {
      const command = line.toUpperCase()
      if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-admin-security.test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n')
      else if (command.startsWith('AUTH')) socket.write('235 authenticated\r\n')
      else if (command.startsWith('MAIL FROM') || command.startsWith('RCPT TO')) socket.write('250 OK\r\n')
      else if (command === 'DATA') { dataMode = true; socket.write('354 end with dot\r\n') }
      else if (command === 'QUIT') { socket.write('221 bye\r\n'); socket.end() }
      else socket.write('250 OK\r\n')
    }
  })
})
await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
process.env.MAIL_HOST = '127.0.0.1'
process.env.MAIL_PORT = String((smtp.address() as { port: number }).port)
const tokens = new Map([[1, 'a'.repeat(64)], [2, 'b'.repeat(64)]])
const { adminSecurityApi } = await import('./admin-security.server')
function request(adminId: number, method = 'GET', body?: unknown, url = 'https://admin-security.test/api/settings-security', origin = 'https://admin-security.test') {
 const rawToken = tokens.get(adminId) || ''
 return new Request(url, { method, headers: { cookie: `tg_platform_session=${rawToken}`, ...(method === 'POST' ? { origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10, 127.0.0.1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function call(adminId: number, method = 'GET', body?: unknown, url?: string, origin?: string) {
 const response = await adminSecurityApi(request(adminId, method, body, url, origin))
 return { response, data: await response.json() as Record<string, any> }
}

try {
 await test('security read, permission boundaries, login log privacy, and saved multi-method settings', async () => {
  const read = await call(1)
  assert.equal(read.response.status, 200)
  assert.equal(read.data.devices.length, 1)
  assert.equal(read.data.devices[0].current, true)
  assert.equal(read.data.devices[0].ip, '未知')
  assert.equal(read.data.logs[0].deviceIp, '未知')
  assert.equal(read.data.logs[0].publicIp, '8.8.8.8')
  assert.equal((await setup.query("SELECT count(*)::int AS n FROM t_admin_login_log WHERE user_agent='old fixture'")).rows[0].n, 0, 'login records older than six months are removed')
  const deniedWrite = await call(2, 'POST', { action: 'save-settings', verification_enabled: true, verification_methods: ['captcha', 'claw'] })
  assert.equal(deniedWrite.response.status, 403)
  const emptyWhitelist = await call(1, 'POST', { action: 'save-settings', ip_whitelist_enabled: true, ip_whitelist: '' })
  assert.equal(emptyWhitelist.response.status, 422)
  const lockedOutWhitelist = await call(1, 'POST', { action: 'save-settings', ip_whitelist_enabled: true, ip_whitelist: '203.0.113.11' })
  assert.equal(lockedOutWhitelist.response.status, 422)
  const wrongOrigin = await call(1, 'POST', { action: 'save-settings', verification_enabled: true, verification_methods: ['captcha', 'claw'] }, undefined, 'https://evil.test')
  assert.equal(wrongOrigin.response.status, 403)
  const save = await call(1, 'POST', { action: 'save-settings', ip_whitelist_enabled: true, ip_whitelist: '203.0.113.10', verification_enabled: true, verification_methods: ['captcha', 'claw'], session_lifetime_minutes: 30 })
  assert.equal(save.response.status, 200)
  assert.equal((await setup.query('SELECT verification_method,ip_whitelist_enabled,ip_whitelist FROM t_admin_security_settings WHERE rid=1')).rows[0].verification_method, 'captcha,claw')
  const whitelist = await setup.query('SELECT ip_whitelist_enabled,ip_whitelist FROM t_admin_security_settings WHERE rid=1')
  assert.equal(whitelist.rows[0].ip_whitelist_enabled, true)
  assert.equal(whitelist.rows[0].ip_whitelist, '203.0.113.10')
  assert.equal((await setup.query("SELECT count(*)::int AS n FROM t_sys_admin_opt_log WHERE opt_content='更新登录安全设置'")).rows[0].n, 1)
  const expires = await setup.query("SELECT d.login_time,d.expires_at,s.expires_at AS session_expires FROM t_admin_device_session d JOIN t_platform_session s ON s.device_session_id=d.rid WHERE d.rid=11")
  assert.equal(new Date(expires.rows[0].expires_at).getTime() - new Date(expires.rows[0].login_time).getTime(), 30 * 60_000)
  assert.equal(new Date(expires.rows[0].expires_at).getTime(), new Date(expires.rows[0].session_expires).getTime())
  const activity = await call(1, 'GET', undefined, 'https://admin-security.test/api/settings-security?activity=1')
  assert.equal(activity.response.status, 200)
  assert.equal(activity.data.login.userAgent, 'fixture')
  assert.ok(activity.data.operations.some((row: any) => row.opt_content === '更新登录安全设置'))
 })
 await test('email binding sends a one-time code, throttles resend, counts bad attempts, and persists verification', async () => {
  const send = await call(1, 'POST', { action: 'send-email-code', email: 'Admin@Example.Test', password: 'AdminPass!234' })
  assert.equal(send.response.status, 200)
  assert.equal(send.data.message, '验证码已发送')
  assert.equal(smtpMessages.length, 1)
  assert.match(smtpMessages[0], /To: admin@example.test/i)
  const throttled = await call(1, 'POST', { action: 'send-email-code', email: 'admin@example.test', password: 'AdminPass!234' })
  assert.equal(throttled.response.status, 429)
  const transferEncoding = smtpMessages[0].match(/Content-Transfer-Encoding:\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase()
  let body = smtpMessages[0].split(/\r?\n\r?\n/).slice(1).join('\n')
  if (transferEncoding === 'base64') body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
  if (transferEncoding === 'quoted-printable') body = body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const code = body.match(/(\d{6})/)
  assert.ok(code, 'email content should include a six digit verification code')
  const wrong = await call(1, 'POST', { action: 'confirm-email', code: '000000' })
  assert.equal(wrong.response.status, 422)
  assert.equal((await setup.query('SELECT attempts FROM t_platform_admin_email_binding WHERE admin_id=1')).rows[0].attempts, 1)
  const confirmed = await call(1, 'POST', { action: 'confirm-email', code: code[1] })
  assert.equal(confirmed.response.status, 200, confirmed.data.message)
  assert.equal(confirmed.data.email, 'admin@example.test')
  assert.ok((await setup.query('SELECT security_email_verified_at FROM t_admin WHERE id=1')).rows[0].security_email_verified_at)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_admin_email_binding WHERE admin_id=1')).rows[0].n, 0)
  const summary = await call(1)
  assert.equal(summary.data.email.verified, true)
  const secondSend = await call(2, 'POST', { action: 'send-email-code', email: 'reader@example.test', password: 'AdminPass!234' })
  assert.equal(secondSend.response.status, 200)
  const secondEncoding = smtpMessages[1].match(/Content-Transfer-Encoding:\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase()
  let secondBody = smtpMessages[1].split(/\r?\n\r?\n/).slice(1).join('\n')
  if (secondEncoding === 'base64') secondBody = Buffer.from(secondBody.replace(/\s/g, ''), 'base64').toString('utf8')
  if (secondEncoding === 'quoted-printable') secondBody = secondBody.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const secondCode = secondBody.match(/(\d{6})/)
  assert.ok(secondCode)
  assert.equal((await call(2, 'POST', { action: 'confirm-email', code: secondCode[1] })).response.status, 200)
  assert.equal((await call(1, 'POST', { action: 'save-settings', verification_enabled: true, verification_methods: ['captcha', 'email', 'claw'] })).response.status, 200)
  assert.equal((await setup.query('SELECT verification_method FROM t_admin_security_settings WHERE rid=1')).rows[0].verification_method, 'captcha,email,claw')
  const selfLogout = await call(2, 'POST', { action: 'revoke-device', rid: '12' })
  assert.equal(selfLogout.response.status, 200)
  assert.equal(selfLogout.data.isCurrent, true)
  assert.equal((await setup.query('SELECT revoked_at IS NOT NULL AS revoked FROM t_admin_device_session WHERE rid=12')).rows[0].revoked, true)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_session WHERE device_session_id=12')).rows[0].n, 0)
  assert.equal((await setup.query("SELECT count(*)::int AS n FROM t_sys_admin_opt_log WHERE opt_content='验证并绑定安全邮箱' AND admin_id=1")).rows[0].n, 1)
 })
} finally {
 smtp.close()
 await setup.end()
 const { db } = await import('./db.server')
 await db.end()
}
