import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import pg from 'pg'
const connectionString = process.env.TG_TEST_DB_URL
if (!connectionString || new URL(connectionString).hostname !== 'tg-native-test-pg') throw new Error('Integration tests require disposable tg-native-test-pg')
const schema = 'groups_' + randomUUID().replaceAll('-', '')
const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema + ' -c timezone=Asia/Shanghai', max: 5 })
;(globalThis as typeof globalThis & { platformPool?: pg.Pool }).platformPool = pool
process.env.PLATFORM_ORIGIN = 'http://localhost:8083'
process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
const token = randomBytes(32).toString('hex')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
await pool.query('CREATE SCHEMA ' + schema)
await pool.query(`
 CREATE TABLE t_admin(id bigserial PRIMARY KEY,name text,status int);
 CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,revoked_at timestamptz,expires_at timestamptz);
 CREATE TABLE t_platform_session(token_hash text,admin_id bigint,device_session_id bigint,expires_at timestamptz);
 CREATE TABLE t_sys_config(config_key text,config_val jsonb);
 CREATE TABLE t_platform_cloudflare_security(rid bigint PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE t_roles(id bigserial PRIMARY KEY,name text,guard_name text);
 CREATE TABLE t_model_has_roles(role_id bigint,model_type text,model_id bigint);
 CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name text,route text,guard_name text);
 CREATE TABLE t_model_has_permissions(permission_id bigint,model_type text,model_id bigint);
 CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint);
 CREATE TABLE t_telegram_bot(rid bigserial PRIMARY KEY,bot_firstname text,bot_username text,bot_token text);
 CREATE TABLE t_telegram_bot_group(rid bigserial PRIMARY KEY,bot_rid bigint,group_type text,tg_groupid bigint,tg_groupusername text,tg_groupnickname text,status int,is_admin text,first_time timestamptz,last_time timestamptz,stop_time timestamptz,follow_count int);
 CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint,action text,resource_id bigint);
 INSERT INTO t_admin(id,name,status) VALUES(1,'Fixture Admin',1),(2,'Leaf Only',1);
 INSERT INTO t_admin_device_session(rid,admin_id,expires_at) VALUES(11,1,now()+interval '1 hour'),(12,2,now()+interval '1 hour');
 INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES('${digest(token)}',1,11,now()+interval '1 hour');
 INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{"auth_code":"fixture"}');
 INSERT INTO t_roles(id,name,guard_name) VALUES(1,'超级管理员','web'),(2,'leaf-only','web');
 INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,$$App\\Models\\Admin\\Admin$$,1),(2,$$App\\Models\\Admin\\Admin$$,2);
 INSERT INTO t_permissions(id,name,route,guard_name) VALUES(1,'群组列表','admin.groupuser.group.index','web'),(2,'发送消息','admin.groupuser.group.sendmessage','web'),(3,'删除群组','admin.groupuser.group.delete','web'),(4,'群组用户','admin.groupuser.group.index','web');
 INSERT INTO t_role_has_permissions(permission_id,role_id) VALUES(1,2);
 INSERT INTO t_model_has_permissions(permission_id,model_type,model_id) VALUES(1,$$App\\Models\\Admin\\Admin$$,1),(2,$$App\\Models\\Admin\\Admin$$,1),(3,$$App\\Models\\Admin\\Admin$$,1),(4,$$App\\Models\\Admin\\Admin$$,1),(1,$$App\\Models\\Admin\\Admin$$,2);
 INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(1,'Fixture Bot','fixture_bot','123456:fixture');
 INSERT INTO t_telegram_bot_group(rid,bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,is_admin,first_time,last_time,follow_count)
 VALUES(101,1,'supergroup',-1001234567890,'fixture_group','Fixture Group',1,'Y',now()-interval '2 days',now(),9);
`)
const { groupApi } = await import('./group-api.server')
const request = (url: string, init?: RequestInit) => new Request('http://localhost:8083' + url, { ...init, headers: { cookie: 'tg_platform_session=' + token, ...(init?.headers || {}) } })
try {
 await test('group list search, bot options, and pagination use native API', async () => {
  const response = await groupApi(request('/api/groups?page=1&pageSize=10&search=%40fixture_group&botRid=1'))
  assert.equal(response.status, 200, await response.clone().text())
  const data = await response.json() as { rows: Array<{ rid: number; tg_groupid: string; status_label: string }>; total: number }
  assert.equal(data.total, 1)
  assert.equal(data.rows[0].rid, '101')
  assert.equal(data.rows[0].tg_groupid, '-1001234567890')
  assert.equal(data.rows[0].status_label, '使用中')
  const options = await groupApi(request('/api/groups?action=options'))
  assert.equal(((await options.json()) as { bots: Array<{ rid: number }> }).bots.length, 1)
 })
 await test('send and delete require action grants, audit changes, and use only a fake Telegram transport', async () => {
  const previousFetch = globalThis.fetch
  let called = false
  const limitedToken = randomBytes(32).toString('hex')
  await pool.query("INSERT INTO t_admin(id,name,status) VALUES(3,'Read Only',1)")
  await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,expires_at) VALUES(13,3,now()+interval '1 hour')")
  await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,3,13,now()+interval '1 hour')", [digest(limitedToken)])
  await pool.query("INSERT INTO t_model_has_permissions(permission_id,model_type,model_id) VALUES(1,$$App\\Models\\Admin\\Admin$$,3),(4,$$App\\Models\\Admin\\Admin$$,3)")
  try {
   globalThis.fetch = async () => { called = true; throw new Error('unexpected network request') }
   const disabledSend = await groupApi(request('/api/groups', { method: 'POST', headers: { origin: process.env.PLATFORM_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sendmessage', rid: 101, message: 'fixture' }) }))
   assert.equal(disabledSend.status, 409)
   assert.equal(called, false)
   const limitedDelete = await groupApi(new Request('http://localhost:8083/api/groups', { method: 'POST', headers: { cookie: 'tg_platform_session=' + limitedToken, origin: process.env.PLATFORM_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', rid: 101 }) }))
   assert.equal(limitedDelete.status, 403)
   process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
   globalThis.fetch = async (input, init) => {
    called = true
    assert.equal(String(input), 'https://api.telegram.org/bot123456:fixture/sendMessage')
    assert.deepEqual(JSON.parse(String(init?.body)), { chat_id: '-1001234567890', text: 'fixture', parse_mode: 'HTML' })
    return Response.json({ ok: true, result: { message_id: 99 } })
   }
   const sent = await groupApi(request('/api/groups', { method: 'POST', headers: { origin: process.env.PLATFORM_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sendmessage', rid: 101, message: 'fixture' }) }))
   assert.equal(sent.status, 200)
   assert.equal(called, true)
   assert.equal((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='groupuser.group.send_message'")).rows[0].n, 1)
   process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
   const deleted = await groupApi(request('/api/groups', { method: 'POST', headers: { origin: process.env.PLATFORM_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', rid: 101 }) }))
   assert.equal(deleted.status, 200)
   assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot_group')).rows[0].n, 0)
   assert.equal((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='groupuser.group.delete'")).rows[0].n, 1)
  } finally { process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'; globalThis.fetch = previousFetch }
 })
 await test('leaf-only permission cannot bypass parent group navigation permission', async () => {
  const leafToken = randomBytes(32).toString('hex')
  await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,2,12,now()+interval '1 hour')", [digest(leafToken)])
  const response = await groupApi(new Request('http://localhost:8083/api/groups', { headers: { cookie: 'tg_platform_session=' + leafToken } }))
  assert.equal(response.status, 403)
 })
} finally {
 await pool.query('DROP SCHEMA ' + schema + ' CASCADE')
 await pool.end()
}
