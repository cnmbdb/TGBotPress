import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_PREMIUM_ORDER_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_PREMIUM_ORDER_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_premium_order_test_')||!parsed.pathname.slice(1).startsWith('tg_premium_order_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password})
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
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text,bot_token text)',
'CREATE TABLE t_premium_platform_order(rid int PRIMARY KEY,bot_rid int NOT NULL,premium_platform_rid int NOT NULL,source_type smallint NOT NULL,buy_tg_uid varchar(100) NOT NULL,buy_tg_username varchar(100),premium_tg_username varchar(100) NOT NULL,need_pay_usdt numeric(12,4) NOT NULL,status smallint NOT NULL,premium_platform_package_rid int NOT NULL,premium_package_month int NOT NULL,comments varchar(255),create_time timestamp NOT NULL,expire_time timestamp NOT NULL,cancel_time timestamp,complete_time timestamp,tx_hash varchar(200),recipient varchar(1000))'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'premium-order-admin','x'),(2,'premium-order-no-permission','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day')",[digest(token),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'会员管理',NULL,0),(2,'会员订单','admin.premium.order.index',1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Bot Eight','bot_eight','never-return-this'),(9,'Bot Nine','bot_nine','secret-token')")
await pool.query("INSERT INTO t_premium_platform_order(rid,bot_rid,premium_platform_rid,source_type,buy_tg_uid,buy_tg_username,premium_tg_username,need_pay_usdt,status,premium_platform_package_rid,premium_package_month,comments,create_time,expire_time,cancel_time,complete_time,tx_hash,recipient) VALUES (1,8,10,1,'1001','buyer_a','alice',5.5,0,21,3,'manual',now(),now()+interval '30 day',NULL,NULL,'private-hash','private-recipient'),(2,8,10,2,'1002','buyer_b','alice_next',8,2,22,6,'auto',now(),now()+interval '30 day',NULL,now(),'private-hash-2','private-recipient-2'),(3,9,11,2,'1003',NULL,'bob',10,6,23,12,NULL,now(),now()+interval '30 day',NULL,NULL,'private-hash-3','private-recipient-3'),(4,9,11,9,'1004',NULL,'wild%card',2,8,24,3,NULL,now(),now()+interval '30 day',NULL,NULL,'private-hash-4','private-recipient-4')")
await pool.query("INSERT INTO t_premium_platform_order(rid,bot_rid,premium_platform_rid,source_type,buy_tg_uid,premium_tg_username,need_pay_usdt,status,premium_platform_package_rid,premium_package_month,create_time,expire_time) SELECT n,8,10,2,'2000'||n::text,'extra'||n,1,2,30,3,now(),now()+interval '30 day' FROM generate_series(5,12) n")
const{premiumOrderApi}=await import('./premium-order-api.server')
async function call(query='',session: string|null=token,method='GET'){const response=await premiumOrderApi(new Request('https://premium-order.test/api/premium-orders'+query,{method,headers:session?{cookie:'tg_platform_session='+session}:{}}));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('会员订单筛选、分页、状态来源映射、字段与选项',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,12);assert.equal(all.data.rows[0].rid,12);assert.equal(all.data.rows[0].status_label,'已开通');assert.equal(all.data.rows[0].source_type_label,'自动下单')
  assert.equal((await call('?username=alice')).data.total,2);assert.equal((await call('?username=%25')).data.total,1);assert.equal((await call('?botRid=8')).data.total,10)
  const page=await call('?page=2&pageSize=10');assert.equal(page.data.total,12);assert.equal(page.data.page,2);assert.equal(page.data.rows.length,2)
  const states=await call('?username=bob');assert.equal(states.data.rows[0].status_label,'开通中')
  const unknown=await call('?username=wild');assert.equal(unknown.data.rows[0].status_label,'未知状态 (8)');assert.equal(unknown.data.rows[0].source_type_label,'未知来源 (9)')
  const options=await call('?action=options');assert.equal(options.data.bots.length,2);assert.equal(JSON.stringify(options.data).includes('never-return-this'),false)
  for(const field of ['tx_hash','recipient','private-hash','private-recipient'])assert.equal(JSON.stringify(all.data).includes(field),false)
 })
 await test('会员订单路由权限与请求方法保护',async()=>{assert.equal((await call('',deniedToken)).response.status,403);assert.equal((await call('',null)).response.status,401);assert.equal((await call('',token,'POST')).response.status,405)})
}finally{await pool.end()}
