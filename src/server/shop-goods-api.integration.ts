import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_SHOP_GOODS_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_SHOP_GOODS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_shop_goods_test_')||!parsed.pathname.slice(1).startsWith('tg_shop_goods_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://shop-goods.test'})
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
'CREATE TABLE t_shop_goods(rid serial PRIMARY KEY,goods_name varchar(50) NOT NULL,goods_type smallint NOT NULL,goods_usdt_price numeric(16,4) NOT NULL DEFAULT 0,goods_trx_price numeric(16,4) NOT NULL DEFAULT 0,show_notes varchar(1000),status smallint NOT NULL DEFAULT 1,seq_sn int NOT NULL DEFAULT 0,comments varchar(3000),create_time timestamp NOT NULL,update_time timestamp)',
'CREATE TABLE t_shop_goods_cdkey(rid serial PRIMARY KEY,goods_rid int)',
'CREATE TABLE t_shop_goods_bot(rid serial PRIMARY KEY,goods_rid int)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'shop-goods-admin','x'),(2,'shop-goods-reader','x'),(3,'shop-goods-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'商城管理',NULL,0),(2,'商品管理','admin.shop.goods.index',1),(3,'添加商品','admin.shop.goods.add',2),(4,'修改商品','admin.shop.goods.update',2),(5,'删除商品','admin.shop.goods.delete',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_shop_goods(rid,goods_name,goods_type,goods_usdt_price,goods_trx_price,status,seq_sn,show_notes,comments,create_time) VALUES(1,'Gold Card',1,5.2500,25.5000,0,1,'display notes','existing',now()),(2,'Silver Card',1,0,0,1,2,'','second',now()),(3,'Linked Card',1,1,2,1,3,'','linked',now())")
await pool.query('INSERT INTO t_shop_goods_cdkey(goods_rid) VALUES(3)')
await pool.query("SELECT setval(pg_get_serial_sequence('t_shop_goods','rid'),3,true)")
const{shopGoodsApi}=await import('./shop-goods-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://shop-goods.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await shopGoodsApi(new Request('https://shop-goods.test/api/shop-goods'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const form={goods_name:'New Card',goods_trx_price:'12.3456',goods_usdt_price:'2.7500',goods_type:1,show_notes:'shown to users',seq_sn:8,comments:'admin note'}
try{
 await test('商品搜索、排序、价格类型映射和菜单权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,3);assert.equal(list.data.rows[0].rid,3);const gold=list.data.rows.find((row:any)=>row.rid===1);assert.equal(gold.enabled,true);assert.equal(gold.goods_type_label,'虚拟卡密');assert.equal(gold.goods_usdt_price,'5.2500');assert.equal(gold.show_notes,'display notes');assert.equal((await call('GET','?search=Gold')).data.total,1);assert.equal((await call('GET','?search=%25')).data.total,0)
  assert.equal(list.data.canAdd,true);assert.equal(list.data.canEdit,true);assert.equal(list.data.canDelete,true);assert.equal(list.data.canChangeStatus,true);const reader=await call('GET','',undefined,readerToken);assert.equal(reader.response.status,200);assert.equal(reader.data.canAdd,false);assert.equal(reader.data.canEdit,false);assert.equal(reader.data.canDelete,false);assert.equal(reader.data.canChangeStatus,true);assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('商品创建编辑、状态、关联项删除保护、来源验证与审计',async()=>{
  assert.equal((await call('POST','',{action:'create',...form},token,'https://evil.test')).response.status,403);assert.equal((await call('POST','',{action:'create',...form},readerToken)).response.status,403)
  assert.equal((await call('POST','',{action:'create',...form,goods_name:'Gold Card'})).response.status,409);assert.equal((await call('POST','',{action:'create',...form,goods_name:'Invalid',goods_type:2})).response.status,400);assert.equal((await call('POST','',{action:'create',...form})).response.status,200)
  const added=(await pool.query("SELECT rid,goods_type,goods_trx_price::text,goods_usdt_price::text,status,seq_sn,show_notes,comments FROM t_shop_goods WHERE goods_name='New Card'")).rows[0];assert.equal(Number(added.status),1);assert.equal(added.goods_trx_price,'12.3456');assert.equal(added.goods_usdt_price,'2.7500');assert.equal(added.show_notes,'shown to users')
  assert.equal((await call('POST','',{action:'update',rid:Number(added.rid),...form,goods_name:'Updated Card'})).response.status,200);assert.equal((await pool.query('SELECT goods_name FROM t_shop_goods WHERE rid=$1',[added.rid])).rows[0].goods_name,'Updated Card');assert.equal((await call('POST','',{action:'update',rid:999,...form})).response.status,404)
  assert.equal((await call('POST','',{action:'set_status',rid:Number(added.rid),enabled:true})).response.status,200);assert.equal(Number((await pool.query('SELECT status FROM t_shop_goods WHERE rid=$1',[added.rid])).rows[0].status),0)
  assert.equal((await call('POST','',{action:'delete',rid:3})).response.status,409);assert.equal((await call('POST','',{action:'delete',rid:Number(added.rid)})).response.status,200);assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(row=>[row.action,Number(row.resource_id)]);assert.deepEqual(audit,[['shop.goods.create',4],['shop.goods.update',4],['shop.goods.set_status',4],['shop.goods.delete',4]])
 })
}finally{await pool.end()}
