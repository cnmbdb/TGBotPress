import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_BINDASENDN_TEST_DB_URL, parsed=raw?new URL(raw):null, ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_BINDASENDN_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_bindasendn_test_')||!parsed.pathname.slice(1).startsWith('tg_bindasendn_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://bindasendn.test'})
const pool=new pg.Pool({connectionString:raw})
for(const sql of [
'CREATE TABLE t_admin(id bigint PRIMARY KEY,name text,password text,status smallint DEFAULT 1)',
'CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,session_hash char(64),login_time timestamp,last_seen_at timestamp,expires_at timestamp,revoked_at timestamp)',
'CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint,device_session_id bigint,expires_at timestamp)',
'CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key text,config_val text)',
"CREATE TABLE t_roles(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web')",
"CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web',route text,pid int)",
'CREATE TABLE t_model_has_roles(role_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_model_has_permissions(permission_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint)',
'CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint,action text,resource_id bigint)',
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text,bot_token text)',
'CREATE TABLE t_energy_platform_bot(rid int PRIMARY KEY,bot_rid int,receive_wallet text)',
"CREATE TABLE t_bind_a_send_n_config(rid serial PRIMARY KEY,bot_rid int,is_enable smallint DEFAULT 1 NOT NULL,energy_per_send int DEFAULT 65000 NOT NULL,activate_threshold numeric(14,2) DEFAULT 0 NOT NULL,daily_limit int DEFAULT 9999 NOT NULL,monthly_limit int DEFAULT 9999 NOT NULL,n_addr_daily_limit int DEFAULT 9999 NOT NULL,audit_threshold numeric(14,2) DEFAULT 0 NOT NULL,audit_enabled smallint DEFAULT 0 NOT NULL,whitelist text,blacklist text,retry_count smallint DEFAULT 3 NOT NULL,energy_platform_bot_rid int,create_by int NOT NULL,create_time timestamp NOT NULL,update_by int,update_time timestamp)",
"CREATE TABLE t_bind_a_send_n_binding(rid serial PRIMARY KEY,bot_rid int NOT NULL,tg_uid bigint NOT NULL,wallet_addr varchar(100) NOT NULL,status smallint DEFAULT 0 NOT NULL,activate_threshold numeric(14,2) DEFAULT 0,activate_time timestamp,activated_by int,unbind_time timestamp,unbind_by int,unbind_reason varchar(500),create_by int NOT NULL,create_time timestamp NOT NULL,update_by int,update_time timestamp)",
"CREATE TABLE t_bind_a_send_n_grant(rid serial PRIMARY KEY,binding_rid int NOT NULL,bot_rid int NOT NULL,tg_uid bigint NOT NULL,a_addr varchar(100) NOT NULL,n_addr varchar(100) NOT NULL,tx_hash varchar(200) NOT NULL,energy_amount int NOT NULL,grant_status smallint DEFAULT 0 NOT NULL,audit_status smallint DEFAULT 0 NOT NULL,retry_count smallint DEFAULT 0 NOT NULL,fail_reason varchar(500),grant_time timestamp,update_time timestamp,create_time timestamp)",
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'bindasendn-admin','x'),(2,'bindasendn-no-permission','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day')",[digest(token),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'绑A送N',NULL,1),(3,'激活绑A送N','admin.energy.bindasendn.bindingActivate',2),(4,'解绑绑A送N','admin.energy.bindasendn.bindingUnbind',2),(5,'重试绑A送N发放','admin.energy.bindasendn.grantRetry',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Bot Eight','bot_eight','must-not-leak'),(9,'Bot Nine','bot_nine','other-secret')")
await pool.query("INSERT INTO t_energy_platform_bot(rid,bot_rid,receive_wallet) VALUES(71,8,'receive-wallet-8'),(72,9,'receive-wallet-9')")
await pool.query("INSERT INTO t_bind_a_send_n_config(rid,bot_rid,is_enable,energy_per_send,activate_threshold,daily_limit,monthly_limit,n_addr_daily_limit,audit_threshold,audit_enabled,whitelist,blacklist,retry_count,energy_platform_bot_rid,create_by,create_time) VALUES(5,NULL,1,65000,12.50,8,30,4,99.00,1,'allowed','blocked',3,71,1,now())")
await pool.query("INSERT INTO t_bind_a_send_n_binding(rid,bot_rid,tg_uid,wallet_addr,status,activate_threshold,create_by,create_time) VALUES(1,8,12345,'wallet-A',0,12.50,1,now()),(2,9,67890,'wallet-B',1,25,1,now()),(3,8,77777,'wallet-C',2,0,1,now())")
await pool.query("INSERT INTO t_bind_a_send_n_grant(rid,binding_rid,bot_rid,tg_uid,a_addr,n_addr,tx_hash,energy_amount,grant_status,audit_status,retry_count,fail_reason,grant_time,create_time) VALUES(11,1,8,12345,'a-address-1','n-address-1','tx-failed',65000,2,0,4,'network error',now(),now()),(12,2,9,67890,'a-address-2','n-address-2','tx-pending',32000,0,1,0,NULL,now(),now()),(13,3,8,77777,'a-address-3','n-address-3','tx-success',131000,1,2,0,NULL,now(),now()),(14,1,8,12345,'a-address-4','n-address-4','tx-review',65000,0,1,0,NULL,now(),now())")
const {bindASendNApi}=await import('./bindasendn-api.server')
async function call(method='GET',query='',body?:unknown,session=token,origin='https://bindasendn.test'){
 const headers:Record<string,string>={cookie:'tg_platform_session='+session};let requestBody:BodyInit|undefined
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}
 const response=await bindASendNApi(new Request('https://bindasendn.test/api/bindasendn'+query,{method,headers,body:requestBody}))
 return{response,data:await response.json() as Record<string,any>}
}
const config={action:'configSave',is_enable:false,energy_per_send:32000,activate_threshold:'55.50',daily_limit:5,monthly_limit:15,n_addr_daily_limit:2,audit_enabled:true,audit_threshold:'100.25',whitelist:'wallet-1',blacklist:'wallet-2',retry_count:6,energy_platform_bot_rid:72}
try{
 await test('绑A送N配置、实例选择、绑定/发放列表与鉴权',async()=>{
  const c=await call();assert.equal(c.response.status,200);assert.equal(c.data.config.energy_per_send,65000);assert.equal(c.data.config.energy_platform_bot_rid,71)
  assert.deepEqual(c.data.bots.map((b:any)=>b.rid),[9,8]);assert.equal(JSON.stringify(c.data).includes('must-not-leak'),false);assert.equal(c.data.instances[0].receive_wallet,'receive-wallet-9')
  const b=await call('GET','?view=bindings&page=1&pageSize=10');assert.equal(b.response.status,200);assert.equal(b.data.total,3);assert.equal(b.data.rows[0].status_label,'已解绑');assert.equal(b.data.canActivate,true);assert.equal(b.data.canUnbind,true)
  assert.equal((await call('GET','?view=bindings&tg_uid=12345')).data.total,1);assert.equal((await call('GET','?view=bindings&wallet_addr=wallet-B&bot_rid=9&status=1')).data.total,1);assert.equal((await call('GET','?view=bindings&pageSize=20')).data.pageSize,20)
  const g=await call('GET','?view=grants&bot_rid=8&status=2&a_addr=a-address&date_start=2000-01-01&date_end=2099-12-31');assert.equal(g.response.status,200);assert.equal(g.data.total,1);assert.equal(g.data.rows[0].grant_status_label,'失败');assert.equal(g.data.canRetry,true);assert.equal(g.data.canReview,true)
  assert.equal((await call('GET','?view=grants&n_addr=n-address-2&tx_hash=tx-pending')).data.total,1);assert.equal((await call('GET','?view=unknown')).response.status,400)
  assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,'')).response.status,401)
 })
 await test('配置保存、绑定操作、审核重试、来源校验与审计',async()=>{
  assert.equal((await call('POST','',config,token,'https://attacker.invalid')).response.status,403)
  assert.equal((await call('POST','',{...config,energy_platform_bot_rid:999})).response.status,404)
  assert.equal((await call('POST','',{...config,energy_per_send:-1})).response.status,400)
  assert.equal((await call('POST','',config)).response.status,200)
  const saved=(await pool.query('SELECT * FROM t_bind_a_send_n_config WHERE rid=5')).rows[0]
  assert.equal(Number(saved.is_enable),0);assert.equal(Number(saved.energy_per_send),32000);assert.equal(String(saved.activate_threshold),'55.50');assert.equal(Number(saved.energy_platform_bot_rid),72)
  assert.equal((await call('POST','',{action:'bindingActivate',rid:1},deniedToken)).response.status,403)
  assert.equal((await call('POST','',{action:'bindingActivate',rid:1})).response.status,200)
  assert.equal(Number((await pool.query('SELECT status FROM t_bind_a_send_n_binding WHERE rid=1')).rows[0].status),1)
  assert.equal((await call('POST','',{action:'bindingUnbind',rid:2,reason:'manual review'})).response.status,200)
  assert.equal((await pool.query('SELECT unbind_reason FROM t_bind_a_send_n_binding WHERE rid=2')).rows[0].unbind_reason,'manual review')
  assert.equal((await call('POST','',{action:'bindingUnbind',rid:2})).response.status,409)
  assert.equal((await call('POST','',{action:'grantApprove',rid:12})).response.status,200)
  let grant=(await pool.query('SELECT audit_status,grant_status,retry_count FROM t_bind_a_send_n_grant WHERE rid=12')).rows[0]
  assert.deepEqual([Number(grant.audit_status),Number(grant.grant_status),Number(grant.retry_count)],[2,0,0])
  assert.equal((await call('POST','',{action:'grantReject',rid:14})).response.status,200)
  grant=(await pool.query('SELECT audit_status,grant_status,fail_reason FROM t_bind_a_send_n_grant WHERE rid=14')).rows[0]
  assert.deepEqual([Number(grant.audit_status),Number(grant.grant_status),grant.fail_reason],[3,2,'管理员拒绝审核'])
  assert.equal((await call('POST','',{action:'grantRetry',rid:11})).response.status,200)
  grant=(await pool.query('SELECT audit_status,grant_status,retry_count,fail_reason FROM t_bind_a_send_n_grant WHERE rid=11')).rows[0]
  assert.deepEqual([Number(grant.audit_status),Number(grant.grant_status),Number(grant.retry_count),grant.fail_reason],[0,0,0,null])
  const actions=(await pool.query('SELECT action FROM t_platform_audit_log ORDER BY rid')).rows.map(r=>r.action)
  assert.deepEqual(actions,['energy.bindasendn.config.update','energy.bindasendn.binding.activate','energy.bindasendn.binding.unbind','energy.bindasendn.grant.approve','energy.bindasendn.grant.reject','energy.bindasendn.grant.retry'])
  await pool.query('DELETE FROM t_bind_a_send_n_config')
  assert.equal((await call('POST','',config)).response.status,200)
  const inserted=(await pool.query('SELECT create_by,update_by,energy_per_send FROM t_bind_a_send_n_config WHERE bot_rid IS NULL')).rows[0]
  assert.deepEqual([Number(inserted.create_by),Number(inserted.update_by),Number(inserted.energy_per_send)],[1,1,32000])
  assert.equal((await call('GET','?view=bindings&status=4')).response.status,400)
 })
}finally{await pool.end()}
