import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_MONITOR_WALLETS_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_MONITOR_WALLETS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_monitor_wallets_test_')||!parsed.pathname.slice(1).startsWith('tg_monitor_wallets_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://monitor-wallets.test'})
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
'CREATE TABLE t_monitor_wallet(rid serial PRIMARY KEY,chain_type varchar(10) NOT NULL,monitor_wallet varchar(200) NOT NULL,status smallint NOT NULL DEFAULT 1,bot_rid int,tg_notice_obj varchar(200),balance_alert numeric(14,2) NOT NULL DEFAULT 0,balance_amount numeric(14,2) NOT NULL DEFAULT 0,comments varchar(100),create_time timestamp,update_time timestamp,monitor_trx_transaction char(2) NOT NULL DEFAULT \'NN\',monitor_approve_transaction char(2) NOT NULL DEFAULT \'NN\',monitor_multi_transaction char(2) NOT NULL DEFAULT \'NN\',monitor_pledge_transaction char(2) NOT NULL DEFAULT \'NN\')'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'monitor-wallet-admin','x'),(2,'monitor-wallet-reader','x'),(3,'monitor-wallet-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day'),($3,3,13,now()+interval '1 day')",[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'监控管理',NULL,0),(2,'监控钱包','admin.monitor.wallet.index',1),(3,'添加监控钱包','admin.monitor.wallet.add',2),(4,'批量添加监控','admin.monitor.wallet.batchadd',2),(5,'修改监控钱包','admin.monitor.wallet.update',2),(6,'删除监控钱包','admin.monitor.wallet.delete',2),(7,'修改监控钱包','admin.monitor.wallet.change_status',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Blue Bot','blue_bot','never-return-this'),(9,'Green Bot','green_bot','secret-token')")
await pool.query("INSERT INTO t_monitor_wallet(rid,chain_type,monitor_wallet,status,bot_rid,tg_notice_obj,balance_alert,balance_amount,comments,create_time) VALUES(1,'trc','TOLD001',0,8,'12345',15.25,18.75,'existing',now()),(2,'trc','TOLD002',1,9,'67890',0,0,'second',now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_monitor_wallet','rid'),2,true)")
const{monitorWalletsApi}=await import('./monitor-wallets-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://monitor-wallets.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await monitorWalletsApi(new Request('https://monitor-wallets.test/api/monitor-wallets'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const form={monitor_usdt_transaction:'YY',monitor_trx_transaction:'YN',monitor_approve_transaction:'NY',monitor_multi_transaction:'NN',monitor_pledge_transaction:'YY',bot_rid:8,chain_type:'trc',monitor_wallet:'TNEW001',tg_notice_obj:'10001,10002',balance_alert:'25.75',comments:'new wallet'}
try{
 await test('监控钱包列表筛选、机器人选项、敏感令牌隐藏和旧库字段兼容',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].rid,2);assert.equal(list.data.rows.find((row:any)=>row.rid===1).status,0);assert.equal(list.data.rows.find((row:any)=>row.rid===1).monitor_usdt_transaction,'YY')
  assert.equal((await call('GET','?bot=8')).data.total,1);assert.equal((await call('GET','?search=TOLD')).data.total,2);assert.equal((await call('GET','?search=existing')).data.total,1);assert.equal((await call('GET','?search=%25')).data.total,0)
  assert.equal(JSON.stringify(list.data).includes('never-return-this'),false);const options=await call('GET','?action=options');assert.equal(options.data.bots.length,2);assert.equal(JSON.stringify(options.data).includes('secret-token'),false)
  assert.deepEqual(list.data.permissions,{add:true,batchadd:true,update:true,delete:true,status:true});const reader=await call('GET','',undefined,readerToken);assert.deepEqual(reader.data.permissions,{add:false,batchadd:false,update:false,delete:false,status:false});assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
  await pool.query("ALTER TABLE t_monitor_wallet ADD COLUMN monitor_usdt_transaction char(2) NOT NULL DEFAULT 'NN'");await pool.query("UPDATE t_monitor_wallet SET monitor_usdt_transaction='NN' WHERE rid=1");const migrated=await call();assert.equal(migrated.data.rows.find((row:any)=>row.rid===1).monitor_usdt_transaction,'NN')
 })
 await test('监控钱包新增、编辑、批量导入、状态、删除、权限和审计',async()=>{
  assert.equal((await call('POST','',{action:'add',...form},token,'https://evil.test')).response.status,403);assert.equal((await call('POST','',{action:'add',...form},readerToken)).response.status,403)
  assert.equal((await call('POST','',{action:'add',...form,monitor_wallet:'TOLD001'})).response.status,409);assert.equal((await call('POST','',{action:'add',...form,monitor_wallet:''})).response.status,400);assert.equal((await call('POST','',{action:'add',...form,bot_rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'add',...form})).response.status,200);const added=(await pool.query("SELECT rid,status,balance_alert::text,comments,monitor_usdt_transaction,monitor_trx_transaction,monitor_approve_transaction,monitor_multi_transaction,monitor_pledge_transaction FROM t_monitor_wallet WHERE monitor_wallet='TNEW001'")).rows[0];assert.equal(Number(added.status),1);assert.equal(added.balance_alert,'25.75');assert.equal(added.comments,'new wallet');assert.equal(added.monitor_usdt_transaction,'YY');assert.equal(added.monitor_trx_transaction,'YN');assert.equal(added.monitor_approve_transaction,'NY');assert.equal(added.monitor_multi_transaction,'NN');assert.equal(added.monitor_pledge_transaction,'YY')
  assert.equal((await call('POST','',{action:'update',rid:1,...form,monitor_wallet:'TOLD002'})).response.status,409);assert.equal((await call('POST','',{action:'update',rid:999,...form,monitor_wallet:'TNEW002'})).response.status,404);assert.equal((await call('POST','',{action:'update',rid:1,...form,monitor_wallet:'TNEW002'})).response.status,200)
  const updated=(await pool.query('SELECT monitor_wallet,bot_rid,balance_alert::text,tg_notice_obj,comments,monitor_usdt_transaction,monitor_trx_transaction,monitor_approve_transaction,monitor_multi_transaction,monitor_pledge_transaction FROM t_monitor_wallet WHERE rid=1')).rows[0];assert.equal(updated.monitor_wallet,'TNEW002');assert.equal(Number(updated.bot_rid),8);assert.equal(updated.balance_alert,'25.75');assert.equal(updated.tg_notice_obj,'10001,10002');assert.equal(updated.monitor_usdt_transaction,'YY');assert.equal(updated.monitor_trx_transaction,'YN');assert.equal(updated.monitor_approve_transaction,'NY');assert.equal(updated.monitor_multi_transaction,'NN');assert.equal(updated.monitor_pledge_transaction,'YY')
  const batch=await call('POST','',{action:'batchadd',bot_rid:9,chain_type:'trc',monitor_wallet:'TBATCH001,first note\nTBATCH002,second note\nTBATCH001,repeat\nTOLD002,already exists',tg_notice_obj:'123',balance_alert:'0'});assert.equal(batch.response.status,200);assert.match(batch.data.message,/已添加 2 个钱包，跳过重复 1 个/)
  assert.equal((await pool.query("SELECT comments FROM t_monitor_wallet WHERE monitor_wallet='TBATCH002'")).rows[0].comments,'second note');assert.equal((await call('POST','',{action:'batchadd',bot_rid:null,chain_type:'trc',monitor_wallet:'TBATCH001\nTOLD002',balance_alert:'0'})).response.status,409)
  assert.equal((await call('POST','',{action:'status',rid:1,enabled:true})).response.status,200);assert.equal(Number((await pool.query('SELECT status FROM t_monitor_wallet WHERE rid=1')).rows[0].status),0)
  assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404);assert.equal((await call('POST','',{action:'delete',rid:Number(added.rid)})).response.status,200)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(row=>[row.action,Number(row.resource_id)]);assert.deepEqual(audit,[['monitor.wallet.add',3],['monitor.wallet.update',1],['monitor.wallet.batchadd',5],['monitor.wallet.status',1],['monitor.wallet.delete',3]])
 })
}finally{await pool.end()}
