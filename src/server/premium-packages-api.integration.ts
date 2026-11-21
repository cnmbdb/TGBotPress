import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtemp,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_PREMIUM_PACKAGE_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_PREMIUM_PACKAGE_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_premium_package_test_')||!parsed.pathname.slice(1).startsWith('tg_premium_package_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
const storageRoot=await mkdtemp(path.join(tmpdir(),'tg-premium-package-test-'))
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://premium-package.test',MEDIA_STORAGE_ROOT:storageRoot,MEDIA_PUBLIC_ORIGIN:'https://media.premium-package.test'})
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
'CREATE TABLE t_premium_platform(rid int PRIMARY KEY,bot_rid int,platform_name smallint,status smallint)',
"CREATE TABLE t_premium_platform_package(rid serial PRIMARY KEY,bot_rid int NOT NULL,premium_platform_rid int NOT NULL,package_name varchar(50) NOT NULL,package_month int NOT NULL,usdt_price numeric(14,2) NOT NULL,callback_data varchar(50) NOT NULL,seq_sn int DEFAULT 0 NOT NULL,status smallint DEFAULT 1 NOT NULL,show_notes varchar(1000),package_pic varchar(200),comments varchar(255),create_time timestamp NOT NULL,update_time timestamp)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'premium-package-admin','x'),(2,'premium-package-no-permission','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day'),($2,2,12,now()+interval '1 day')",[digest(token),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'会员管理',NULL,0),(2,'会员套餐',NULL,1),(3,'添加会员套餐','admin.premium.package.add',2),(4,'修改能量套餐','admin.premium.package.update',2),(5,'删除能量套餐','admin.premium.package.delete',2),(6,'复制会员套餐','admin.premium.package.copy_paste',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username,bot_token) VALUES(8,'Bot Eight','bot_eight','never-return-this'),(9,'Bot Nine','bot_nine','secret-token')")
await pool.query("INSERT INTO t_premium_platform(rid,bot_rid,platform_name,status) VALUES(10,8,1,0),(11,9,1,0),(12,9,1,1)")
await pool.query("INSERT INTO t_premium_platform_package(rid,bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,status,show_notes,package_pic,comments,create_time) VALUES(1,8,10,'Gold 3 months',3,5.50,'premium-old-1',1,0,'source note','https://media.test/old.png','private',now()),(2,8,10,'Gold 12 months',12,15.00,'premium-old-2',2,1,'second source',NULL,'private',now()),(3,9,11,'Target old package',6,8.00,'premium-target',9,1,'replace me',NULL,NULL,now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_premium_platform_package','rid'),3,true)")
const {premiumPackagesApi}=await import('./premium-packages-api.server')
async function call(method='GET',query='',body?:unknown,session=token,origin='https://premium-package.test'){
 const headers:Record<string,string>={cookie:'tg_platform_session='+session};let requestBody:BodyInit|undefined
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}
 const response=await premiumPackagesApi(new Request('https://premium-package.test/api/premium-packages'+query,{method,headers,body:requestBody}))
 return{response,data:await response.json() as Record<string,any>}
}
async function upload(body:Record<string,unknown>,file:File,origin='https://premium-package.test'){
 const form=new FormData();form.set('payload',JSON.stringify(body));form.set('thumb',file)
 const response=await premiumPackagesApi(new Request('https://premium-package.test/api/premium-packages',{method:'POST',headers:{cookie:'tg_platform_session='+token,origin},body:form}))
 return{response,data:await response.json() as Record<string,any>}
}
const packageForm={premium_platform_rid:10,package_name:'Silver plan',package_month:6,usdt_price:'12.99',seq_sn:4,show_notes:'six month plan'}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=','base64')
try{
 await test('会员套餐列表筛选、分页、平台选项、单项详情与权限',async()=>{
  const list=await call();assert.equal(list.response.status,200);assert.equal(list.data.total,3);assert.equal(list.data.rows[0].package_name,'Target old package')
  assert.equal((await call('GET','?search=Gold&botRid=8')).data.total,2);assert.equal((await call('GET','?search=12 months')).data.total,1);assert.equal((await call('GET','?pageSize=10')).data.pageSize,10)
  const options=await call('GET','?action=options');assert.equal(options.data.platforms.length,3);assert.equal(JSON.stringify(options.data).includes('never-return-this'),false)
  const detail=await call('GET','?action=show&rid=1');assert.equal(detail.response.status,200);assert.equal(detail.data.row.package_pic,'https://media.test/old.png')
  assert.equal((await call('GET','?action=show&rid=999')).response.status,404)
  assert.equal(list.data.canAdd,true);assert.equal(list.data.canEdit,true);assert.equal(list.data.canDelete,true);assert.equal(list.data.canStatus,true);assert.equal(list.data.canCopy,true)
  assert.equal((await call('GET','',undefined,deniedToken)).response.status,403)
 })
 await test('套餐创建/编辑/图片上传校验/状态/删除/覆盖复制及审计',async()=>{
  assert.equal((await call('POST','',{action:'create',...packageForm},token,'https://evil.test')).response.status,403)
  assert.equal((await call('POST','',{action:'create',...packageForm,usdt_price:'0'})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...packageForm,package_month:9})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...packageForm,premium_platform_rid:999})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...packageForm})).response.status,200)
  const created=(await pool.query("SELECT rid,bot_rid,premium_platform_rid,callback_data,status,package_pic FROM t_premium_platform_package WHERE package_name='Silver plan'")).rows[0]
  assert.equal(Number(created.bot_rid),8);assert.equal(Number(created.status),1);assert.equal(created.callback_data.startsWith('premium_'),true);assert.equal(created.package_pic,null)
  const image=await upload({action:'update',rid:1,premium_platform_rid:10,package_name:'Gold 3 months',package_month:3,usdt_price:'6.25',seq_sn:1,show_notes:'with image'},new File([png],'tiny.png',{type:'image/png'}))
  assert.equal(image.response.status,200)
  const uploaded=(await pool.query('SELECT package_pic,usdt_price,show_notes FROM t_premium_platform_package WHERE rid=1')).rows[0]
  assert.match(uploaded.package_pic,/^https:\/\/media\.premium-package\.test\/storage\/news\//);assert.equal(uploaded.usdt_price,'6.25');assert.equal(uploaded.show_notes,'with image')
  const relative=uploaded.package_pic.split('/storage/')[1];await access(path.join(storageRoot,relative))
  assert.equal((await upload({action:'update',rid:1,premium_platform_rid:10,package_name:'Gold 3 months',package_month:3,usdt_price:'7.00',seq_sn:1,show_notes:'preserve image'},new File(['not-an-image'],'invalid.txt',{type:'text/plain'}))).response.status,400)
  assert.equal((await pool.query('SELECT package_pic FROM t_premium_platform_package WHERE rid=1')).rows[0].package_pic,uploaded.package_pic)
  assert.equal((await call('POST','',{action:'status',rid:1,enabled:true})).response.status,200)
  assert.equal(Number((await pool.query('SELECT status FROM t_premium_platform_package WHERE rid=1')).rows[0].status),0)
  assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  assert.equal((await call('POST','',{action:'copy',sourcePlatformRid:10,targetPlatformRid:10})).response.status,400)
  assert.equal((await call('POST','',{action:'copy',sourcePlatformRid:12,targetPlatformRid:11})).response.status,400)
  assert.equal((await call('POST','',{action:'copy',sourcePlatformRid:10,targetPlatformRid:11})).response.status,200)
  const copied=(await pool.query('SELECT bot_rid,premium_platform_rid,package_name,status,show_notes,package_pic,callback_data FROM t_premium_platform_package WHERE premium_platform_rid=11 ORDER BY rid')).rows
  assert.equal(copied.length,3);assert.equal(Number(copied[0].bot_rid),9);assert.equal(Number(copied[0].premium_platform_rid),11);assert.equal(copied[0].show_notes,'with image');assert.equal(copied[0].package_pic,uploaded.package_pic);assert.notEqual(copied[0].callback_data,'premium-old-1')
  assert.equal((await call('POST','',{action:'delete',rid:Number(created.rid)})).response.status,200)
  const actions=(await pool.query('SELECT action FROM t_platform_audit_log ORDER BY rid')).rows.map(r=>r.action)
  assert.deepEqual(actions,['admin.premium.package.create','admin.premium.package.update','admin.premium.package.status','admin.premium.package.copy','admin.premium.package.delete'])
 })
}finally{await pool.end();await rm(storageRoot,{recursive:true,force:true})}
