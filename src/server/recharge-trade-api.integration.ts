import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_RECHARGE_TRADES_TEST_DB_URL
const parsed=raw?new URL(raw):null
const parts=parsed?.hostname.split('.').map(Number)
const privateHost=parsed?.hostname==='postgres'||(process.env.TG_RECHARGE_TRADES_TEST_ALLOW_PRIVATE_DB==='1'&&parts?.length===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168)))
if(!raw||!parsed||!privateHost||!parsed.username.startsWith('tg_recharge_trades_test_')||!parsed.pathname.slice(1).startsWith('tg_recharge_trades_test_'))throw new Error('Recharge trade integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=parsed.hostname;process.env.DB_PORT=parsed.port||'5432';process.env.DB_DATABASE=parsed.pathname.slice(1);process.env.DB_USERNAME=parsed.username;process.env.DB_PASSWORD=parsed.password;process.env.PLATFORM_ORIGIN='https://recharge-trades.test'
const setup=new pg.Pool({connectionString:raw,max:4})
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_platform_cloudflare_security(rid bigint PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp)")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,action varchar(100) NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'authorized','fixture'),(2,'no-stop-grant','fixture'),(3,'other-page','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens=new Map<number,string>()
for(const[id,device]of[[1,11],[2,12],[3,13]]as const){const value=randomBytes(32).toString('hex');tokens.set(id,value);await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')',[digest(value),id,device])}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'可禁止'),(2,'仅查看'),(3,'其他页面')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'群组用户',NULL,0),(2,'充值交易','admin.groupuser.rechargetrade.index',1),(3,'禁止充值','admin.groupuser.rechargetrade.stoporder',2),(4,'机器人列表','admin.telegram.telegrambot.index',0)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(2,1),(2,2),(3,4)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query(`CREATE TABLE t_fms_wallet_trade_list(rid integer PRIMARY KEY,tx_hash varchar(100) NOT NULL,transferfrom_address varchar(200) NOT NULL,transferto_address varchar(200) NOT NULL,coin_name varchar(20) NOT NULL,amount varchar(100) NOT NULL,"timestamp" varchar(20) NOT NULL,process_status smallint NOT NULL,process_time timestamp,process_comments varchar(255),get_time timestamp,tg_notice_status_receive char(1) NOT NULL DEFAULT 'N',tg_notice_status_send char(1) NOT NULL DEFAULT 'N',recharge_order_rid integer)`)
await setup.query(`INSERT INTO t_fms_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,process_time,process_comments,get_time,recharge_order_rid) VALUES
 (1,'hash-one','from-alpha','to-omega','USDT','12.5','1760000000000',1,NULL,NULL,timestamp '2026-10-01 00:00:00',7),
 (2,'hash-two','from-beta','to-omega','TRX','50','1760000001000',4,NULL,NULL,timestamp '2026-10-02 00:00:00',NULL),
 (3,'hash-three','from-gamma','to-delta','USDT','2','1760000002000',7,NULL,NULL,NULL,NULL),
 (4,'hash-four','from-delta','to-omega','USDT','3','1760000003000',3,NULL,NULL,NULL,NULL),
 (5,'hash-five','from-epsilon','to-zeta','USDT','8','1760000004000',8,NULL,NULL,NULL,NULL),
 (6,'hash-six','from-theta','to-iota','USDT','9','1760000005000',9,NULL,'已充值',NULL,NULL),
 (7,'hash-seven','from-kappa','to-lambda','USDT','4','1760000006000',2,NULL,'人工禁止',timestamp '2026-10-07 00:00:00',NULL)`)
const{rechargeTradeApi}=await import('./recharge-trade-api.server')
function request(admin:number,method='GET',query='',body?:unknown,origin='https://recharge-trades.test'){return new Request('https://recharge-trades.test/api/recharge-trades'+query,{method,headers:{cookie:`tg_platform_session=${tokens.get(admin)}`,...(method==='POST'?{origin,'content-type':'application/json'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function call(admin:number,method='GET',query='',body?:unknown,origin?:string){const response=await rechargeTradeApi(request(admin,method,query,body,origin));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('recharge trade listing preserves legacy filters, all status labels, timestamp conversion, paging, and stop capability',async()=>{
  const all=await call(1);assert.equal(all.response.status,200);assert.equal(all.data.total,7);assert.deepEqual(all.data.rows.slice(0,7).map((r:any)=>r.process_status_label),['人工禁止','充值成功','充值中','找不到用户','金额无对应订单','充值失败','待充值']);assert.equal(all.data.canStop,true);assert.equal(all.data.rows[0].canStop,false);assert.equal(all.data.rows[1].canStop,false);assert.equal(all.data.rows[2].canStop,false);assert.equal(all.data.rows[3].canStop,true);assert.equal(all.data.rows[0].timestamp.length,19);assert.equal(all.data.rows[0].process_comments,'人工禁止');const emptyPage=await call(1,'GET','?page=2&pageSize=10');assert.equal(emptyPage.data.total,7);assert.equal(emptyPage.data.rows.length,0)
  assert.equal((await call(1,'GET','?txHash=hash-one')).data.total,1)
  assert.equal((await call(1,'GET','?fromAddress=from-beta')).data.rows[0].rid,2)
  assert.equal((await call(1,'GET','?toAddress=omega')).data.total,3)
  const mixed=await call(1,'GET','?txHash=hash&fromAddress=from-alpha&toAddress=omega');assert.equal(mixed.data.total,1);assert.equal(mixed.data.rows[0].rid,1)
  const invalidSize=await call(1,'GET','?page=2&pageSize=1');assert.equal(invalidSize.response.status,400)
 })
 await test('stop order action locks and updates only stoppable rows with audit; permission and request validation are enforced',async()=>{
  const stopped=await call(1,'POST','',{action:'stoporder',rid:1});assert.equal(stopped.response.status,200);assert.equal(stopped.data.message,'禁止成功')
  const row=(await setup.query('SELECT process_status,process_comments,tg_notice_status_send FROM t_fms_wallet_trade_list WHERE rid=1')).rows[0];assert.deepEqual(row,{process_status:2,process_comments:'人工禁止',tg_notice_status_send:'Y'})
  assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE admin_id=1 AND action='groupuser.recharge_trade.stop' AND resource_id=1")).rows[0].n),1)
  assert.equal((await call(1,'POST','',{action:'stoporder',rid:1})).response.status,409)
  assert.equal((await call(1,'POST','',{action:'stoporder',rid:5})).response.status,409)
  assert.equal((await call(1,'POST','',{action:'stoporder',rid:999})).response.status,404)
  assert.equal((await call(2,'POST','',{action:'stoporder',rid:2})).response.status,403)
  assert.equal((await call(2)).data.canStop,false)
  assert.equal((await call(3)).response.status,403)
  assert.equal((await rechargeTradeApi(new Request('https://recharge-trades.test/api/recharge-trades'))).status,401)
  assert.equal((await call(1,'PUT')).response.status,405)
  assert.equal((await call(1,'POST','',{action:'stoporder',rid:2},'https://attacker.test')).response.status,403)
  assert.equal((await call(1,'POST','',{action:'unknown',rid:1})).response.status,400)
 })
}finally{await setup.end()}
