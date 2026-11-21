import {test} from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_PREMIUM_PLATFORM_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_PREMIUM_PLATFORM_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_premium_platform_test_')||!parsed.pathname.slice(1).startsWith('tg_premium_platform_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
const pair=generateKeyPairSync('rsa',{modulusLength:2048})
process.env.TRON_RSA_PUBLIC_KEY=pair.publicKey.export({type:'spki',format:'pem'}).toString();delete process.env.TRON_RSA_PUBLIC_KEY_PATH
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://premium-platform.test'})
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
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text,bot_token text,recharge_wallet_addr text)',
'CREATE TABLE t_energy_platform_bot(rid int PRIMARY KEY,receive_wallet text)',
'CREATE TABLE t_transit_wallet(rid int PRIMARY KEY,receive_wallet text)',
"CREATE TABLE t_premium_platform(rid serial PRIMARY KEY,bot_rid int NOT NULL,platform_name smallint NOT NULL,tg_admin_uid varchar(500),platform_hash varchar(500),platform_cookie varchar(3000),platform_phrase varchar(3000),status smallint DEFAULT 1 NOT NULL,receive_wallet varchar(100),get_tx_time timestamp,tg_notice_obj_receive varchar(200),tg_notice_obj_send varchar(200),comments varchar(255),create_time timestamp NOT NULL,update_time timestamp)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'premium-platform-admin','x'),(2,'premium-platform-no-permission','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day')",[digest(token),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'会员管理',NULL,0),(2,'会员平台',NULL,1),(3,'添加会员平台','admin.premium.platform.add',2),(4,'修改会员平台','admin.premium.platform.update',2),(5,'删除会员平台','admin.premium.platform.delete',2),(6,'修改cookie','admin.premium.platform.updateapikey',2),(7,'修改助记词','admin.premium.platform.updatephrase',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token,recharge_wallet_addr) VALUES(8,'Bot Eight','bot_eight','do-not-return','recharge-wallet-8'),(9,'Bot Nine','bot_nine','secret-two','recharge-wallet-9')")
await pool.query("INSERT INTO t_energy_platform_bot(rid,receive_wallet) VALUES(70,'energy-wallet')")
await pool.query("INSERT INTO t_transit_wallet(rid,receive_wallet) VALUES(80,'transit-wallet')")
await pool.query("INSERT INTO t_premium_platform(rid,bot_rid,platform_name,tg_admin_uid,platform_hash,platform_cookie,platform_phrase,status,receive_wallet,create_time) VALUES(1,8,1,'uid-8','hash-one','v2:encrypted-cookie','v2:encrypted-phrase',1,'premium-wallet-1',now()),(2,9,1,'uid-9','hash-two','','',1,'premium-wallet-2',now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_premium_platform','rid'),2,true)")
const {premiumPlatformApi}=await import('./premium-platform-api.server')
async function call(method='GET',query='',body?:unknown,session=token,origin='https://premium-platform.test'){
 const headers:Record<string,string>={cookie:'tg_platform_session='+session};let requestBody:BodyInit|undefined
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}
 const response=await premiumPlatformApi(new Request('https://premium-platform.test/api/premium-platforms'+query,{method,headers,body:requestBody}))
 return{response,data:await response.json() as Record<string,any>}
}
const base={bot_rid:8,platform_name:2,tg_admin_uid:'admin-8',platform_hash:'hash-new',platform_cookie:'cookie secret created',tg_notice_obj_receive:'receive-notice',tg_notice_obj_send:'success-notice',receive_wallet:'new-wallet',get_tx_time:'2026-10-01 12:30',comments:'API service'}
const editable={bot_rid:base.bot_rid,platform_name:base.platform_name,tg_admin_uid:base.tg_admin_uid,platform_hash:base.platform_hash,tg_notice_obj_receive:base.tg_notice_obj_receive,tg_notice_obj_send:base.tg_notice_obj_send,receive_wallet:base.receive_wallet,get_tx_time:base.get_tx_time,comments:base.comments}
try{
 await test('会员平台类型选择、搜索分页、密钥脱敏和功能权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].platform_name,1)
  const seeded=list.data.rows.find((row:any)=>row.rid===1);assert.equal(seeded.cookie_configured,true);assert.equal(seeded.phrase_configured,true)
  assert.equal(JSON.stringify(list.data).includes('encrypted-cookie'),false);assert.equal(JSON.stringify(list.data).includes('do-not-return'),false)
  assert.equal((await call('GET','?search=uid-9')).data.total,1);assert.equal((await call('GET','?search=hash-two&pageSize=10')).data.pageSize,10)
  const options=await call('GET','?action=options');assert.deepEqual(options.data.bots.map((b:any)=>b.rid),[9,8])
  assert.equal(list.data.canAdd,true);assert.equal(list.data.canEdit,true);assert.equal(list.data.canCookie,true);assert.equal(list.data.canPhrase,true);assert.equal(list.data.canStatus,true);assert.equal(list.data.canDelete,true)
  assert.equal((await call('GET','',undefined,deniedToken)).response.status,403)
 })
 await test('创建和编辑两种平台类型、密钥加密、状态、删除、来源校验与审计',async()=>{
  assert.equal((await call('POST','',{action:'create',...base},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'create',...base,bot_rid:999})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...base,receive_wallet:'energy-wallet'})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...base})).response.status,200)
  const created=(await pool.query("SELECT rid,platform_name,platform_cookie,platform_phrase,receive_wallet,get_tx_time FROM t_premium_platform WHERE platform_hash='hash-new'")).rows[0]
  assert.equal(Number(created.platform_name),2);assert.equal(String(created.platform_cookie).startsWith('v2:'),true);assert.equal(created.platform_cookie.includes('cookie secret created'),false);assert.equal(created.platform_phrase,null);assert.equal(created.receive_wallet,'new-wallet')
  assert.equal((await call('POST','',{action:'create',...base})).response.status,409)
  assert.equal((await call('POST','',{action:'update',rid:2,...editable,bot_rid:8,platform_hash:'hash-other'})).response.status,409)
  assert.equal((await call('POST','',{action:'update',rid:2,...editable,bot_rid:9,platform_name:2,platform_hash:'hash-two-updated'})).response.status,200)
  assert.equal(Number((await pool.query('SELECT platform_name FROM t_premium_platform WHERE rid=2')).rows[0].platform_name),2)
  assert.equal((await call('POST','',{action:'cookie',rid:1,value:'cookie secret update'})).response.status,200)
  assert.equal((await call('POST','',{action:'phrase',rid:1,value:'twelve word phrase fixture'})).response.status,200)
  const secrets=(await pool.query('SELECT platform_cookie,platform_phrase FROM t_premium_platform WHERE rid=1')).rows[0]
  assert.equal(secrets.platform_cookie.startsWith('v2:'),true);assert.equal(secrets.platform_phrase.startsWith('v2:'),true)
  assert.equal((await call('POST','',{action:'status',rid:1,enabled:false})).response.status,200)
  assert.equal(Number((await pool.query('SELECT status FROM t_premium_platform WHERE rid=1')).rows[0].status),1)
  assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'delete',rid:Number(created.rid)})).response.status,200)
  const actions=(await pool.query('SELECT action FROM t_platform_audit_log ORDER BY rid')).rows.map(r=>r.action)
  assert.deepEqual(actions,['admin.premium.platform.create','admin.premium.platform.update','admin.premium.platform.cookie','admin.premium.platform.phrase','admin.premium.platform.status','admin.premium.platform.delete'])
 })
}finally{await pool.end()}
