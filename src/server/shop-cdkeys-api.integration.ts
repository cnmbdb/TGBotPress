import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constants,generateKeyPairSync,privateDecrypt,publicEncrypt,randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_SHOP_CDKEYS_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_SHOP_CDKEYS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_shop_cdkeys_test_')||!parsed.pathname.slice(1).startsWith('tg_shop_cdkeys_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),pub=pair.publicKey.export({type:'spki',format:'pem'}).toString(),priv=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://shop-cdkeys.test',TRON_RSA_PUBLIC_KEY:pub,TRON_RSA_PRIVATE_KEY:priv})
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
'CREATE TABLE t_shop_goods(rid int PRIMARY KEY,goods_name varchar(50))',
'CREATE TABLE t_shop_goods_cdkey(rid serial PRIMARY KEY,goods_rid int NOT NULL,cdkey_no varchar(100) NOT NULL,cdkey_pwd varchar(2000) NOT NULL,cdkey_usdt_price numeric(16,4) NOT NULL DEFAULT 0,cdkey_trx_price numeric(16,4) NOT NULL DEFAULT 0,status smallint NOT NULL DEFAULT 0,seq_sn int NOT NULL DEFAULT 0,create_time timestamp NOT NULL,update_time timestamp)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'shop-cdkeys-admin','x'),(2,'shop-cdkeys-viewer','x'),(3,'shop-cdkeys-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),viewerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(viewerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'viewer')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'商城管理',NULL,0),(2,'卡密管理','admin.shop.cdkey.index',1),(3,'查看卡密','admin.shop.cdkey.show',2),(4,'添加卡密','admin.shop.cdkey.add',2),(5,'批量添加','admin.shop.cdkey.batchadd',2),(6,'修改卡密','admin.shop.cdkey.update',2),(7,'删除卡密','admin.shop.cdkey.delete',2),(8,'批量上架','admin.shop.cdkey.batchshang',2),(9,'批量下架','admin.shop.cdkey.batchxia',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1),(8,1),(9,1),(1,2),(2,2),(3,2)')
await pool.query("INSERT INTO t_shop_goods(rid,goods_name) VALUES(10,'Gold Card'),(11,'Silver Card')")
const seedCipher='v2:'+requireCipher('old-credential',pair.publicKey)
await pool.query("INSERT INTO t_shop_goods_cdkey(rid,goods_rid,cdkey_no,cdkey_pwd,cdkey_trx_price,cdkey_usdt_price,status,seq_sn,create_time) VALUES(1,10,'CARD-OLD',$1,2.5000,1.2500,0,3,now()),(2,10,'CARD-SOLD',$2,4,2,2,4,now())",[seedCipher,'v2:'+requireCipher('sold-credential',pair.publicKey)])
await pool.query("SELECT setval(pg_get_serial_sequence('t_shop_goods_cdkey','rid'),2,true)")
function requireCipher(value:string,key:any){const encrypted=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(value));return encrypted.toString('base64')}
const{shopCdkeysApi}=await import('./shop-cdkeys-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://shop-cdkeys.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await shopCdkeysApi(new Request('https://shop-cdkeys.test/api/shop-cdkeys'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const privateDecryptSecret=(stored:string)=>privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(stored.slice(3),'base64')).toString()
try{
 await test('卡密列表筛选、状态映射、密文脱敏和逐项权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].rid,2);assert.equal(list.data.rows[0].status_label,'已售卖');assert.equal(list.data.rows[1].status_label,'待上架');assert.equal(list.data.rows[1].cdkey_pwd_masked,'••••••••');assert.equal(JSON.stringify(list.data).includes('old-credential'),false);assert.equal(JSON.stringify(list.data).includes('v2:'),false)
  assert.equal((await call('GET','?goodsRid=10')).data.total,2);assert.equal((await call('GET','?goodsRid=11')).data.total,0);assert.equal((await call('GET','?cdkey=CARD')).data.total,2);assert.equal((await call('GET','?cdkey=%25')).data.total,0)
  const options=await call('GET','?action=options');assert.equal(options.data.goods.length,2);assert.deepEqual({add:list.data.canAdd,batchAdd:list.data.canBatchAdd,view:list.data.canView,edit:list.data.canEdit,delete:list.data.canDelete,publish:list.data.canBatchPublish,unpublish:list.data.canBatchUnpublish},{add:true,batchAdd:true,view:true,edit:true,delete:true,publish:true,unpublish:true})
  const viewer=await call('GET','',undefined,viewerToken);assert.equal(viewer.data.canAdd,false);assert.equal(viewer.data.canView,true);assert.equal(viewer.data.canEdit,false);assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
 })
 await test('卡密新增/批量导入/编辑/揭示/批量上下架/删除和审计',async()=>{
  assert.equal((await call('POST','',{action:'add',goods_rid:10,cdkey_no:'CARD-NEW',cdkey_pwd:'new-credential',cdkey_trx_price:'3.25',cdkey_usdt_price:'1.75',seq_sn:6},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'add',goods_rid:10,cdkey_no:'CARD-OLD',cdkey_pwd:'x'})).response.status,409);assert.equal((await call('POST','',{action:'add',goods_rid:99,cdkey_no:'CARD-X',cdkey_pwd:'x'})).response.status,404);assert.equal((await call('POST','',{action:'add',goods_rid:10,cdkey_no:'CARD-NEW',cdkey_pwd:'new-credential',cdkey_trx_price:'3.25',cdkey_usdt_price:'1.75',seq_sn:6})).response.status,200)
  let added=(await pool.query("SELECT rid,cdkey_pwd,status,cdkey_trx_price::text FROM t_shop_goods_cdkey WHERE cdkey_no='CARD-NEW'")).rows[0];assert.equal(added.status,0);assert.match(added.cdkey_pwd,/^v2:/);assert.equal(privateDecryptSecret(added.cdkey_pwd),'new-credential')
  const batch=await call('POST','',{action:'batch_add',goods_rid:11,lines:'BATCH-1,batch-secret-1\nBATCH-2,batch-secret-2\nBATCH-1,duplicate-secret\nCARD-OLD,already-present',cdkey_trx_price:'0.25',cdkey_usdt_price:'0.5',seq_sn:9});assert.equal(batch.response.status,200);assert.equal(batch.data.created,2);assert.equal(batch.data.skipped,2)
  assert.equal((await call('POST','',{action:'batch_add',goods_rid:11,lines:'VALID,secret\nBROKEN',cdkey_trx_price:'0',cdkey_usdt_price:'0'})).response.status,400)
  const viewerReveal=await call('POST','',{action:'reveal',rid:Number(added.rid)},viewerToken);assert.equal(viewerReveal.response.status,200);assert.equal(viewerReveal.data.cdkey_pwd,'new-credential')
  const updated=await call('POST','',{action:'update',rid:Number(added.rid),goods_rid:11,cdkey_no:'CARD-NEW-EDITED',cdkey_trx_price:'4',cdkey_usdt_price:'2',status:1,seq_sn:10});assert.equal(updated.response.status,200);added=(await pool.query('SELECT rid,cdkey_pwd,status FROM t_shop_goods_cdkey WHERE rid=$1',[added.rid])).rows[0];assert.equal(privateDecryptSecret(added.cdkey_pwd),'new-credential');assert.equal(added.status,1)
  const published=await call('POST','',{action:'set_product_status',goods_rid:11,status:1});assert.equal(published.response.status,200);assert.equal(published.data.updated,2);assert.equal(Number((await pool.query("SELECT status FROM t_shop_goods_cdkey WHERE cdkey_no='BATCH-1'")).rows[0].status),1);assert.equal(Number((await pool.query("SELECT status FROM t_shop_goods_cdkey WHERE cdkey_no='CARD-SOLD'")).rows[0].status),2)
  assert.equal((await call('POST','',{action:'set_product_status',goods_rid:10,status:0})).response.status,200);assert.equal((await call('POST','',{action:'set_product_status',goods_rid:99,status:1})).response.status,404)
  assert.equal((await call('POST','',{action:'delete',rid:Number(added.rid)})).response.status,200)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(r=>[r.action,Number(r.resource_id)]);assert.deepEqual(audit,[['shop.cdkey.add',3],['shop.cdkey.batch_add',4],['shop.cdkey.batch_add',5],['shop.cdkey.reveal',3],['shop.cdkey.update',3],['shop.cdkey.batch_publish',11],['shop.cdkey.batch_unpublish',10],['shop.cdkey.delete',3]])
 })
}finally{await pool.end()}
