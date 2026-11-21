import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_SHOP_BOT_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_SHOP_BOT_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_shop_bot_test_')||!parsed.pathname.slice(1).startsWith('tg_shop_bot_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://shop-bots.test'})
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
'CREATE TABLE t_shop_goods(rid int PRIMARY KEY,goods_name varchar(50))',
'CREATE TABLE t_shop_goods_bot(rid serial PRIMARY KEY,goods_rid int NOT NULL,bot_rid int NOT NULL,goods_usdt_discount numeric(4,2) NOT NULL DEFAULT 1,goods_trx_discount numeric(4,2) NOT NULL DEFAULT 1,status smallint NOT NULL DEFAULT 1,comments varchar(3000),create_time timestamp NOT NULL,update_time timestamp)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'shop-bot-admin','x'),(2,'shop-bot-reader','x'),(3,'shop-bot-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'商城管理',NULL,0),(2,'机器人商品','admin.shop.bot.index',1),(3,'添加机器人商品','admin.shop.bot.add',2),(4,'修改机器人商品','admin.shop.bot.update',2),(5,'删除机器人商品','admin.shop.bot.delete',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Blue Bot','blue_bot','never-return-this'),(9,'Red Bot','red_bot','another-secret')")
await pool.query("INSERT INTO t_shop_goods(rid,goods_name) VALUES(20,'Gold Card'),(21,'Silver Card'),(22,'Bronze Card')")
await pool.query("INSERT INTO t_shop_goods_bot(rid,goods_rid,bot_rid,goods_usdt_discount,goods_trx_discount,status,comments,create_time) VALUES(1,20,8,0.80,0.75,0,'existing',now()),(2,21,9,1,0.95,1,'second',now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_shop_goods_bot','rid'),2,true)")
const{shopBotApi}=await import('./shop-bot-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://shop-bots.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await shopBotApi(new Request('https://shop-bots.test/api/shop-bots'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const form={bot_rid:8,goods_rid:22,goods_usdt_discount:'0.90',goods_trx_discount:'0.85',comments:'configured'}
try{
 await test('机器人商品筛选、选项、令牌脱敏和访问权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].rid,2);assert.equal(list.data.rows[1].enabled,true);assert.equal(list.data.rows[0].bot_token_configured,true);assert.equal(JSON.stringify(list.data).includes('never-return-this'),false);assert.equal(JSON.stringify(list.data).includes('another-secret'),false)
  assert.equal((await call('GET','?botRid=8')).data.total,1);assert.equal((await call('GET','?goodsName=Gold')).data.total,1);assert.equal((await call('GET','?goodsName=%25')).data.total,0)
  const options=await call('GET','?action=options');assert.equal(options.data.bots.length,2);assert.equal(options.data.goods.length,3);assert.equal(JSON.stringify(options.data).includes('never-return-this'),false)
  assert.deepEqual({add:list.data.canAdd,edit:list.data.canEdit,delete:list.data.canDelete,status:list.data.canChangeStatus},{add:true,edit:true,delete:true,status:true});const reader=await call('GET','',undefined,readerToken);assert.equal(reader.data.canAdd,false);assert.equal(reader.data.canChangeStatus,true);assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('机器人商品增改删、状态、重复与关联校验、来源权限审计',async()=>{
  assert.equal((await call('POST','',{action:'create',...form},token,'https://evil.test')).response.status,403);assert.equal((await call('POST','',{action:'create',...form},readerToken)).response.status,403);assert.equal((await call('POST','',{action:'create',...form,bot_rid:8,goods_rid:20})).response.status,409);assert.equal((await call('POST','',{action:'create',...form,goods_usdt_discount:'0'})).response.status,400);assert.equal((await call('POST','',{action:'create',...form,goods_rid:999})).response.status,404);assert.equal((await call('POST','',{action:'create',...form})).response.status,200)
  const added=(await pool.query("SELECT rid,status,goods_usdt_discount::text,goods_trx_discount::text,comments FROM t_shop_goods_bot WHERE goods_rid=22 AND bot_rid=8")).rows[0];assert.equal(Number(added.status),1);assert.equal(added.goods_usdt_discount,'0.90');assert.equal(added.goods_trx_discount,'0.85')
  assert.equal((await call('POST','',{action:'update',rid:1,...form,bot_rid:9,goods_rid:21})).response.status,409);assert.equal((await call('POST','',{action:'update',rid:999,...form})).response.status,404);assert.equal((await call('POST','',{action:'update',rid:1,...form,bot_rid:8,goods_rid:21,comments:'edited'})).response.status,200);assert.equal((await pool.query('SELECT comments FROM t_shop_goods_bot WHERE rid=1')).rows[0].comments,'edited')
  assert.equal((await call('POST','',{action:'set_status',rid:1,enabled:true})).response.status,200);assert.equal(Number((await pool.query('SELECT status FROM t_shop_goods_bot WHERE rid=1')).rows[0].status),0);assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404);assert.equal((await call('POST','',{action:'delete',rid:Number(added.rid)})).response.status,200)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(row=>[row.action,Number(row.resource_id)]);assert.deepEqual(audit,[['shop.bot_goods.create',3],['shop.bot_goods.update',1],['shop.bot_goods.set_status',1],['shop.bot_goods.delete',3]])
 })
}finally{await pool.end()}
