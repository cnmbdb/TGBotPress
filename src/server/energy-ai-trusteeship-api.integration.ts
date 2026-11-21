import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_ENERGY_TRUSTEESHIP_TEST_DB_URL,p=raw?new URL(raw):null,ip=p?.hostname.split('.').map(Number)
if(!raw||!p||!(p.hostname==='postgres'||process.env.TG_ENERGY_TRUSTEESHIP_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!p.username.startsWith('tg_energy_trusteeship_test_')||!p.pathname.slice(1).startsWith('tg_energy_trusteeship_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:p.hostname,DB_PORT:p.port||'5432',DB_DATABASE:p.pathname.slice(1),DB_USERNAME:p.username,DB_PASSWORD:p.password,PLATFORM_ORIGIN:'https://trusteeship.test'})
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
"CREATE TABLE t_energy_ai_trusteeship(rid int PRIMARY KEY,bot_rid int NOT NULL,tg_uid bigint NOT NULL,wallet_addr varchar(100) NOT NULL,status smallint DEFAULT 1 NOT NULL,current_bandwidth_quantity bigint DEFAULT 0,current_energy_quantity bigint DEFAULT 0,min_energy_quantity int DEFAULT 32000,per_buy_energy_quantity int DEFAULT 32000,total_buy_energy_quantity bigint DEFAULT 0,total_used_trx numeric(14,2) DEFAULT 0,total_buy_quantity int DEFAULT 0,max_buy_quantity int DEFAULT 0,is_buy char(1) DEFAULT 'N',is_notice char(1) DEFAULT 'N',is_notice_admin char(1) DEFAULT 'N',last_buy_time timestamp,last_used_trx numeric(14,2),comments varchar(2000),back_comments varchar(2000),create_by int NOT NULL,create_time timestamp NOT NULL,update_by int,update_time timestamp)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'energy-trusteeship-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'智能托管',NULL,1),(3,'修改智能托管','admin.energy.aitrusteeship.update',2),(4,'删除智能托管','admin.energy.aitrusteeship.delete',2),(5,'刷新智能托管','admin.energy.aitrusteeship.refresh',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username) VALUES(8,'Bot Eight','bot_eight'),(9,'Bot Nine','bot_nine')")
await pool.query("INSERT INTO t_energy_ai_trusteeship(rid,bot_rid,tg_uid,wallet_addr,status,min_energy_quantity,per_buy_energy_quantity,is_buy,create_by,create_time,comments,back_comments) VALUES(1,8,12345,'wallet-one',0,50000,65000,'B',1,now(),'public note','private note'),(2,9,67890,'wallet-two',1,75000,131000,'N',1,now(),'second note','')")
const {energyAiTrusteeshipApi}=await import('./energy-ai-trusteeship-api.server')
async function call(method='GET',query='',body?:unknown,origin='https://trusteeship.test'){const headers:Record<string,string>={cookie:'tg_platform_session='+token};let requestBody:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}const response=await energyAiTrusteeshipApi(new Request('https://trusteeship.test/api/energy-ai-trusteeship'+query,{method,headers,body:requestBody}));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('智能托管列表筛选、分页、状态及只读字段',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,2);assert.equal(all.data.rows[0].status_label,'关闭');assert.equal(all.data.rows[1].status_label,'开启');assert.equal(all.data.rows[0].buy_label,'无需下单');assert.equal(all.data.rows.find((r:any)=>r.rid===1).back_comments,'private note');assert.equal((await call('GET','?tgUid=12345')).data.total,1);assert.equal((await call('GET','?wallet=wallet-two')).data.total,1);assert.equal((await call('GET','?botRid=8')).data.total,1);assert.equal((await call('GET','?pageSize=10')).data.pageSize,10);assert.equal((await call('GET','?action=options')).data.bots.length,2);assert.equal(all.data.canEdit,true);assert.equal(all.data.canDelete,true);assert.equal(all.data.canRefresh,true)
 })
 await test('编辑冲突保护、来源校验、刷新、删除和审计',async()=>{
  const edit={action:'update',rid:1,status:2,wallet_addr:'wallet-one-updated',tg_uid:'12345',min_energy_quantity:60000,per_buy_energy_quantity:131000,max_buy_quantity:4,back_comments:'admin edited'}
  assert.equal((await call('POST','',edit,'https://attacker.invalid')).response.status,403)
  assert.equal((await pool.query('SELECT wallet_addr FROM t_energy_ai_trusteeship WHERE rid=1')).rows[0].wallet_addr,'wallet-one')
  assert.equal((await call('POST','',{...edit,wallet_addr:'wallet-two'})).response.status,409)
  assert.equal((await call('POST','',edit)).response.status,200)
  const changed=(await pool.query('SELECT status,wallet_addr,min_energy_quantity,per_buy_energy_quantity,max_buy_quantity,back_comments FROM t_energy_ai_trusteeship WHERE rid=1')).rows[0];assert.equal(Number(changed.status),2);assert.equal(changed.wallet_addr,'wallet-one-updated');assert.equal(Number(changed.min_energy_quantity),60000);assert.equal(Number(changed.per_buy_energy_quantity),131000);assert.equal(changed.back_comments,'admin edited')
  assert.equal((await call('POST','',{action:'refresh',rid:1})).response.status,200);assert.equal((await pool.query('SELECT is_buy FROM t_energy_ai_trusteeship WHERE rid=1')).rows[0].is_buy,'N')
  assert.equal((await call('POST','',{action:'delete',rid:2})).response.status,200);assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  const actions=(await pool.query("SELECT action FROM t_platform_audit_log ORDER BY rid")).rows.map(r=>r.action);assert.deepEqual(actions,['energy.aitrusteeship.update','energy.aitrusteeship.refresh','energy.aitrusteeship.delete'])
 })
}finally{await pool.end()}
