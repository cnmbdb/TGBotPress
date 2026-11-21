import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_MONITOR_BOTS_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_MONITOR_BOTS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_monitor_bots_test_')||!parsed.pathname.slice(1).startsWith('tg_monitor_bots_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://monitor-bots.test'})
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
'CREATE TABLE t_monitor_bot(rid serial PRIMARY KEY,bot_rid int NOT NULL,status smallint NOT NULL DEFAULT 1,free_monitor_wallet int NOT NULL DEFAULT 4,price_usdt_5 numeric(16,4) NOT NULL DEFAULT 0,price_usdt_10 numeric(16,4) NOT NULL DEFAULT 0,price_usdt_20 numeric(16,4) NOT NULL DEFAULT 0,price_usdt_50 numeric(16,4) NOT NULL DEFAULT 0,price_usdt_100 numeric(16,4) NOT NULL DEFAULT 0,price_usdt_200 numeric(16,4) NOT NULL DEFAULT 0,comments varchar(3000),create_time timestamp NOT NULL,update_time timestamp)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'monitor-bots-admin','x'),(2,'monitor-bots-reader','x'),(3,'monitor-bots-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day'),($3,3,13,now()+interval '1 day')",[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'监控管理',NULL,0),(2,'机器人监控','admin.monitor.bot.index',1),(3,'添加机器人监控','admin.monitor.bot.add',2),(4,'修改机器人监控','admin.monitor.bot.update',2),(5,'删除机器人监控','admin.monitor.bot.delete',2),(6,'修改机器人监控','admin.monitor.bot.change_status',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Blue Bot','blue_bot','never-return-this'),(9,'Green Bot','green_bot','token-nine'),(10,'Red Bot','red_bot','token-ten'),(11,'Purple Bot','purple_bot','token-eleven')")
await pool.query("INSERT INTO t_monitor_bot(rid,bot_rid,status,free_monitor_wallet,price_usdt_5,price_usdt_10,price_usdt_20,price_usdt_50,price_usdt_100,price_usdt_200,comments,create_time) VALUES(1,8,0,4,5,8,13,24,38,56,'first fixture',now()),(2,9,1,2,3,4,5,6,7,8,'second fixture',now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_monitor_bot','rid'),2,true)")
const{monitorBotsApi}=await import('./monitor-bots-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://monitor-bots.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await monitorBotsApi(new Request('https://monitor-bots.test/api/monitor-bots'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const form={bot_rid:10,free_monitor_wallet:6,price_usdt_5:'5.25',price_usdt_10:'8',price_usdt_20:'13',price_usdt_50:'24',price_usdt_100:'38',price_usdt_200:'56',comments:'six wallets'}
try{
 await test('机器人监控列表、搜索、分页、机器人选项和读取权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].rid,2);assert.equal(list.data.rows.find((row:any)=>row.rid===1).status,0);assert.equal(list.data.rows.find((row:any)=>row.rid===1).token_configured,true)
  assert.equal(JSON.stringify(list.data).includes('never-return-this'),false);assert.equal((await call('GET','?search=Blue')).data.total,1);assert.equal((await call('GET','?search=fixture')).data.total,2);assert.equal((await call('GET','?search=%25')).data.total,0)
  const options=await call('GET','?action=options');assert.equal(options.data.bots.length,4);assert.equal(JSON.stringify(options.data).includes('token-nine'),false)
  const reader=await call('GET','',undefined,readerToken);assert.equal(reader.response.status,200);assert.deepEqual(reader.data.permissions,{add:false,update:false,delete:false,status:false})
  assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('机器人监控新增、编辑、状态、删除、冲突、权限和审计',async()=>{
  assert.equal((await call('POST','',{action:'add',...form},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'add',...form},readerToken)).response.status,403)
  assert.equal((await call('POST','',{action:'add',...form,bot_rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'add',...form,bot_rid:8})).response.status,409)
  assert.equal((await call('POST','',{action:'add',...form,free_monitor_wallet:100001})).response.status,400)
  assert.equal((await call('POST','',{action:'add',...form})).response.status,200)
  const created=(await pool.query('SELECT rid,status,free_monitor_wallet,price_usdt_5::text,comments FROM t_monitor_bot WHERE bot_rid=10')).rows[0]
  assert.equal(Number(created.status),1);assert.equal(Number(created.free_monitor_wallet),6);assert.equal(created.price_usdt_5,'5.2500');assert.equal(created.comments,'six wallets')
  assert.equal((await call('POST','',{action:'update',rid:1,...form,bot_rid:9})).response.status,409)
  assert.equal((await call('POST','',{action:'update',rid:1,...form,bot_rid:11})).response.status,200)
  const updated=(await pool.query('SELECT bot_rid,free_monitor_wallet,comments FROM t_monitor_bot WHERE rid=1')).rows[0]
  assert.equal(Number(updated.bot_rid),11);assert.equal(Number(updated.free_monitor_wallet),6);assert.equal(updated.comments,'six wallets')
  assert.equal((await call('POST','',{action:'status',rid:1,enabled:true})).response.status,200)
  assert.equal(Number((await pool.query('SELECT status FROM t_monitor_bot WHERE rid=1')).rows[0].status),0)
  assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'delete',rid:Number(created.rid)})).response.status,200)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(row=>[row.action,Number(row.resource_id)])
  assert.deepEqual(audit,[['monitor.bot.add',3],['monitor.bot.update',1],['monitor.bot.status',1],['monitor.bot.delete',3]])
 })
}finally{await pool.end()}
