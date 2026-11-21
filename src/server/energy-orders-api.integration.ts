import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_ENERGY_ORDERS_TEST_DB_URL,p=raw?new URL(raw):null,ip=p?.hostname.split('.').map(Number)
if(!raw||!p||!(p.hostname==='postgres'||process.env.TG_ENERGY_ORDERS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!p.username.startsWith('tg_energy_orders_test_')||!p.pathname.slice(1).startsWith('tg_energy_orders_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:p.hostname,DB_PORT:p.port||'5432',DB_DATABASE:p.pathname.slice(1),DB_USERNAME:p.username,DB_PASSWORD:p.password,PLATFORM_ORIGIN:'https://energy-orders.test',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789',APP_ENV:'development'})
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
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text)',
"CREATE TABLE t_energy_platform(rid int PRIMARY KEY,poll_group char(1) NOT NULL,platform_name smallint NOT NULL,status smallint DEFAULT 1 NOT NULL,platform_uid varchar(100),permission_id int DEFAULT 0 NOT NULL,platform_balance numeric(28,6) DEFAULT 0 NOT NULL,alert_platform_balance numeric(28,6) DEFAULT 0 NOT NULL,platform_apikey varchar(3000),tg_notice_obj varchar(200),tg_notice_bot_rid int,seq_sn int DEFAULT 0 NOT NULL,last_alert_time timestamp,comments varchar(3000),create_time timestamp NOT NULL,update_time timestamp)",
'CREATE TABLE t_energy_platform_bot(rid int PRIMARY KEY,bot_rid int NOT NULL,poll_group char(1) NOT NULL)',
'CREATE TABLE t_energy_platform_order(rid int PRIMARY KEY,energy_platform_rid int NOT NULL,energy_platform_bot_rid int NOT NULL,platform_name smallint NOT NULL,platform_uid varchar(50) NOT NULL,source_type smallint DEFAULT 1 NOT NULL,receive_address varchar(50) NOT NULL,platform_order_id varchar(100) NOT NULL,energy_amount int NOT NULL,energy_day smallint NOT NULL,energy_time timestamp NOT NULL,recovery_status smallint DEFAULT 1 NOT NULL,recovery_time timestamp,use_trx numeric(14,6))'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'orders-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'能量订单',NULL,1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query("INSERT INTO t_role_has_permissions VALUES(1,1),(2,1)")
await pool.query("INSERT INTO t_telegram_bot VALUES(10,'Bot','bot')")
await pool.query("INSERT INTO t_energy_platform(rid,poll_group,platform_name,platform_uid,permission_id,platform_apikey,create_time) VALUES(1,'A',1,'agent-uid',9,'cipher-fixture',now())")
await pool.query("INSERT INTO t_energy_platform_bot VALUES(20,10,'A')")
await pool.query("INSERT INTO t_energy_platform_order(rid,energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,source_type,receive_address,platform_order_id,energy_amount,energy_day,energy_time,recovery_status,use_trx) VALUES(1,1,20,1,'user-uid',4,'recipient-a','order-a',65000,1,now(),2,1.250000),(2,1,20,1,'agent-uid',2,'recipient-b','order-b',65000,1,now(),2,4.500000),(3,1,20,1,'agent-uid',2,'recipient-b','order-c',65000,1,now(),2,1.500000),(4,1,20,1,'agent-uid',2,'recipient-c','order-d',65000,1,now(),2,20.000000)")
const {energyOrdersApi}=await import('./energy-orders-api.server')
async function call(method='GET',query='',body?:unknown,origin='https://energy-orders.test'){
 const headers:Record<string,string>={cookie:'tg_platform_session='+token};let requestBody:BodyInit|undefined
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}
 const response=await energyOrdersApi(new Request('https://energy-orders.test/api/energy-orders'+query,{method,headers,body:requestBody}))
 return{response,data:await response.json() as Record<string,any>}
}
try{
 await test('订单筛选、字典标签和权限门控',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,4);assert.equal(all.data.rows[0].source_type_label,'自动下单');assert.equal(all.data.rows[0].recovery_status_label,'待回收');assert.equal(all.data.canMarkRecovered,false);assert.equal((await call('GET','?platformUid=user-uid')).data.total,1);assert.equal((await call('GET','?platformOrderId=order-a')).data.total,1);assert.equal((await call('GET','?address=recipient-a')).data.total,1);assert.equal((await call('GET','?botRid=10')).data.total,4);assert.equal((await call('GET','?action=options')).data.bots.length,1);assert.equal((await call('POST','',{action:'mark_recovered',rid:1})).response.status,403)
  await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(3,'已回收','admin.energy.order.alreadyrecover',2),(4,'批量回收能量','admin.energy.order.batch_recovery_energy',2)")
  await pool.query('INSERT INTO t_role_has_permissions VALUES(3,1),(4,1)')
  const rights=(await call()).data;assert.equal(rights.canMarkRecovered,true);assert.equal(rights.canBatchRecover,true)
 })
 await test('手动标记、批量回收签名请求、来源校验和原子状态更新',async()=>{
  assert.equal((await call('POST','',{action:'mark_recovered',rid:1},'https://attacker.invalid')).response.status,403)
  assert.equal((await call('POST','',{action:'mark_recovered',rid:1})).response.status,200)
  assert.equal(Number((await pool.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=1')).rows[0].recovery_status),3)
  assert.equal((await call('POST','',{action:'mark_recovered',rid:1})).response.status,409)
  const original=globalThis.fetch;let requestBody:Record<string,any>|undefined
  globalThis.fetch=async(input,init)=>{const request=input instanceof Request?input:new Request(input,init);assert.equal(new URL(request.url).href,'http://signer.test/api/internal/tron/sign');assert.match(request.headers.get('authorization')||'',/^Bearer test-token-/);requestBody=await request.json() as Record<string,any>;return Response.json({code:200,data:{txid:'mock-txid'}})}
  try{
   process.env.PLATFORM_TELEGRAM_ACTIONS='true'
   const result=await call('POST','',{action:'batch_recover',daili_address:'agent-uid',recovery_address:'recipient-b'})
   assert.equal(result.response.status,200);assert.equal(result.data.txid,'mock-txid');assert.equal(result.data.count,2)
   assert.equal(requestBody?.operation,'undelegate_resource');assert.equal(requestBody?.private_key_ciphertext,'cipher-fixture');assert.equal(requestBody?.from_address,'agent-uid');assert.equal(requestBody?.to_address,'recipient-b');assert.equal(requestBody?.amount,'6');assert.equal(requestBody?.resource_type,'ENERGY');assert.equal(requestBody?.permission_id,9)
   process.env.PLATFORM_TELEGRAM_ACTIONS='false';assert.equal((await call('POST','',{action:'batch_recover',daili_address:'agent-uid',recovery_address:'recipient-c'})).response.status,409);assert.equal(Number((await pool.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=4')).rows[0].recovery_status),2)
   process.env.PLATFORM_TELEGRAM_ACTIONS='true';globalThis.fetch=async()=>Response.json({code:500,msg:'mock signer failure'});assert.equal((await call('POST','',{action:'batch_recover',daili_address:'agent-uid',recovery_address:'recipient-c'})).response.status,502);assert.equal(Number((await pool.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=4')).rows[0].recovery_status),2)
  }finally{globalThis.fetch=original;delete process.env.PLATFORM_TELEGRAM_ACTIONS}
  const rows=await pool.query('SELECT rid,recovery_status FROM t_energy_platform_order ORDER BY rid');assert.deepEqual(rows.rows.map(r=>[Number(r.rid),Number(r.recovery_status)]),[[1,3],[2,3],[3,3],[4,2]])
  assert.equal(Number((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'energy.order.%'")).rows[0].n),2)
 })
}finally{await pool.end()}

