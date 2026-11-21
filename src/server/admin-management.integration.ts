import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw = process.env.TG_ADMIN_MANAGEMENT_TEST_DB_URL
const dbUrl = raw ? new URL(raw) : null
const ip = dbUrl?.hostname.split('.').map(Number)
const privateHost = dbUrl?.hostname === 'postgres' || (process.env.TG_ADMIN_MANAGEMENT_TEST_ALLOW_PRIVATE_DB === '1' && ip?.length === 4 && (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168)))
if (!raw || !dbUrl || !privateHost || !dbUrl.username.startsWith('admin_management_test_') || !dbUrl.pathname.slice(1).startsWith('admin_management_test_')) throw new Error('Admin management integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST = dbUrl.hostname
process.env.DB_PORT = dbUrl.port || '5432'
process.env.DB_DATABASE = dbUrl.pathname.slice(1)
process.env.DB_USERNAME = dbUrl.username
process.env.DB_PASSWORD = dbUrl.password
process.env.PLATFORM_ORIGIN = 'https://admin-management.test'

const setup = new pg.Pool({ connectionString: raw, max: 4 })
await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(30) NOT NULL UNIQUE,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1,white_ip varchar(3000) NOT NULL DEFAULT \'\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_platform_auth_ticket(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,state char(64),challenge char(64),device_session_id bigint,expires_at timestamp)')
await setup.query('CREATE TABLE t_admin_passkey(id bigserial PRIMARY KEY,admin_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint NOT NULL,action text NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password,status,white_ip,created_at) VALUES(1,'root-admin','fixture',1,'',now()),(2,'limited-admin','fixture',1,'',now()),(3,'protected-super','fixture',1,'',now())")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
await setup.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day'),($3,3,13,now()+interval '1 day')", [digest('a'.repeat(64)),digest('b'.repeat(64)),digest('c'.repeat(64))])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'普通管理员'),(3,'受限管理员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'系统管理',NULL,0),(2,'管理员管理','admin.system.admin.index',1),(3,'添加管理员','admin.system.admin.add',2),(4,'修改管理员状态','admin.system.admin.change_status',2),(5,'修改管理员资料','admin.system.admin.update',2),(6,'删除管理员','admin.system.admin.delete',2)")
await setup.query("INSERT INTO t_role_has_permissions(role_id,permission_id) SELECT 2,id FROM t_permissions")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(2,'App\\Models\\Admin\\Admin',1),(3,'App\\Models\\Admin\\Admin',2),(1,'App\\Models\\Admin\\Admin',3)")
await setup.query("SELECT setval(pg_get_serial_sequence('t_admin','id'),(SELECT max(id) FROM t_admin))")
await setup.query("SELECT setval(pg_get_serial_sequence('t_admin_device_session','rid'),(SELECT max(rid) FROM t_admin_device_session))")
await setup.query("SELECT setval(pg_get_serial_sequence('t_roles','id'),(SELECT max(id) FROM t_roles))")
await setup.query("SELECT setval(pg_get_serial_sequence('t_permissions','id'),(SELECT max(id) FROM t_permissions))")

const tokens = new Map<number, string>()
for (const [id, token] of [[1, 'a'.repeat(64)],[2, 'b'.repeat(64)],[3, 'c'.repeat(64)]] as const) tokens.set(id, token)
const { adminManagementApi } = await import('./admin-management-api.server')
function request(adminId: number, method = 'GET', body?: unknown, url = 'https://admin-management.test/api/admin-management') {
 const value = tokens.get(adminId)
 return new Request(url, { method, headers: { cookie: `tg_platform_session=${value}`, ...(method === 'POST' ? { origin: 'https://admin-management.test', 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function call(adminId: number, method = 'GET', body?: unknown, url?: string) {
 const response = await adminManagementApi(request(adminId, method, body, url))
 return { response, data: await response.json() as Record<string, any> }
}

try {
 await test('admin list and CRUD preserve account, role, status, audit, and session behavior', async () => {
  const listed = await call(1)
  assert.equal(listed.response.status, 200)
  assert.deepEqual(listed.data.permissions, { create: true, status: true, update: true, delete: true })
  assert.equal((await call(2)).response.status, 403)
  const created = await call(1, 'POST', { action: 'create', name: 'new-managed', password: 'Passw0rd!fixture', whiteIp: '192.0.2.4', status: true })
  assert.equal(created.response.status, 200)
  const duplicate = await call(1, 'POST', { action: 'create', name: 'new-managed', password: 'Passw0rd!fixture' })
  assert.equal(duplicate.response.status, 409)
  const id = Number((await setup.query("SELECT id FROM t_admin WHERE name='new-managed'")).rows[0].id)
  const deviceToken = randomBytes(32).toString('hex')
  const device = await setup.query(`INSERT INTO t_admin_device_session(admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES($1,$2,now(),now(),now()+interval '1 day') RETURNING rid`, [id, digest(deviceToken)])
  await setup.query(`INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`, [digest(deviceToken), id, device.rows[0].rid])
  tokens.set(id, deviceToken)
  const otherToken = randomBytes(32).toString('hex')
  const otherDevice = await setup.query(`INSERT INTO t_admin_device_session(admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES($1,$2,now(),now(),now()+interval '1 day') RETURNING rid`, [id, digest(otherToken)])
  await setup.query(`INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`, [digest(otherToken), id, otherDevice.rows[0].rid])
  const updated = await call(1, 'POST', { action: 'update', id, name: 'managed-renamed', password: '', whiteIp: '198.51.100.1,198.51.100.2', roleIds: [2] })
  assert.equal(updated.response.status, 200)
  const row = await setup.query('SELECT name,white_ip FROM t_admin WHERE id=$1', [id])
  assert.deepEqual(row.rows[0], { name: 'managed-renamed', white_ip: '198.51.100.1,198.51.100.2' })
  const filtered = await call(1, 'GET', undefined, 'https://admin-management.test/api/admin-management?name=managed-renamed&page=1&pageSize=10')
  assert.equal(filtered.response.status, 200)
  assert.equal(filtered.data.total, 1)
  assert.equal(filtered.data.rows[0].id, String(id))
  const passwordChange = await call(id, 'POST', { action: 'change-password', oldPassword: 'Passw0rd!fixture', newPassword: 'NewPassw0rd!fixture', confirmPassword: 'NewPassw0rd!fixture' })
  assert.equal(passwordChange.response.status, 200)
  assert.equal((await setup.query(`SELECT crypt($1,'$2a$'||substring(password from 5))='$2a$'||substring(password from 5) AS valid FROM t_admin WHERE id=$2`, ['NewPassw0rd!fixture', id])).rows[0].valid, true)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_session WHERE admin_id=$1', [id])).rows[0].n, 1)
  assert.ok((await setup.query('SELECT revoked_at FROM t_admin_device_session WHERE rid=$1', [otherDevice.rows[0].rid])).rows[0].revoked_at)
  assert.equal(String((await setup.query('SELECT role_id FROM t_model_has_roles WHERE model_id=$1', [id])).rows[0].role_id), '2')
  const disabled = await call(1, 'POST', { action: 'set-status', id, enabled: false })
  assert.equal(disabled.response.status, 200)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_session WHERE admin_id=$1', [id])).rows[0].n, 0)
  assert.ok((await setup.query('SELECT revoked_at FROM t_admin_device_session WHERE admin_id=$1', [id])).rows[0].revoked_at)
  assert.equal((await call(1, 'POST', { action: 'set-status', id, enabled: true })).response.status, 200)
  await setup.query('INSERT INTO t_admin_passkey(admin_id) VALUES($1)', [id])
  await setup.query('INSERT INTO t_platform_auth_ticket(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')', [randomBytes(32).toString('hex'), id])
  assert.equal((await call(1, 'POST', { action: 'delete', id })).response.status, 200)
  for (const table of ['t_admin','t_admin_passkey','t_platform_session','t_platform_auth_ticket','t_model_has_roles','t_model_has_permissions']) assert.equal((await setup.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === 't_admin' ? 'id' : table === 't_admin_passkey' || table === 't_platform_session' || table === 't_platform_auth_ticket' ? 'admin_id' : 'model_id'}=$1`, [id])).rows[0].n, 0, table)
  assert.ok((await setup.query("SELECT count(*)::int AS n FROM t_platform_audit_log WHERE action LIKE 'admin.%'")).rows[0].n >= 5)
 })

 await test('authorization, origin, self-protection, and last-super-admin invariants are enforced', async () => {
  assert.equal((await call(2, 'POST', { action: 'create', name: 'denied', password: 'x' })).response.status, 403)
  assert.equal((await adminManagementApi(new Request('https://admin-management.test/api/admin-management'))).status, 401)
  const wrongOrigin = new Request('https://admin-management.test/api/admin-management', { method: 'POST', headers: { cookie: `tg_platform_session=${tokens.get(1)}`, origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', name: 'bad-origin', password: 'x' }) })
  assert.equal((await adminManagementApi(wrongOrigin)).status, 403)
  assert.equal((await call(1, 'POST', { action: 'set-status', id: 1, enabled: false })).response.status, 400)
  assert.equal((await call(1, 'POST', { action: 'delete', id: 1 })).response.status, 400)
  const lastSuper = await call(1, 'POST', { action: 'set-status', id: 3, enabled: false })
  assert.equal(lastSuper.response.status, 400)
  const demote = await call(1, 'POST', { action: 'update', id: 3, name: 'protected-super', password: '', whiteIp: '', roleIds: [2] })
  assert.equal(demote.response.status, 400)
  const deleteSuper = await call(1, 'POST', { action: 'delete', id: 3 })
  assert.equal(deleteSuper.response.status, 400)
  assert.equal((await setup.query('SELECT status FROM t_admin WHERE id=3')).rows[0].status, 1)
 })
} finally {
 await setup.end()
}
