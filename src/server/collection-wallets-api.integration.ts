import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constants,generateKeyPairSync,privateDecrypt,randomBytes} from 'node:crypto'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_COLLECTION_WALLETS_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_COLLECTION_WALLETS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_collection_wallets_test_')||!parsed.pathname.slice(1).startsWith('tg_collection_wallets_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),dir=mkdtempSync(join(tmpdir(),'collection-wallet-key-')),pubPath=join(dir,'public.pem')
writeFileSync(pubPath,pair.publicKey.export({type:'spki',format:'pem'}))
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://collection-wallets.test',TRON_RSA_PUBLIC_KEY_PATH:pubPath})
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
'CREATE TABLE t_collection_wallet(rid serial PRIMARY KEY,bot_rid int NOT NULL,chain_type varchar(10) NOT NULL DEFAULT \'trc\',wallet_addr varchar(200) NOT NULL,notice_tg_uid varchar(100),notice_tg_groupid varchar(100),trx_collection_amount numeric(16,6) NOT NULL DEFAULT 0,usdt_collection_amount numeric(16,6) NOT NULL DEFAULT 0,trx_reserved_amount numeric(16,6) NOT NULL DEFAULT 0,usdt_reserved_amount numeric(16,6) NOT NULL DEFAULT 0,status smallint NOT NULL DEFAULT 1,create_time timestamp,update_time timestamp,wallet_addr_privatekey varchar(2000),trx_reserve_amount numeric(16,6) NOT NULL DEFAULT 0,usdt_reserve_amount numeric(16,6) NOT NULL DEFAULT 0,collection_wallet_addr varchar(200),permission_id int NOT NULL DEFAULT 0,tg_notice_obj varchar(500),trx_balance numeric(16,6) DEFAULT 0,usdt_balance numeric(16,6) DEFAULT 0,comments varchar(100),last_collection_time timestamp)'
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'collection-admin','x'),(2,'collection-reader','x'),(3,'collection-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),readerToken=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest(token),digest(readerToken),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager'),(2,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'归集管理',NULL,0),(2,'归集钱包','admin.collection.wallet.index',1),(3,'添加归集钱包','admin.collection.wallet.add',2),(4,'修改归集钱包','admin.collection.wallet.update',2),(5,'删除归集钱包','admin.collection.wallet.delete',2),(6,'修改归集钱包','admin.collection.wallet.change_status',2),(7,'修改私钥','admin.collection.wallet.updateprikey',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1),(1,2),(2,2)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Blue Bot','blue_bot','never-return-this'),(9,'Green Bot','green_bot','bot-token-secret')")
await pool.query("INSERT INTO t_collection_wallet(rid,bot_rid,chain_type,wallet_addr,status,wallet_addr_privatekey,permission_id,trx_collection_amount,usdt_collection_amount,trx_reserve_amount,usdt_reserve_amount,collection_wallet_addr,tg_notice_obj,comments,trx_balance,usdt_balance,create_time,last_collection_time) VALUES(1,8,'trc','TOLD001',0,'v2:ciphertext-never-return',3,100,50,10,5,'TCOLLECT001','123,456','existing',20,8,now(),now()),(2,9,'trc','TOLD002',1,NULL,0,0,0,0,0,NULL,NULL,'second',0,0,now(),NULL)")
await pool.query("SELECT setval(pg_get_serial_sequence('t_collection_wallet','rid'),2,true)")
const{collectionWalletsApi}=await import('./collection-wallets-api.server')
async function call(method='GET',query='',body:unknown=undefined,session:string|null=token,origin='https://collection-wallets.test'){
 const headers:Record<string,string>={};if(session)headers.cookie='tg_platform_session='+session;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await collectionWalletsApi(new Request('https://collection-wallets.test/api/collection-wallets'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));return{response,data:await response.json() as Record<string,any>}
}
const form={action:'add',bot_rid:8,chain_type:'trc',wallet_addr:'TNEW001',tg_notice_obj:'10001,10002',trx_collection_amount:'100.123456',usdt_collection_amount:'0',trx_reserve_amount:'10.1',usdt_reserve_amount:'0',collection_wallet_addr:'TCOLLECT002',comments:'new wallet'}
try{
 await test('归集钱包列表筛选、选项、敏感数据隐藏和旧库兼容',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,2);assert.equal(list.data.rows[0].rid,2);assert.equal(list.data.rows.find((row:any)=>row.rid===1).status,0);assert.equal(list.data.rows.find((row:any)=>row.rid===1).wallet_key_configured,true);assert.equal(list.data.rows.find((row:any)=>row.rid===2).last_collection_time,null)
  assert.equal((await call('GET','?bot=8')).data.total,1);assert.equal((await call('GET','?search=TOLD')).data.total,2);assert.equal((await call('GET','?search=existing')).data.total,1);assert.equal((await call('GET','?search=%25')).data.total,0);assert.equal((await call('GET','?page=1&pageSize=10')).data.rows.length,2)
  assert.equal(JSON.stringify(list.data).includes('v2:ciphertext-never-return'),false);assert.equal(JSON.stringify(list.data).includes('never-return-this'),false);const options=await call('GET','?action=options');assert.equal(options.data.bots.length,2);assert.equal(JSON.stringify(options.data).includes('bot-token-secret'),false)
  assert.deepEqual(list.data.permissions,{add:true,update:true,delete:true,status:true,privateKey:true});const reader=await call('GET','',undefined,readerToken);assert.deepEqual(reader.data.permissions,{add:false,update:false,delete:false,status:false,privateKey:false});assert.equal((await call('GET','',undefined,deniedToken)).response.status,403);assert.equal((await call('GET','',undefined,null)).response.status,401)
  await pool.query('ALTER TABLE t_collection_wallet DROP COLUMN last_collection_time');const oldSchema=await call();assert.equal(oldSchema.response.status,200);assert.equal(oldSchema.data.rows[0].last_collection_time,null)
 })
 await test('归集钱包增改删、状态、私钥加密兼容、金额校验、来源权限和审计',async()=>{
  assert.equal((await call('POST','',{...form},token,'https://evil.test')).response.status,403);assert.equal((await call('POST','',{...form},readerToken)).response.status,403);assert.equal((await call('POST','',{...form},token,'https://collection-wallets.test').then(x=>x.response.status)),200)
  assert.equal((await call('POST','',{...form,action:'add',wallet_addr:'TOLD001'})).response.status,409);assert.equal((await call('POST','',{...form,action:'add',trx_reserve_amount:'100.123456'})).response.status,400);assert.equal((await call('POST','',{...form,action:'add',collection_wallet_addr:'TNEW001'})).response.status,400);assert.equal((await call('POST','',{...form,action:'add',bot_rid:999,wallet_addr:'TNEW002'})).response.status,404)
  const added=(await pool.query("SELECT rid,status,trx_collection_amount::text,trx_reserve_amount::text,comments FROM t_collection_wallet WHERE wallet_addr='TNEW001'")).rows[0];assert.equal(Number(added.status),1);assert.equal(added.trx_collection_amount,'100.123456');assert.equal(added.trx_reserve_amount,'10.100000');assert.equal(added.comments,'new wallet')
  assert.equal((await call('POST','',{...form,action:'update',rid:1,wallet_addr:'TNEW003'})).response.status,200);assert.equal((await pool.query('SELECT wallet_addr FROM t_collection_wallet WHERE rid=1')).rows[0].wallet_addr,'TNEW003');assert.equal((await call('POST','',{...form,action:'update',rid:999,wallet_addr:'TNEW004'})).response.status,404)
  const secret='disposable-tron-private-key-0123456789';const saved=await call('POST','',{action:'private-key',rid:Number(added.rid),wallet_addr_privatekey:secret,permission_id:77});assert.equal(saved.response.status,200);assert.equal(JSON.stringify(saved.data).includes(secret),false)
  const encrypted=(await pool.query('SELECT wallet_addr_privatekey,permission_id FROM t_collection_wallet WHERE rid=$1',[added.rid])).rows[0];assert.match(encrypted.wallet_addr_privatekey,/^v2:/);assert.equal(Number(encrypted.permission_id),77);assert.equal(privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(encrypted.wallet_addr_privatekey.slice(3),'base64')).toString(),secret)
  assert.equal((await call('POST','',{action:'status',rid:Number(added.rid),enabled:true})).response.status,200);assert.equal(Number((await pool.query('SELECT status FROM t_collection_wallet WHERE rid=$1',[added.rid])).rows[0].status),0)
  assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404);assert.equal((await call('POST','',{action:'delete',rid:Number(added.rid)})).response.status,200)
  const audit=(await pool.query('SELECT action,resource_id FROM t_platform_audit_log ORDER BY rid')).rows.map(row=>[row.action,Number(row.resource_id)]);assert.deepEqual(audit,[['collection.wallet.add',3],['collection.wallet.update',1],['collection.wallet.private_key',3],['collection.wallet.status',3],['collection.wallet.delete',3]])
 })
}finally{await pool.end();rmSync(dir,{recursive:true,force:true})}
