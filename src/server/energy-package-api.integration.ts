import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {rm} from 'node:fs/promises'
import pg from 'pg'
import {digest} from './security'

const raw=process.env.TG_ENERGY_PACKAGE_TEST_DB_URL, parsed=raw?new URL(raw):null, octets=parsed?.hostname.split('.').map(Number)
const privateHost=parsed?.hostname==='postgres'||(process.env.TG_ENERGY_PACKAGE_TEST_ALLOW_PRIVATE_DB==='1'&&octets?.length===4&&octets[0]===172&&octets[1]>=16&&octets[1]<=31)
if(!raw||!parsed||!privateHost||!parsed.username.startsWith('tg_energy_package_test_')||!parsed.pathname.slice(1).startsWith('tg_energy_package_test_'))throw Error('Requires disposable PostgreSQL test database and role')
const mediaRoot='/tmp/tg-energy-package-test-'+process.pid
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,PLATFORM_ORIGIN:'https://energy-package.test',MEDIA_STORAGE_ROOT:mediaRoot,MEDIA_PUBLIC_ORIGIN:'https://media.example.test'})
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
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text)',
"CREATE TABLE t_energy_platform_package(rid serial PRIMARY KEY,bot_rid int NOT NULL,package_type smallint DEFAULT 1 NOT NULL,package_name varchar(50) NOT NULL,energy_amount int NOT NULL,energy_day smallint NOT NULL,trx_price numeric(14,2) DEFAULT 0 NOT NULL,usdt_price numeric(14,2) DEFAULT 0 NOT NULL,status smallint DEFAULT 1 NOT NULL,seq_sn int DEFAULT 0 NOT NULL,create_by int,create_time timestamp,update_by int,update_time timestamp,callback_data varchar(50) NOT NULL,show_notes varchar(1000),package_pic varchar(200),agent_trx_price numeric(14,2) DEFAULT 0 NOT NULL)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'package-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex')
await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'能量套餐',NULL,1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query("INSERT INTO t_role_has_permissions VALUES(1,1),(2,1)")
await pool.query("INSERT INTO t_telegram_bot VALUES(10,'Source','source_bot'),(11,'Target','target_bot')")
const {energyPackageApi}=await import('./energy-package-api.server')
async function call(method='GET',query='',body?:unknown,origin='https://energy-package.test'){
 const headers:Record<string,string>={cookie:'tg_platform_session='+token}
 let requestBody:BodyInit|undefined
 if(body instanceof FormData){headers.origin=origin;requestBody=body}
 else if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}
 const response=await energyPackageApi(new Request('https://energy-package.test/api/energy-packages'+query,{method,headers,body:requestBody}))
 return{response,data:await response.json() as Record<string,any>}
}
function packageForm(bot_rid:number,name:string){return{bot_rid,package_type:1,package_name:name,energy_amount:65000,energy_day:1,trx_price:'1.25',agent_trx_price:'',seq_sn:'',show_notes:'fixture package'}}
try{
 await test('套餐读取、详情、筛选与动作权限',async()=>{
  const x=await call();assert.equal(x.response.status,200);assert.equal(x.data.total,0);assert.equal(x.data.canAdd,false);assert.equal(x.data.canCopy,false)
  assert.equal((await call('POST','',{action:'create'})).response.status,403)
  await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(3,'添加能量套餐','admin.energy.package.add',2),(4,'修改能量套餐','admin.energy.package.update',2),(5,'删除能量套餐','admin.energy.package.delete',2),(6,'修改能量套餐','admin.energy.package.change_status',2),(7,'复制能量套餐','admin.energy.package.copy_paste',2),(8,'批量删除套餐','admin.energy.package.batchdelete',2)")
  await pool.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,3),(1,4),(1,5),(1,6),(1,7),(1,8)')
  const options=await call('GET','?action=options');assert.equal(options.response.status,200);assert.equal(options.data.bots.length,2)
  const rights=(await call()).data;for(const k of ['canAdd','canEdit','canDelete','canChangeStatus','canCopy','canBatchDelete'])assert.equal(rights[k],true)
  assert.equal((await call('GET','?action=show&rid=999')).response.status,404)
 })
 await test('套餐创建编辑图片上传、状态、覆盖复制、批量删除和审计',async()=>{
  const form=packageForm(10,'Energy A')
  assert.equal((await call('POST','',{action:'create',...form,trx_price:'0'})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...form,energy_amount:64000})).response.status,400)
  assert.equal((await call('POST','',{action:'create',...form},'https://attacker.invalid')).response.status,403)
  assert.equal((await call('POST','',{action:'create',...form})).response.status,200)
  let listed=await call('GET','?botRid=10&search=Energy');assert.equal(listed.data.total,1);const source=listed.data.rows[0];assert.equal(source.energy_day_label,'1 天');const details=await call('GET','?action=show&rid='+source.rid);assert.equal(details.response.status,200);assert.equal(details.data.row.package_name,'Energy A')
  assert.equal((await call('POST','',{action:'create',...packageForm(11,'Old target')})).response.status,200)
  assert.equal((await call('POST','',{action:'status',rid:source.rid,enabled:true})).response.status,200)
  const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ5sAAAAASUVORK5CYII=','base64')
  const multipart=new FormData();multipart.set('payload',JSON.stringify({action:'update',rid:source.rid,...form,package_name:'Energy A updated'}));multipart.set('thumb',new File([imageBytes],'thumb.png',{type:'image/png'}))
  assert.equal((await call('POST','',multipart)).response.status,200)
  let row=await pool.query('SELECT package_pic,status FROM t_energy_platform_package WHERE rid=$1',[source.rid]);const picture=String(row.rows[0].package_pic);assert.equal(picture.startsWith('https://media.example.test/storage/news/'),true);assert.equal(Number(row.rows[0].status),0)
  const invalid=new FormData();invalid.set('payload',JSON.stringify({action:'update',rid:source.rid,...form}));invalid.set('thumb',new File([new Uint8Array([1,2,3])],'bad.png',{type:'image/png'}));assert.equal((await call('POST','',invalid)).response.status,400)
  assert.equal((await call('POST','',{action:'copy',sourceBotRid:10,targetBotRid:10})).response.status,400)
  assert.equal((await call('POST','',{action:'copy',sourceBotRid:10,targetBotRid:11})).response.status,200)
  row=await pool.query('SELECT package_name,package_pic FROM t_energy_platform_package WHERE bot_rid=11');assert.equal(row.rows.length,1);assert.equal(row.rows[0].package_name,'Energy A updated');assert.equal(row.rows[0].package_pic,picture)
  assert.equal((await call('POST','',{action:'batch-delete',botRid:11})).response.status,200);assert.equal(Number((await pool.query('SELECT count(*)::int n FROM t_energy_platform_package WHERE bot_rid=11')).rows[0].n),0)
  assert.equal((await call('POST','',{action:'delete',rid:source.rid})).response.status,200)
  assert.equal(Number((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'energy.package.%'")).rows[0].n),7)
 })
}finally{await pool.end();await rm(mediaRoot,{recursive:true,force:true})}

