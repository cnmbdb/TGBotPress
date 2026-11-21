import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_ENERGY_TRADE_TEST_DB_URL,p=raw?new URL(raw):null,ip=p?.hostname.split('.').map(Number)
if(!raw||!p||!(p.hostname==='postgres'||process.env.TG_ENERGY_TRADE_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!p.username.startsWith('tg_energy_trade_test_')||!p.pathname.slice(1).startsWith('tg_energy_trade_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:p.hostname,DB_PORT:p.port||'5432',DB_DATABASE:p.pathname.slice(1),DB_USERNAME:p.username,DB_PASSWORD:p.password,PLATFORM_ORIGIN:'https://energy-trade.test',PLATFORM_TELEGRAM_ACTIONS:'false'})
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
"CREATE TABLE t_energy_wallet_trade_list(rid int PRIMARY KEY,tx_hash varchar(100) NOT NULL,transferfrom_address varchar(200) NOT NULL,transferto_address varchar(200) NOT NULL,coin_name varchar(20) NOT NULL,amount varchar(100) NOT NULL,\"timestamp\" varchar(20) NOT NULL,process_status smallint DEFAULT 0 NOT NULL,process_time timestamp,process_comments varchar(2000),get_time timestamp,energy_platform_rid int,energy_platform_bot_rid int,platform_order_rid int,energy_package_rid int,tg_notice_status_receive char(1) DEFAULT 'N' NOT NULL,tg_notice_status_send char(1) DEFAULT 'N' NOT NULL)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'energy-trade-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'钱包交易',NULL,1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1)')
await pool.query("INSERT INTO t_energy_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_comments,get_time,tg_notice_status_send) VALUES(1,'tx-a','from-a','to-a','TRX','1.25',$1,4,'failed',now(),'Y'),(2,'tx-b','from-b','to-b','TRX','2.5','legacy-time',9,'complete',now(),'Y')",[String(Date.UTC(2026,9,29))])
const {energyTradeApi}=await import('./energy-trade-api.server')
async function call(method='GET',query='',body?:unknown,origin='https://energy-trade.test'){const headers:Record<string,string>={cookie:'tg_platform_session='+token};let requestBody:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}const response=await energyTradeApi(new Request('https://energy-trade.test/api/energy-trades'+query,{method,headers,body:requestBody}));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('交易列表筛选、时间转换和补发权限',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,2);assert.equal(all.data.rows[0].process_status_label,'下单成功');assert.equal(all.data.rows[1].process_status_label,'下单失败');assert.match(all.data.rows[1].transaction_time,/^2026-10-29 08:/);assert.equal(all.data.rows[0].transaction_time,'legacy-time');assert.equal((await call('GET','?tx_hash=tx-a')).data.total,1);assert.equal((await call('GET','?transferfrom_address=from-b')).data.total,1);assert.equal((await call('GET','?transferto_address=to-a')).data.total,1);assert.equal(all.data.canReissue,false);assert.equal(all.data.telegramEnabled,false);assert.equal((await call('POST','',{action:'reissue',rid:1})).response.status,403)
  await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(3,'兑换补发','admin.energy.trade.reorder',2)");await pool.query('INSERT INTO t_role_has_permissions VALUES(3,1)')
  const rights=(await call()).data;assert.equal(rights.canReissue,true);assert.equal(rights.rows.find((r:any)=>r.rid===1).can_reissue,true);assert.equal(rights.rows.find((r:any)=>r.rid===2).can_reissue,false)
 })
 await test('补发门控、错误来源拒绝、状态重置及审计',async()=>{
  process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  assert.equal((await call('POST','',{action:'reissue',rid:1},'https://attacker.invalid')).response.status,403)
  let row=await pool.query('SELECT process_status,tg_notice_status_send FROM t_energy_wallet_trade_list WHERE rid=1');assert.equal(Number(row.rows[0].process_status),4);assert.equal(row.rows[0].tg_notice_status_send,'Y')
  assert.equal((await call('POST','',{action:'reissue',rid:2})).response.status,409)
  assert.equal((await call('POST','',{action:'reissue',rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'reissue',rid:1})).response.status,200)
  row=await pool.query('SELECT process_status,tg_notice_status_send FROM t_energy_wallet_trade_list WHERE rid=1');assert.equal(Number(row.rows[0].process_status),1);assert.equal(row.rows[0].tg_notice_status_send,'N')
  assert.equal(Number((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='energy.trade.reissue'")).rows[0].n),1)
 })
}finally{await pool.end()}

