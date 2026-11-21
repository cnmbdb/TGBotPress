import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp,readdir,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_MESSAGE_CONFIG_TEST_DB_URL
const dbUrl=raw?new URL(raw):null,ip=dbUrl?.hostname.split('.').map(Number)
const privateHost=dbUrl?.hostname==='postgres'||(process.env.TG_MESSAGE_CONFIG_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(ip[0]===192&&ip[1]===168)))
if(!raw||!dbUrl||!privateHost||!dbUrl.username.startsWith('message_config_test_')||!dbUrl.pathname.slice(1).startsWith('message_config_test_'))throw new Error('Message config integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=dbUrl.hostname;process.env.DB_PORT=dbUrl.port||'5432';process.env.DB_DATABASE=dbUrl.pathname.slice(1);process.env.DB_USERNAME=dbUrl.username;process.env.DB_PASSWORD=dbUrl.password;process.env.PLATFORM_ORIGIN='https://message-config.test';process.env.PLATFORM_LEGACY_CACHE_REQUIRED='false';process.env.MEDIA_PUBLIC_ORIGIN='https://media.test'
const mediaRoot=await mkdtemp(join(tmpdir(),'tg-message-config-'));process.env.MEDIA_STORAGE_ROOT=mediaRoot
const setup=new pg.Pool({connectionString:raw,max:4})
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint NOT NULL,action text NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query('CREATE TABLE t_telegram_bot(rid bigserial PRIMARY KEY,bot_firstname varchar(255),bot_username varchar(255))')
await setup.query('CREATE TABLE t_telegram_bot_keyreply(rid bigserial PRIMARY KEY,bot_rid bigint NOT NULL,key_type integer NOT NULL,monitor_word varchar(500) NOT NULL,reply_photo varchar(500) NOT NULL DEFAULT \'\',reply_content text NOT NULL DEFAULT \'\',opt_type integer NOT NULL,status integer NOT NULL DEFAULT 0,create_by varchar(100),create_time timestamp,update_by varchar(100),update_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_keyreply_keyboard(rid bigserial PRIMARY KEY,bot_rid bigint NOT NULL,keyreply_rid bigint NOT NULL)')
await setup.query("CREATE TABLE t_telegram_bot_ad(rid bigserial PRIMARY KEY,bot_rid bigint NOT NULL,notice_cycle integer NOT NULL,notice_obj varchar(200) NOT NULL DEFAULT '-',notice_photo varchar(500) NOT NULL DEFAULT '',notice_ad text NOT NULL,status integer NOT NULL DEFAULT 1,last_notice_time timestamp,create_by varchar(100),create_time timestamp,update_by varchar(100),update_time timestamp)")
await setup.query('CREATE TABLE t_telegram_bot_ad_keyboard(rid bigserial PRIMARY KEY,bot_rid bigint NOT NULL,ad_rid bigint NOT NULL)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password,status) VALUES(1,'super-admin','fixture',1),(2,'limited-admin','fixture',1)")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')',[digest('a'.repeat(64)),digest('b'.repeat(64))])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'关键字回复编辑员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'机器人列表',NULL,0),(2,'关键字回复','admin.telegram.keyreply.index',1),(3,'添加关键字回复','admin.telegram.keyreply.add',2),(4,'修改关键字回复','admin.telegram.keyreply.update',2),(5,'删除关键字回复人','admin.telegram.keyreply.delete',2),(6,'修改关键字回复','admin.telegram.keyreply.change_status',2),(7,'复制关键字','admin.telegram.keyreply.copy_paste',2),(8,'定时广告','admin.telegram.telegrambotad.index',1),(9,'添加定时广告','admin.telegram.telegrambotad.add',8),(10,'修改定时广告','admin.telegram.telegrambotad.update',8),(11,'删除定时广告','admin.telegram.telegrambotad.delete',8),(12,'修改定时广告','admin.telegram.telegrambotad.change_status',8),(13,'复制定时广告','admin.telegram.telegrambotad.copy_paste',8)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(2,1),(2,2),(2,3),(2,8),(2,9)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username) VALUES(1,'Alpha','alpha_bot'),(2,'Beta','beta_bot'),(3,'Gamma','gamma_bot')")
await setup.query("INSERT INTO t_telegram_bot_keyreply(rid,bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status,create_by,create_time,update_by,update_time) VALUES(1,1,1,'hello','','source reply',1,0,'1',now(),'1',now()),(2,2,2,'target old','','old reply',4,1,'2',now(),'2',now()),(3,1,2,'help','','help reply',8,1,'1',now(),'1',now())")
await setup.query("INSERT INTO t_telegram_bot_ad(rid,bot_rid,notice_cycle,notice_obj,notice_photo,notice_ad,status,create_by,create_time,update_by,update_time) VALUES(1,1,2,'群组','','source ad one',0,'1',now(),'1',now()),(2,1,5,'-','https://media.test/source.png','source ad two',1,'1',now(),'1',now()),(3,2,1,'target','','target old ad',0,'2',now(),'2',now())")
for(const [table,column] of [['t_admin','id'],['t_admin_device_session','rid'],['t_roles','id'],['t_permissions','id'],['t_telegram_bot','rid'],['t_telegram_bot_keyreply','rid'],['t_telegram_bot_ad','rid']] as const)await setup.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'),(SELECT max(${column}) FROM ${table}))`)
const tokens=new Map([[1,'a'.repeat(64)],[2,'b'.repeat(64)]])
const {messageConfigApi}=await import('./message-config-api.server')
function request(admin:number,method='GET',body?:unknown,url='https://message-config.test/api/message-config',origin='https://message-config.test'){const token=tokens.get(admin);const headers:Record<string,string>={cookie:`tg_platform_session=${token}`};let payload:BodyInit|undefined;if(method==='POST'){headers.origin=origin;if(body instanceof FormData)payload=body;else{headers['content-type']='application/json';if(body)payload=JSON.stringify(body)}}return new Request(url,{method,headers,body:payload})}
async function call(admin:number,method='GET',body?:unknown,url?:string){const response=await messageConfigApi(request(admin,method,body,url));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('reply options, list filters, pagination, and action permissions reflect the admin role',async()=>{
  const options=await call(1,'GET',undefined,'https://message-config.test/api/message-config?action=options&kind=reply');assert.equal(options.response.status,200);assert.equal(options.data.length,3)
  const listed=await call(1,'GET',undefined,'https://message-config.test/api/message-config?kind=reply&page=1&pageSize=10&search=help&bot=1')
  assert.equal(listed.response.status,200);assert.equal(listed.data.total,1);assert.equal(listed.data.rows[0].monitor_word,'help');assert.equal(listed.data.rows[0].bot_username,'alpha_bot')
  const manager=await call(2,'GET',undefined,'https://message-config.test/api/message-config?kind=reply')
  assert.equal(manager.response.status,200);assert.deepEqual(manager.data.permissions,{add:true,update:false,delete:false,status:false,copy:false})
  assert.equal((await call(2,'POST',{kind:'reply',action:'status',rid:1,enabled:false})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'reply',action:'delete',rid:1})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'reply',action:'copy',source:1,target:2,overwrite:true})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'reply',action:'update',rid:1,bot_rid:1,key_type:1,monitor_word:'x',reply_content:'x',opt_type:1})).response.status,403)
 })
 await test('reply create, duplicate prevention, edit, status, keyboard protection, and delete work',async()=>{
  const added=await call(2,'POST',{kind:'reply',action:'add',bot_rid:1,key_type:1,monitor_word:'welcome',reply_content:'line 1\nline 2',opt_type:3})
  assert.equal(added.response.status,200)
  const newId=Number((await setup.query("SELECT rid FROM t_telegram_bot_keyreply WHERE monitor_word='welcome'")).rows[0].rid)
  const row=(await setup.query('SELECT key_type,reply_content,opt_type,status FROM t_telegram_bot_keyreply WHERE rid=$1',[newId])).rows[0]
  assert.equal(row.reply_content,'line 1\nline 2');assert.equal(row.key_type,1);assert.equal(row.opt_type,3);assert.equal(row.status,0)
  assert.equal((await call(2,'POST',{kind:'reply',action:'add',bot_rid:1,key_type:1,monitor_word:'welcome',reply_content:'duplicate',opt_type:1})).response.status,409)
  assert.equal((await call(1,'POST',{kind:'reply',action:'update',rid:newId,bot_rid:2,key_type:2,monitor_word:'welcome-2',reply_content:'edited',opt_type:11})).response.status,200)
  const edited=(await setup.query('SELECT bot_rid,key_type,monitor_word,reply_content,opt_type FROM t_telegram_bot_keyreply WHERE rid=$1',[newId])).rows[0]
  assert.deepEqual(edited,{bot_rid:'2',key_type:2,monitor_word:'welcome-2',reply_content:'edited',opt_type:11})
  assert.equal((await call(1,'POST',{kind:'reply',action:'status',rid:newId,enabled:true})).response.status,200)
  assert.equal(Number((await setup.query('SELECT status FROM t_telegram_bot_keyreply WHERE rid=$1',[newId])).rows[0].status),0)
  await setup.query('INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid) VALUES(2,$1)',[newId])
  assert.equal((await call(1,'POST',{kind:'reply',action:'delete',rid:newId})).response.status,409)
  await setup.query('DELETE FROM t_telegram_bot_keyreply_keyboard WHERE keyreply_rid=$1',[newId])
  assert.equal((await call(1,'POST',{kind:'reply',action:'delete',rid:newId})).response.status,200)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_keyreply WHERE rid=$1',[newId])).rows[0].n),0)
  assert.ok(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'telegram.reply.%'")).rows[0].n)>=4)
 })
 await test('copy replaces target replies only after explicit overwrite and preserves source fields',async()=>{
  const rejected=await call(1,'POST',{kind:'reply',action:'copy',source:1,target:2,overwrite:false});assert.equal(rejected.response.status,409)
  await setup.query("INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid) VALUES(2,2)")
  const copied=await call(1,'POST',{kind:'reply',action:'copy',source:1,target:2,overwrite:true})
  assert.equal(copied.response.status,200);assert.equal(copied.data.data.copied,2)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_keyreply WHERE bot_rid=2')).rows[0].n),2)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=2')).rows[0].n),0)
  const copy=(await setup.query("SELECT monitor_word,reply_content,opt_type,status FROM t_telegram_bot_keyreply WHERE bot_rid=2 AND monitor_word='hello'")).rows[0]
  assert.deepEqual(copy,{monitor_word:'hello',reply_content:'source reply',opt_type:1,status:0})
  assert.equal((await call(1,'POST',{kind:'reply',action:'copy',source:1,target:1,overwrite:true})).response.status,400)
  assert.equal((await call(1,'POST',{kind:'reply',action:'copy',source:3,target:2,overwrite:true})).response.status,400)
 })
 await test('reply image upload validates image, stores a public URL, and removes failed uploads',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c3WQAAAAASUVORK5CYII=','base64')
  const form=new FormData();form.set('payload',JSON.stringify({kind:'reply',action:'update',rid:1,bot_rid:1,key_type:1,monitor_word:'hello',reply_photo:'',reply_content:'source reply',opt_type:1}));form.set('thumb',new File([png],'pixel.png',{type:'image/png'}))
  const uploaded=await call(1,'POST',form);assert.equal(uploaded.response.status,200)
  const photo=String((await setup.query('SELECT reply_photo FROM t_telegram_bot_keyreply WHERE rid=1')).rows[0].reply_photo)
  assert.match(photo,/^https:\/\/media\.test\/storage\/news\//)
  const files=await readdir(mediaRoot,{recursive:true});assert.equal(files.filter(x=>String(x).endsWith('.png')).length,1)
  const failed=new FormData();failed.set('payload',JSON.stringify({kind:'reply',action:'update',rid:3,bot_rid:1,key_type:1,monitor_word:'hello',reply_photo:'',reply_content:'conflict',opt_type:1}));failed.set('thumb',new File([png],'pixel.png',{type:'image/png'}))
  assert.equal((await call(1,'POST',failed)).response.status,409)
  assert.equal((await readdir(mediaRoot,{recursive:true})).filter(x=>String(x).endsWith('.png')).length,1)
  const bad=new FormData();bad.set('payload',JSON.stringify({kind:'reply',action:'update',rid:1,bot_rid:1,key_type:1,monitor_word:'hello',reply_photo:'',reply_content:'x',opt_type:1}));bad.set('thumb',new File([Buffer.from('not an image')],'bad.png',{type:'image/png'}))
  assert.equal((await call(1,'POST',bad)).response.status,400)
 })
 await test('scheduled-ad list, filtering, fields, and add-only role permissions match configuration',async()=>{
  const listed=await call(1,'GET',undefined,'https://message-config.test/api/message-config?kind=ad&page=1&pageSize=10&search=source&bot=1')
  assert.equal(listed.response.status,200);assert.equal(listed.data.total,2);assert.equal(listed.data.rows[0].notice_ad,'source ad two');assert.equal(listed.data.rows[0].notice_cycle,5)
  const manager=await call(2,'GET',undefined,'https://message-config.test/api/message-config?kind=ad')
  assert.deepEqual(manager.data.permissions,{add:true,update:false,delete:false,status:false,copy:false})
  assert.equal((await call(2,'POST',{kind:'ad',action:'update',rid:1,bot_rid:1,notice_cycle:3,notice_ad:'denied'})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'ad',action:'status',rid:1,enabled:true})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'ad',action:'delete',rid:1})).response.status,403)
  assert.equal((await call(2,'POST',{kind:'ad',action:'copy',source:1,target:2,overwrite:true})).response.status,403)
  const added=await call(2,'POST',{kind:'ad',action:'add',bot_rid:3,notice_cycle:17,notice_obj:'私聊',notice_ad:'gamma ad'})
  assert.equal(added.response.status,200)
  const row=(await setup.query("SELECT notice_cycle,notice_obj,notice_photo,notice_ad,status FROM t_telegram_bot_ad WHERE bot_rid=3")).rows[0]
  assert.deepEqual(row,{notice_cycle:17,notice_obj:'私聊',notice_photo:'',notice_ad:'gamma ad',status:1})
  assert.equal((await call(2,'POST',{kind:'ad',action:'add',bot_rid:3,notice_cycle:17,notice_obj:'私聊',notice_ad:'gamma ad'})).response.status,409)
 })
 await test('scheduled-ad edit, status, image upload, delete, and keyboard cleanup work',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c3WQAAAAASUVORK5CYII=','base64')
  const form=new FormData();form.set('payload',JSON.stringify({kind:'ad',action:'update',rid:1,bot_rid:1,notice_cycle:3,notice_obj:'频道',notice_photo:'',notice_ad:'edited ad'}));form.set('thumb',new File([png],'ad.png',{type:'image/png'}))
  assert.equal((await call(1,'POST',form)).response.status,200)
  const edited=(await setup.query('SELECT notice_cycle,notice_obj,notice_photo,notice_ad FROM t_telegram_bot_ad WHERE rid=1')).rows[0]
  assert.equal(edited.notice_cycle,3);assert.equal(edited.notice_obj,'频道');assert.equal(edited.notice_ad,'edited ad');assert.match(edited.notice_photo,/^https:\/\/media\.test\/storage\/news\//)
  assert.equal((await call(1,'POST',{kind:'ad',action:'status',rid:1,enabled:true})).response.status,200)
  assert.equal(Number((await setup.query('SELECT status FROM t_telegram_bot_ad WHERE rid=1')).rows[0].status),0)
  const gammaId=Number((await setup.query("SELECT rid FROM t_telegram_bot_ad WHERE bot_rid=3 AND notice_ad='gamma ad'")).rows[0].rid)
  await setup.query('INSERT INTO t_telegram_bot_ad_keyboard(bot_rid,ad_rid) VALUES(3,$1)',[gammaId])
  assert.equal((await call(1,'POST',{kind:'ad',action:'delete',rid:gammaId})).response.status,200)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_ad_keyboard WHERE ad_rid=$1',[gammaId])).rows[0].n),0)
  assert.ok(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'telegram.ad.%'")).rows[0].n)>=4)
 })
 await test('scheduled-ad copy requires overwrite and replaces target rows and keyboard references with legacy fields',async()=>{
  assert.equal((await call(1,'POST',{kind:'ad',action:'copy',source:1,target:2,overwrite:false})).response.status,409)
  await setup.query('INSERT INTO t_telegram_bot_ad_keyboard(bot_rid,ad_rid) VALUES(2,3)')
  const sourceRows=(await setup.query('SELECT notice_cycle,notice_photo,notice_ad,status FROM t_telegram_bot_ad WHERE bot_rid=1 ORDER BY rid')).rows
  const copied=await call(1,'POST',{kind:'ad',action:'copy',source:1,target:2,overwrite:true})
  assert.equal(copied.response.status,200);assert.equal(copied.data.data.copied,2)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_ad WHERE bot_rid=2')).rows[0].n),2)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_ad_keyboard WHERE bot_rid=2')).rows[0].n),0)
  const rows=(await setup.query('SELECT notice_cycle,notice_obj,notice_photo,notice_ad,status FROM t_telegram_bot_ad WHERE bot_rid=2 ORDER BY rid')).rows
  assert.deepEqual(rows.map(({notice_cycle,notice_obj,notice_photo,notice_ad,status})=>({notice_cycle,notice_obj,notice_photo,notice_ad,status})),sourceRows.map(({notice_cycle,notice_photo,notice_ad,status})=>({notice_cycle,notice_obj:'-',notice_photo,notice_ad,status})))
  assert.equal((await call(1,'POST',{kind:'ad',action:'copy',source:1,target:1,overwrite:true})).response.status,400)
  assert.equal((await call(1,'POST',{kind:'ad',action:'copy',source:3,target:2,overwrite:true})).response.status,400)
 })
 await test('origin, authentication, and action schema guards reject invalid requests',async()=>{
  assert.equal((await messageConfigApi(request(1,'POST',{kind:'reply',action:'add'} ,'https://message-config.test/api/message-config','https://attacker.test'))).status,403)
  assert.equal((await messageConfigApi(new Request('https://message-config.test/api/message-config?kind=reply'))).status,401)
  assert.equal((await call(1,'POST',{kind:'reply',action:'unknown'})).response.status,400)
  assert.equal((await call(1,'POST',{kind:'reply',action:'add',bot_rid:1,key_type:9,monitor_word:'bad',reply_content:'x',opt_type:1})).response.status,400)
 })
}finally{await setup.end();await rm(mediaRoot,{recursive:true,force:true})}
