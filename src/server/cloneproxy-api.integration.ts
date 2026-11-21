import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_CLONEPROXY_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_CLONEPROXY_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_cloneproxy_test_')||!parsed.pathname.slice(1).startsWith('tg_cloneproxy_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://cloneproxy.test'})
process.env.APP_KEY = process.env.APP_KEY || 'test-app-key-' + 'a'.repeat(64)
const pool=new pg.Pool({connectionString:raw})
for(const sql of [
'CREATE TABLE t_admin(id bigint PRIMARY KEY,name text,password text,status smallint DEFAULT 1)',
'CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,session_hash char(64),login_time timestamp,last_seen_at timestamp,expires_at timestamp,revoked_at timestamp)',
'CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint,device_session_id bigint,expires_at timestamp)',
'CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key text,config_val text)',
'CREATE TABLE t_platform_cloudflare_security(rid bigint PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())',
"CREATE TABLE t_roles(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web')",
"CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web',route text,pid int)",
'CREATE TABLE t_model_has_roles(role_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_model_has_permissions(permission_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint)',
'CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint,action text,resource_id bigint)',
"CREATE TABLE t_platform_plugin_lifecycle(plugin_id text PRIMARY KEY,state text NOT NULL,enabled_bot_ids integer[] NOT NULL DEFAULT '{}',disabled_at timestamptz,enabled_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now())",
'CREATE TABLE t_platform_plugin_execution(plugin_id text,task_name text,owner text,lease_until timestamptz,started_at timestamptz DEFAULT now(),PRIMARY KEY(plugin_id,task_name))',
'CREATE TABLE t_platform_cloneproxy_token_waiter(consumed_at timestamptz,expires_at timestamptz)',
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text,bot_token text,recharge_wallet_addr text)',
'CREATE TABLE t_telegram_bot_user(rid bigserial PRIMARY KEY,bot_rid int,tg_uid bigint,cash_usdt numeric(20,6),cash_trx numeric(20,6))',
'CREATE TABLE t_telegram_clone_proxy_config(rid bigserial PRIMARY KEY,master_bot_rid int NOT NULL,is_enable smallint NOT NULL DEFAULT 0,charge_enable smallint NOT NULL DEFAULT 0,merchant_limit int NOT NULL DEFAULT 0,open_price numeric(20,6) NOT NULL DEFAULT 0,default_revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,create_time timestamp,update_time timestamp)',
'CREATE TABLE t_telegram_clone_proxy_merchant(rid bigserial PRIMARY KEY,master_bot_rid int NOT NULL,bot_rid int NOT NULL,owner_tg_uid bigint NOT NULL,owner_tg_username varchar(200) NOT NULL,owner_tg_name varchar(200),bot_token_hash varchar(64) NOT NULL,revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,status smallint NOT NULL DEFAULT 1,total_revenue_usdt numeric(20,6) NOT NULL DEFAULT 0,total_revenue_trx numeric(20,6) NOT NULL DEFAULT 0,webhook_status smallint NOT NULL DEFAULT 0,webhook_error varchar(500),create_time timestamp,update_time timestamp)',
'ty placeholder merchant order',
'CREATE TABLE t_telegram_clone_proxy_order(rid bigserial PRIMARY KEY,merchant_rid bigint,master_bot_rid int NOT NULL,bot_rid int,order_type varchar(30) NOT NULL,source_type varchar(30) NOT NULL DEFAULT \'manual\',source_order_rid bigint,pay_user_tg_uid bigint NOT NULL,pay_user_tg_username varchar(200),amount numeric(20,6) NOT NULL DEFAULT 0,need_pay_amount numeric(20,6) NOT NULL DEFAULT 0,coin_name varchar(20) NOT NULL DEFAULT \'usdt\',payment_method varchar(20) NOT NULL DEFAULT \'free\',status smallint NOT NULL DEFAULT 0,revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,revenue_amount numeric(20,6) NOT NULL DEFAULT 0,external_order_rid bigint,tx_hash varchar(200),comments varchar(1000),create_time timestamp,update_time timestamp,paid_time timestamp,expire_time timestamp,complete_time timestamp)'
]){if(sql==='ty placeholder merchant order')continue;await pool.query(sql)}
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'cloneproxy-admin','x'),(2,'cloneproxy-reader','x'),(3,'cloneproxy-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'克隆/代理',NULL,0),(2,'克隆/代理基础设置','admin.telegram.cloneproxy.basic',1),(3,'克隆/代理商户管理','admin.telegram.cloneproxy.merchants',1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(1,2),(2,2),(3,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token,recharge_wallet_addr) VALUES(8,'Master Bot','master_bot','master-secret','wallet-secret'),(9,'Merchant Bot','merchant_bot','merchant-secret',NULL)")
await pool.query("INSERT INTO t_telegram_clone_proxy_config(rid,master_bot_rid,is_enable,charge_enable,merchant_limit,open_price,default_revenue_ratio,create_time) VALUES(1,8,1,1,5,12.500000,20,now())")
await pool.query("INSERT INTO t_telegram_clone_proxy_merchant(rid,master_bot_rid,bot_rid,owner_tg_uid,owner_tg_username,owner_tg_name,bot_token_hash,revenue_ratio,status,total_revenue_usdt,total_revenue_trx,webhook_status,webhook_error,create_time) VALUES(1,8,9,9001,'alice','Alice','hash-secret-1',15,1,100.5,8.25,1,NULL,now()),(2,8,9,9002,'bob','Bob','hash-secret-2',12.5,2,2,0,2,'webhook issue',now())")
await pool.query("INSERT INTO t_telegram_bot_user(bot_rid,tg_uid,cash_usdt,cash_trx) VALUES(8,9001,35.25,4.5)")
await pool.query("INSERT INTO t_telegram_clone_proxy_order(rid,merchant_rid,master_bot_rid,bot_rid,order_type,source_type,source_order_rid,pay_user_tg_uid,pay_user_tg_username,amount,need_pay_amount,coin_name,payment_method,status,revenue_ratio,revenue_amount,external_order_rid,tx_hash,comments,create_time) VALUES(10,1,8,9,'revenue','source',777,100,'payer',8,9,'usdt','chain',2,15,1.2,4,'0x1234567890abcdef1234567890abcdef','ledger',now()),(11,1,8,9,'opening','manual',NULL,101,'newpayer',12,12,'usdt','pending',0,0,0,NULL,NULL,'opening',now()),(12,1,8,9,'revenue','source',778,102,'removed',4,5,'trx','balance',4,15,0.5,5,'0xfedcba9876543210fedcba9876543210','already hidden',now()),(13,2,8,9,'revenue','source',779,103,'other',1,1,'trx','free',2,5,0.1,6,NULL,'other merchant',now())")
const{cloneProxyApi}=await import('./cloneproxy-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://cloneproxy.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await cloneProxyApi(new Request('https://cloneproxy.test/api/cloneproxy'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
try{
 await test('生命周期接口拒绝无权限并保护商户与待处理订单',async()=>{
  assert.equal((await call('GET','?action=lifecycle',undefined,deniedToken)).response.status,403)
  assert.equal((await call('POST','',{action:'lifecycle_disable'},deniedToken)).response.status,403)
  assert.equal((await call('POST','',{action:'lifecycle_uninstall'})).response.status,409)
  assert.equal((await call('POST','',{action:'lifecycle_disable'})).data.state,'draining')
  assert.equal((await call('GET','?action=lifecycle')).data.state,'draining')
  assert.equal((await call('POST','',{action:'config_save',master_bot_rid:8,is_enable:true,charge_enable:true,open_price:1,default_revenue_ratio:0,merchant_limit:0})).response.status,409)
  assert.equal((await call('POST','',{action:'lifecycle_uninstall'})).response.status,409)
  assert.equal((await call('POST','',{action:'lifecycle_resume'})).data.state,'active')
 })
 await test('基础设置、机器人选项、可用名额和访问控制',async()=>{
  const config=await call('GET','?action=config');assert.equal(config.response.status,200);assert.equal(config.data.config.active_count,1);assert.equal(config.data.config.idle_quantity,4);assert.equal(config.data.bots.length,2);assert.equal(JSON.stringify(config.data).includes('wallet-secret'),false);assert.equal(JSON.stringify(config.data).includes('master-secret'),false)
  const reader=await call('GET','?action=config',undefined,readerToken);assert.equal(reader.response.status,200);assert.equal((await call('GET','?action=config',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','?action=config',undefined,null)).response.status,401)
  assert.equal((await call('POST','',{action:'config_save',master_bot_rid:8,is_enable:false,charge_enable:false,open_price:25.1234567,default_revenue_ratio:125.25,merchant_limit:9},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'config_save',master_bot_rid:999,is_enable:true,charge_enable:true,open_price:1,default_revenue_ratio:0,merchant_limit:0})).response.status,400)
  assert.equal((await call('POST','',{action:'config_save',master_bot_rid:8,is_enable:false,charge_enable:true,open_price:25.1234567,default_revenue_ratio:125.25,merchant_limit:9})).response.status,200)
  const saved=(await pool.query('SELECT is_enable,charge_enable,merchant_limit,open_price::text,default_revenue_ratio::text FROM t_telegram_clone_proxy_config WHERE rid=1')).rows[0];assert.deepEqual([saved.is_enable,saved.charge_enable,saved.merchant_limit,saved.open_price,saved.default_revenue_ratio],[0,1,9,'25.123457','125.25'])
 })
 await test('商户搜索、详情脱敏、收益调整、状态与权限',async()=>{
  const list=await call('GET','?action=merchants&page=1&pageSize=10');assert.equal(list.data.total,2);assert.equal(Number(list.data.rows[0].rid),2);assert.equal((await call('GET','?action=merchants&keyword=alice')).data.total,1);assert.equal((await call('GET','?action=merchants&keyword=9002')).data.total,1)
  const detail=await call('GET','?action=detail&rid=1');assert.equal(detail.response.status,200);assert.equal(detail.data.merchant.master_cash_usdt,35.25);assert.equal(detail.data.merchant.bot_token_masked,'merchant…cret');assert.equal(JSON.stringify(detail.data).includes('merchant-secret'),false)
  assert.equal((await call('POST','',{action:'merchant_update',rid:1,revenue_ratio:99.25,status:'2'})).response.status,200);const updated=(await pool.query('SELECT revenue_ratio::text,status FROM t_telegram_clone_proxy_merchant WHERE rid=1')).rows[0];assert.deepEqual([updated.revenue_ratio,updated.status],['99.25',2])
  assert.equal((await call('POST','',{action:'merchant_status',rid:1,status:1})).response.status,200);assert.equal(Number((await pool.query('SELECT status FROM t_telegram_clone_proxy_merchant WHERE rid=1')).rows[0].status),1)
  assert.equal((await call('POST','',{action:'merchant_update',rid:1,revenue_ratio:151})).response.status,400);assert.equal((await call('POST','',{action:'merchant_status',rid:999,status:1})).response.status,404);assert.equal((await call('GET','?action=merchants',undefined,deniedToken)).response.status,403)
 })
 await test('商户订单分类、密文摘要脱敏和账本软删除边界',async()=>{
  const revenue=await call('GET','?action=orders&rid=1&type=revenue');assert.equal(revenue.data.total,1);assert.equal(revenue.data.rows[0].payment_method_text,'链上支付');assert.equal(revenue.data.rows[0].tx_hash_masked,'0x123456…90abcdef');assert.equal(JSON.stringify(revenue.data).includes('0x1234567890abcdef1234567890abcdef'),false)
  const opening=await call('GET','?action=orders&rid=1&type=opening');assert.equal(opening.data.total,1);assert.equal(opening.data.rows[0].status_text,'待支付');assert.equal((await call('GET','?action=orders&rid=999&type=opening')).data.total,0)
  assert.equal((await call('POST','',{action:'orders_soft_delete',rid:1,type:'revenue',rids:[10,11,13]})).response.status,200);const orders=(await pool.query('SELECT rid,status,comments,source_order_rid FROM t_telegram_clone_proxy_order ORDER BY rid')).rows;assert.deepEqual(orders.map(x=>[Number(x.rid),Number(x.status)]),[[10,4],[11,0],[12,4],[13,2]]);assert.equal(Number(orders[0].source_order_rid),777);assert.equal(orders[0].comments,'后台批量删除（账本保留）');assert.equal((await call('GET','?action=orders&rid=1&type=revenue')).data.total,0)
  assert.equal((await call('POST','',{action:'orders_soft_delete',rid:1,type:'opening',rids:[]})).response.status,400)
 })
}finally{await pool.end()}
