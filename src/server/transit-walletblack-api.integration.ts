import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw = process.env.TG_TRANSIT_BLACK_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
const parts = parsed?.hostname.split('.').map(Number)
const privateHost = parsed?.hostname === 'postgres' || (process.env.TG_TRANSIT_BLACK_TEST_ALLOW_PRIVATE_DB === '1' && parts?.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)))
if (!raw || !parsed || !privateHost || !parsed.username.startsWith('tg_transit_black_test_') || !parsed.pathname.slice(1).startsWith('tg_transit_black_test_')) throw new Error('Transit blacklist integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST = parsed.hostname
process.env.DB_PORT = parsed.port || '5432'
process.env.DB_DATABASE = parsed.pathname.slice(1)
process.env.DB_USERNAME = parsed.username
process.env.DB_PASSWORD = parsed.password
process.env.PLATFORM_ORIGIN = 'https://transit-black.test'
const setup = new pg.Pool({ connectionString: raw, max: 4 })
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp)")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,action varchar(100) NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation',json_build_object('auth_code','fixture')::text)")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'black-admin','fixture'),(2,'black-reader','fixture'),(3,'other-transit-page','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens = new Map<number,string>()
for (const [admin,device] of [[1,11],[2,12],[3,13]] as const) { const token=randomBytes(32).toString('hex'); tokens.set(admin,token); await setup.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",[digest(token),admin,device]) }
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'完整黑名单权限'),(2,'黑名单只读'),(3,'其他闪兑页面')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'闪兑管理',NULL,0),(2,'闪兑黑钱包','admin.transit.walletblack.index',1),(3,'添加黑钱包','admin.transit.walletblack.add',2),(4,'修改黑钱包地址','admin.transit.walletblack.update',2),(5,'删除黑钱包地址','admin.transit.walletblack.delete',2),(6,'闪兑钱包','admin.transit.wallet.index',1)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(1,4),(1,5),(2,1),(2,2),(3,1),(3,6)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query('CREATE TABLE t_transit_wallet_black(rid serial PRIMARY KEY,chain_type varchar(10) NOT NULL,black_wallet varchar(200) NOT NULL,comments varchar(255),create_time timestamp,update_time timestamp)')
await setup.query("INSERT INTO t_transit_wallet_black(rid,chain_type,black_wallet,comments,create_time) VALUES(1,'trc','black-one','seeded',timestamp '2026-10-01 10:00:00')")
await setup.query("SELECT setval(pg_get_serial_sequence('t_transit_wallet_black','rid'),1)")
const { transitWalletBlackApi } = await import('./transit-walletblack-api.server')
function request(admin:number,method='GET',query='',body?:unknown,origin='https://transit-black.test',contentType='application/json') {
  return new Request('https://transit-black.test/api/transit-walletblack'+query,{method,headers:{cookie:'tg_platform_session='+tokens.get(admin),...(method==='POST'?{origin,'content-type':contentType}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function call(admin:number,method='GET',query='',body?:unknown,origin?:string,contentType?:string) {
  const response=await transitWalletBlackApi(request(admin,method,query,body,origin,contentType))
  return {response,data:await response.json() as Record<string,any>}
}
try {
  await test('blacklist listing searches, paginates, requires page access and exposes per-action grants',async()=>{
    const all=await call(1)
    assert.equal(all.response.status,200);assert.equal(all.data.total,1);assert.equal(all.data.rows[0].black_wallet,'black-one')
    assert.equal(all.data.canAdd,true);assert.equal(all.data.canEdit,true);assert.equal(all.data.canDelete,true)
    assert.equal((await call(1,'GET','?search=black-one')).data.total,1)
    assert.equal((await call(1,'GET','?search=not-found')).data.total,0)
    const reader=await call(2)
    assert.equal(reader.response.status,200);assert.equal(reader.data.canAdd,false);assert.equal(reader.data.canEdit,false);assert.equal(reader.data.canDelete,false)
    assert.equal((await call(3)).response.status,403)
  })
  await test('blacklist create, duplicate checks, update, delete and audit are atomic',async()=>{
    const base={chain_type:'trc',black_wallet:'black-two',comments:'created'}
    assert.equal((await call(1,'POST','',{action:'create',...base})).response.status,200)
    assert.equal((await call(1,'POST','',{action:'create',...base})).response.status,409)
    assert.equal((await call(1,'POST','',{action:'create',...base,black_wallet:'black-three'})).response.status,200)
    assert.equal((await call(1,'POST','',{action:'update',rid:3,chain_type:'trc',black_wallet:'black-updated',comments:'updated'})).response.status,200)
    assert.equal((await call(1,'POST','',{action:'update',rid:3,chain_type:'trc',black_wallet:'black-one',comments:'duplicate'})).response.status,409)
    assert.equal((await call(1,'POST','',{action:'update',rid:999,chain_type:'trc',black_wallet:'black-missing',comments:''})).response.status,404)
    assert.equal((await call(2,'POST','',{action:'create',...base})).response.status,403)
    assert.equal((await call(1,'POST','',{action:'delete',rid:3},'https://attacker.test')).response.status,403)
    assert.equal((await call(1,'POST','',{action:'delete',rid:3},'https://transit-black.test','text/plain')).response.status,403)
    assert.equal((await call(1,'POST','',{action:'delete',rid:3})).response.status,200)
    assert.equal((await call(1,'POST','',{action:'delete',rid:3})).response.status,404)
    assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'transit.walletblack.%'")).rows[0].n),4)
    assert.equal((await call(1,'PUT')).response.status,405)
  })
} finally { await setup.end() }
