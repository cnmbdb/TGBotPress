import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_PREMIUM_TRADE_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_PREMIUM_TRADE_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_premium_trade_test_')||!parsed.pathname.slice(1).startsWith('tg_premium_trade_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://premium-trade.test',PLATFORM_TELEGRAM_ACTIONS:'false'})
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
'CREATE TABLE t_premium_wallet_trade_list(rid int PRIMARY KEY,tx_hash varchar(100) NOT NULL,transferfrom_address varchar(200) NOT NULL,transferto_address varchar(200) NOT NULL,coin_name varchar(20) NOT NULL,amount varchar(100) NOT NULL,"timestamp" varchar(20) NOT NULL,process_status smallint NOT NULL,process_time timestamp,process_comments varchar(255),get_time timestamp,tg_notice_status_receive char(1) NOT NULL DEFAULT \'N\',tg_notice_status_send char(1) NOT NULL DEFAULT \'N\',platform_order_rid int,premium_package_rid int,premium_platform_rid int)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'premium-trade-admin','x'),(2,'premium-trade-reader','x'),(3,'premium-trade-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day'),($3,3,13,now()+interval '1 day')",[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'会员管理',NULL,0),(2,'会员交易','admin.premium.trade.index',1),(3,'会员补发','admin.premium.trade.reorder',2),(4,'禁止开通','admin.premium.trade.stoporder',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_premium_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time,tg_notice_status_send) VALUES (1,'0xabc001','wallet-from-a','wallet-to-a','USDT','10.50','1761600000000',4,NULL,'retry','2025-10-27 10:00:00','N'),(2,'0xdef002','wallet-from-b','wallet-to-b','USDT','8','1761600001000',9,now(),'done',now(),'Y'),(3,'0xabc003','wallet-from-a','wallet-to-c','USDT','12','1761600002000',6,NULL,'pending',now(),'N'),(4,'0x100%xyz','wallet-from-d','wallet-to-d','TRX','3','1761600003000',8,NULL,NULL,now(),'N'),(5,'0xabc005','wallet-from-e','wallet-to-e','USDT','6','1761600004000',1,NULL,NULL,now(),'N'),(6,'0xabc006','wallet-from-f','wallet-to-f','USDT','7','1761600005000',5,NULL,NULL,now(),'N'),(7,'0xabc007','wallet-from-g','wallet-to-g','USDT','9','1761600006000',7,NULL,NULL,now(),'N'),(8,'0xabc008','wallet-from-h','wallet-to-h','USDT','11','1761600007000',2,NULL,NULL,now(),'Y')")
const{premiumTradeApi}=await import('./premium-trade-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://premium-trade.test',contentType='application/json'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']=contentType}
 const response=await premiumTradeApi(new Request('https://premium-trade.test/api/premium-trades'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
try{
 await test('会员交易筛选、分页、时间格式、状态与操作权限',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,8);assert.equal(all.data.rows[0].rid,8);assert.equal(all.data.rows[0].process_status_label,'人工禁止');assert.equal(all.data.rows[0].can_reissue,false);assert.equal(all.data.rows[0].can_stop,false)
  assert.match(all.data.rows.find((row:any)=>row.rid===1).transaction_time,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);assert.equal(all.data.rows.find((row:any)=>row.rid===1).process_status_label,'下单失败');assert.equal(all.data.rows.find((row:any)=>row.rid===1).can_reissue,true);assert.equal(all.data.rows.find((row:any)=>row.rid===1).can_stop,true)
  assert.equal((await call('GET','?tx_hash=abc')).data.total,6);assert.equal((await call('GET','?tx_hash=%25')).data.total,1);assert.equal((await call('GET','?transferfrom_address=wallet-from-a')).data.total,2);assert.equal((await call('GET','?transferto_address=wallet-to-d')).data.total,1)
  assert.equal((await call('GET','?page=1&pageSize=10')).data.rows.length,8)
  assert.equal(all.data.canReissue,true);assert.equal(all.data.canStop,true);assert.equal(all.data.telegramEnabled,false)
  const reader=await call('GET','',undefined,readerToken);assert.equal(reader.response.status,200);assert.equal(reader.data.canReissue,false);assert.equal(reader.data.canStop,false)
  assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('会员交易补发和禁止的状态机、来源校验、审计',async()=>{
  assert.equal((await call('POST','',{action:'stop',rid:3},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'stop',rid:3},readerToken)).response.status,403)
  assert.equal((await call('POST','',{action:'stop',rid:3},token,'')).response.status,403)
  assert.equal((await call('POST','',{action:'stop',rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'stop',rid:2})).response.status,409)
  assert.equal((await call('POST','',{action:'reissue',rid:2})).response.status,409)
  const disabled=await call('POST','',{action:'reissue',rid:1});assert.equal(disabled.response.status,409)
  assert.equal(Number((await pool.query('SELECT process_status FROM t_premium_wallet_trade_list WHERE rid=1')).rows[0].process_status),4)
  process.env.PLATFORM_TELEGRAM_ACTIONS='true';assert.equal((await call('POST','',{action:'reissue',rid:1})).response.status,200);process.env.PLATFORM_TELEGRAM_ACTIONS='false'
  const reissued=(await pool.query('SELECT process_status,tg_notice_status_send FROM t_premium_wallet_trade_list WHERE rid=1')).rows[0];assert.equal(Number(reissued.process_status),1);assert.equal(reissued.tg_notice_status_send,'N')
  assert.equal((await call('POST','',{action:'stop',rid:3})).response.status,200)
  const stopped=(await pool.query('SELECT process_status,tg_notice_status_send,process_comments FROM t_premium_wallet_trade_list WHERE rid=3')).rows[0]
  assert.equal(Number(stopped.process_status),2);assert.equal(stopped.tg_notice_status_send,'Y');assert.equal(stopped.process_comments,'人工禁止兑换')
  assert.deepEqual((await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows,[{action:'premium.trade.reissue',resource_id:'1'},{action:'premium.trade.stop',resource_id:'3'}])
  assert.equal((await call('POST','',{action:'stop',rid:3})).response.status,409)
 })
}finally{await pool.end()}
