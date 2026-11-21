import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw = process.env.TG_SYSTEM_ACCESS_TEST_DB_URL
const dbUrl = raw ? new URL(raw) : null
const privateIPv4 = dbUrl?.hostname.split('.').map(Number)
const privateHost = dbUrl?.hostname === 'postgres' || (process.env.TG_SYSTEM_ACCESS_TEST_ALLOW_PRIVATE_DB === '1' && privateIPv4?.length === 4 && (privateIPv4[0] === 10 || (privateIPv4[0] === 172 && privateIPv4[1] >= 16 && privateIPv4[1] <= 31) || (privateIPv4[0] === 192 && privateIPv4[1] === 168)))
if (!raw || !dbUrl || !privateHost || !dbUrl.username.startsWith('system_access_test_') || !dbUrl.pathname.slice(1).startsWith('system_access_test_')) {
  throw new Error('System access integration requires a disposable sandbox PostgreSQL database and role')
}
process.env.DB_HOST = dbUrl.hostname
process.env.DB_PORT = dbUrl.port || '5432'
process.env.DB_DATABASE = dbUrl.pathname.slice(1)
process.env.DB_USERNAME = dbUrl.username
process.env.DB_PASSWORD = dbUrl.password
process.env.PLATFORM_ORIGIN = 'https://system-access.test'

const setup = new pg.Pool({ connectionString: raw, max: 4 })
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'role-admin','fixture'),(2,'permission-admin','fixture'),(3,'role-reader','fixture'),(4,'permission-read-only','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day'),(14,4,repeat('d',64),now(),now(),now()+interval '1 day')")
const userTokens = new Map<number, string>()
for (const [id, device] of [[1,11],[2,12],[3,13],[4,14]] as const) {
  const value = randomBytes(32).toString('hex')
  userTokens.set(id, value)
  await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')', [digest(value), id, device])
}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'角色管理员'),(2,'权限管理员'),(3,'角色只读'),(4,'超级管理员'),(5,'权限只读')")
await setup.query("SELECT setval(pg_get_serial_sequence('t_roles','id'),(SELECT max(id) FROM t_roles))")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES (1,'系统管理',NULL,0),(2,'角色管理','admin.system.role.index',1),(3,'添加角色','admin.system.role.add',2),(4,'修改角色名称','admin.system.role.update',2),(5,'删除角色','admin.system.role.del',2),(6,'编辑角色权限','admin.system.role.show_permissions',2),(10,'权限管理','admin.system.permission.index',1),(11,'添加权限','admin.system.permission.add',10),(12,'修改权限','admin.system.permission.update',10),(13,'删除权限','admin.system.permission.del',10),(99,'机器人列表','admin.telegram.telegrambot.index',0)")
await setup.query("SELECT setval(pg_get_serial_sequence('t_permissions','id'),(SELECT max(id) FROM t_permissions))")
await setup.query("INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(2,1),(2,10),(2,11),(2,12),(2,13),(3,1),(3,2),(5,1),(5,10)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3),(5,'App\\Models\\Admin\\Admin',4)")

const { systemAccessApi } = await import('./system-access-api.server')
function request(adminId: number, path: string, method = 'GET', body?: unknown) {
  const token = userTokens.get(adminId)
  return new Request('https://system-access.test/api/system-access' + path, {
    method,
    headers: { cookie: 'tg_platform_session=' + token, origin: 'https://system-access.test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function call(adminId: number, path: string, method = 'GET', body?: unknown) {
  const response = await systemAccessApi(request(adminId, path, method, body))
  return { response, data: await response.json() as Record<string, any> }
}

try {
 await test('permission page access alone cannot add, update, or delete permission routes', async () => {
  const add = await call(4, '', 'POST', { action: 'permission-add', context: '未授权权限', parentId: 0, route: '' })
  assert.equal(add.response.status, 403)
  const update = await call(4, '', 'POST', { action: 'permission-update', nodeId: 99, context: '机器人列表改名', route: 'admin.telegram.telegrambot.index' })
  assert.equal(update.response.status, 403)
  const remove = await call(4, '', 'POST', { action: 'permission-delete', nodeId: 99 })
  assert.equal(remove.response.status, 403)
 })
 
 await test('permission tree supports authenticated add, update, leaf deletion, and parent protection', async () => {
  const tree = await call(2, '?action=permission-tree')
  assert.equal(tree.response.status, 200)
  assert.ok(Array.isArray(tree.data.tree))
  const added = await call(2, '', 'POST', { action: 'permission-add', context: '临时系统功能', parentId: 0, route: '' })
  assert.equal(added.response.status, 200)
  const rootId = Number(added.data.id)
  const child = await call(2, '', 'POST', { action: 'permission-add', context: '临时操作', parentId: rootId, route: 'admin.fixture.action' })
  assert.equal(child.response.status, 200)
  const protectedDelete = await call(2, '', 'POST', { action: 'permission-delete', nodeId: rootId })
  assert.equal(protectedDelete.response.status, 409)
  const updated = await call(2, '', 'POST', { action: 'permission-update', nodeId: Number(child.data.id), context: '临时操作已更新', route: 'admin.fixture.action.updated' })
  assert.equal(updated.response.status, 200)
  const removedChild = await call(2, '', 'POST', { action: 'permission-delete', nodeId: Number(child.data.id) })
  assert.equal(removedChild.response.status, 200)
  const removedRoot = await call(2, '', 'POST', { action: 'permission-delete', nodeId: rootId })
  assert.equal(removedRoot.response.status, 200)
 })

 await test('role management supports list, create, rename, permission assignment, and delete', async () => {
  const listed = await call(1, '?action=roles&page=1&pageSize=20')
  assert.equal(listed.response.status, 200)
  assert.deepEqual(listed.data.permissions, { create: true, update: true, delete: true, assign: true })
  const created = await call(1, '', 'POST', { action: 'role-add', name: '临时审查员' })
  assert.equal(created.response.status, 200)
  const roleId = Number(created.data.id)
  const duplicate = await call(1, '', 'POST', { action: 'role-add', name: '临时审查员' })
  assert.equal(duplicate.response.status, 409)
  const renamed = await call(1, '', 'POST', { action: 'role-update', id: roleId, name: '临时审查员已更新' })
  assert.equal(renamed.response.status, 200)
  const permissionData = await call(1, '?action=role-permissions&id=' + roleId)
  assert.equal(permissionData.response.status, 200)
  const changed = await call(1, '', 'POST', { action: 'role-change-permissions', id: roleId, permissionIds: [99] })
  assert.equal(changed.response.status, 200)
  const checked = await call(1, '?action=role-permissions&id=' + roleId)
  const robotPermission = checked.data.tree.find((node: any) => node.id === '99')
  assert.equal(robotPermission?.checked, true)
  const removed = await call(1, '', 'POST', { action: 'role-delete', id: roleId })
  assert.equal(removed.response.status, 200)
  assert.equal((await call(1, '', 'POST', { action: 'role-update', id: 4, name: '受保护角色' })).response.status, 403)
  assert.equal((await call(1, '', 'POST', { action: 'role-delete', id: 4 })).response.status, 403)
  assert.equal((await call(1, '', 'POST', { action: 'role-change-permissions', id: 4, permissionIds: [99] })).response.status, 403)
 })

 await test('page permissions and role action permissions are enforced server-side', async () => {
  const rolePage = await call(3, '?action=roles')
  assert.equal(rolePage.response.status, 200)
  assert.deepEqual(rolePage.data.permissions, { create: false, update: false, delete: false, assign: false })
  assert.equal((await call(3, '', 'POST', { action: 'role-add', name: 'forbidden' })).response.status, 403)
  assert.equal((await call(3, '', 'POST', { action: 'role-change-permissions', id: 1, permissionIds: [99] })).response.status, 403)
  assert.equal((await call(1, '?action=permission-tree')).response.status, 403)
  assert.equal((await systemAccessApi(new Request('https://system-access.test/api/system-access?action=roles'))).status, 401)
 })
} finally {
 await setup.end()
}
