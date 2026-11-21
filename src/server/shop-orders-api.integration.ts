import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_SHOP_ORDER_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_SHOP_ORDER_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_shop_order_test_')||!parsed.pathname.slice(1).startsWith('tg_shop_order_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://shop-orders.test'})
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
'CREATE TABLE t_shop_order(rid serial PRIMARY KEY,bot_rid int NOT NULL,tg_uid varchar(50) NOT NULL,tg_username varchar(100),cdkey_no varchar(100),cdkey_pwd varchar(2000),pay_type smallint NOT NULL,pay_price varchar(50),comments varchar(3000),pay_time timestamp)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'shop-order-admin','x'),(2,'shop-order-reader','x'),(3,'shop-order-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'商城管理',NULL,0),(2,'商品订单','admin.shop.order.index',1),(3,'修改备注','admin.shop.order.update',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Blue Bot','blue_bot','never-return-this'),(9,'Red Bot','red_bot','another-secret')")
await pool.query("INSERT INTO t_shop_order(rid,bot_rid,tg_uid,tg_username,cdkey_no,cdkey_pwd,pay_type,pay_price,comments,pay_time) VALUES(1,8,'123','alice','CARD-AAA','cipher-secret-never-return',1,'2.50','paid',now()-interval '1 hour'),(2,9,'456','bob','CARD-BBB','another-cipher-secret',2,'1.25','',now()),(3,8,'789',NULL,'other%card','third-cipher-secret',9,'0','unknown',NULL)")
await pool.query("SELECT setval(pg_get_serial_sequence('t_shop_order','rid'),3,true)")
const{shopOrdersApi}=await import('./shop-orders-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://shop-orders.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await shopOrdersApi(new Request('https://shop-orders.test/api/shop-orders'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
try{
 await test('商品订单筛选、支付方式映射、机器人令牌和卡密密文保护',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,3);assert.equal(list.data.rows[0].rid,3);assert.equal(list.data.rows[0].pay_type_label,'未知方式 (9)');assert.equal(list.data.rows.find((r:any)=>r.rid===1).pay_type_label,'TRX 余额');assert.equal(list.data.rows.find((r:any)=>r.rid===2).pay_type_label,'USDT 余额')
  assert.equal((await call('GET','?botRid=8')).data.total,2);assert.equal((await call('GET','?cdkey=CARD')).data.total,3);assert.equal((await call('GET','?cdkey=%25')).data.total,1);assert.equal(JSON.stringify(list.data).includes('cipher-secret'),false);assert.equal(JSON.stringify(list.data).includes('never-return-this'),false)
  const options=await call('GET','?action=options');assert.equal(options.data.bots.length,2);assert.equal(JSON.stringify(options.data).includes('another-secret'),false);assert.equal(list.data.canUpdate,true);assert.equal((await call('GET','',undefined,readerToken)).data.canUpdate,false);assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('商品订单备注修改、权限、来源和审计',async()=>{
  assert.equal((await call('POST','',{action:'update_comments',rid:1,comments:'updated'},token,'https://evil.test')).response.status,403);assert.equal((await call('POST','',{action:'update_comments',rid:1,comments:'updated'},readerToken)).response.status,403);assert.equal((await call('POST','',{action:'update_comments',rid:999,comments:'updated'})).response.status,404);assert.equal((await call('POST','',{action:'update_comments',rid:1,comments:'updated'})).response.status,200);assert.equal((await pool.query('SELECT comments FROM t_shop_order WHERE rid=1')).rows[0].comments,'updated');const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log')).rows.map(r=>[r.action,Number(r.resource_id)]);assert.deepEqual(audit,[['shop.order.update_comments',1]])
 })
}finally{await pool.end()}
