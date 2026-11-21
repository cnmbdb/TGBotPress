import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_BOTS_API_TEST_DB_URL
const dbUrl=raw?new URL(raw):null,ip=dbUrl?.hostname.split('.').map(Number)
const privateHost=dbUrl?.hostname==='postgres'||(process.env.TG_BOTS_API_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(ip[0]===192&&ip[1]===168)))
if(!raw||!dbUrl||!privateHost||!dbUrl.username.startsWith('tgbot_api_test_')||!dbUrl.pathname.slice(1).startsWith('tgbot_api_test_'))throw new Error('Bot API integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=dbUrl.hostname;process.env.DB_PORT=dbUrl.port||'5432';process.env.DB_DATABASE=dbUrl.pathname.slice(1);process.env.DB_USERNAME=dbUrl.username;process.env.DB_PASSWORD=dbUrl.password
process.env.PLATFORM_ORIGIN='https://bots-api.test';process.env.LEGACY_ORIGIN='https://legacy.test';process.env.PLATFORM_LEGACY_CACHE_REQUIRED='false';process.env.TG_BOT_AUTO_CLONE_CONFIG='false';process.env.PLATFORM_TELEGRAM_ACTIONS='false';process.env.WEB_URL='https://worker.test';process.env.TELEGRAM_WEBHOOK_SECRET_KEY='01234567890123456789012345678901'
const setup=new pg.Pool({connectionString:raw,max:6})
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web')")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint NOT NULL,action text NOT NULL,resource_id bigint)')
await setup.query('CREATE TABLE t_telegram_bot(rid bigserial PRIMARY KEY,bot_token varchar(100) NOT NULL,bot_admin_username varchar(100),bot_firstname varchar(100),bot_username varchar(100),comments varchar(255),create_by bigint,create_time timestamp,update_by bigint,update_time timestamp,recharge_wallet_addr varchar(100),get_tx_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_command(rid bigserial PRIMARY KEY,bot_rid bigint,command text,description text,command_type integer,seq_sn integer,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_keyreply(rid bigserial PRIMARY KEY,bot_rid bigint,key_type integer,monitor_word text,reply_photo text,reply_content text,opt_type integer,status integer,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_keyboard(rid bigserial PRIMARY KEY,label text)')
await setup.query('CREATE TABLE t_telegram_bot_keyreply_keyboard(rid bigserial PRIMARY KEY,bot_rid bigint,keyreply_rid bigint,keyboard_rid bigint,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_ad(rid bigserial PRIMARY KEY,bot_rid bigint,notice_cycle integer,notice_obj text,notice_photo text,notice_ad text,status integer,last_notice_time timestamp,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
await setup.query('CREATE TABLE t_telegram_bot_ad_keyboard(rid bigserial PRIMARY KEY,bot_rid bigint,ad_rid bigint,keyboard_rid bigint,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
for(const table of ['t_telegram_bot_group','t_telegram_bot_user','t_collection_wallet','t_energy_platform_bot','t_transit_wallet','t_telegram_moderation_log','t_telegram_group_message_history','t_telegram_support_message','t_telegram_verification','t_telegram_bot_group_policy','t_telegram_bot_moderation_config'])await setup.query(`CREATE TABLE ${table}(rid bigserial PRIMARY KEY,bot_rid bigint,receive_wallet text)`)
await setup.query('CREATE TABLE t_premium_platform(rid bigserial PRIMARY KEY,receive_wallet text)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,status) VALUES(1,'root-admin',1),(2,'limited-admin',1)")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')',[digest('a'.repeat(64)),digest('b'.repeat(64))])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'机器人录入员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'机器人列表','admin.telegram.telegrambot.index',0),(2,'添加机器人','admin.telegram.telegrambot.add',1),(3,'修改机器人','admin.telegram.telegrambot.update',1),(4,'更新机器人','admin.telegram.telegrambot.gengxin',1),(5,'注册Webhook','admin.telegram.telegrambot.regwebhook',1),(6,'删除机器人','admin.telegram.telegrambot.delete',1)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(2,1),(2,2)')
await setup.query("INSERT INTO t_telegram_bot(rid,bot_token,bot_admin_username,bot_firstname,bot_username,comments,create_time,update_time) VALUES(1,'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','@source','Source','source_bot','template',now(),now()),(2,'234567:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','@target','Target','target_bot','old target',now(),now())")
await setup.query("INSERT INTO t_telegram_bot_command(bot_rid,command,description,command_type,seq_sn) VALUES(1,'start','Start',1,1),(2,'old','Old',1,2)")
await setup.query("INSERT INTO t_telegram_bot_keyreply(bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status) VALUES(1,1,'hi','','hello',1,1),(2,1,'old','','old reply',1,1)")
await setup.query("INSERT INTO t_telegram_bot_ad(bot_rid,notice_cycle,notice_obj,notice_photo,notice_ad,status) VALUES(1,2,'group','','source ad',1),(2,1,'target','','target ad',1)")
for(const[table,column]of[['t_admin','id'],['t_admin_device_session','rid'],['t_roles','id'],['t_permissions','id'],['t_telegram_bot','rid'],['t_telegram_bot_command','rid'],['t_telegram_bot_keyreply','rid'],['t_telegram_bot_ad','rid']]as const)await setup.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'),(SELECT max(${column}) FROM ${table}))`)
const tokens=new Map([[1,'a'.repeat(64)],[2,'b'.repeat(64)]])
const {botManagement}=await import('./bots-api.server')
function req(admin:number,method='GET',body?:unknown,url='https://bots-api.test/api/bot-management',origin='https://bots-api.test'){const headers:Record<string,string>={cookie:`tg_platform_session=${tokens.get(admin)}`};let payload:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';if(body)payload=JSON.stringify(body)}return new Request(url,{method,headers,body:payload})}
async function call(admin:number,method='GET',body?:unknown,url?:string,origin?:string){const response=await botManagement(req(admin,method,body,url,origin));return{response,data:await response.json() as Record<string,any>}}
const validToken='345678:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123'
try{
 await test('robot list, search, detail, options, and role-specific action permissions work',async()=>{
  const listed=await call(1,'GET',undefined,'https://bots-api.test/api/bot-management?page=1&pageSize=10&search=source')
  assert.equal(listed.response.status,200);assert.equal(listed.data.total,1);assert.equal(listed.data.rows[0].bot_username,'source_bot');assert.equal(listed.data.rows[0].token_configured,true);assert.equal('bot_token'in listed.data.rows[0],false)
  const options=await call(1,'GET',undefined,'https://bots-api.test/api/bot-management?action=options');assert.equal(options.response.status,200);assert.equal(options.data.length,2)
  const manager=await call(2);assert.deepEqual(manager.data.permissions,{add:true,update:false,refresh:false,webhook:false,clone:false,delete:false,recharge:false})
  assert.equal((await call(2,'POST',{action:'update',rid:1,bot_admin_username:'@x',comments:'x'})).response.status,403)
  assert.equal((await call(2,'POST',{action:'delete',rid:1})).response.status,403)
  assert.equal((await call(2,'POST',{action:'clone',rid:2,source:1,force:true})).response.status,403)
  assert.equal((await call(2,'POST',{action:'recharge',rid:1,address:'',date:''})).response.status,403)
  assert.equal((await call(1,'GET',undefined,'https://bots-api.test/api/bot-management?action=detail&rid=1')).response.status,200)
 })
 await test('robot add, duplicate guard, update, refresh/webhook environment guards, audit, and delete work',async()=>{
  const added=await call(2,'POST',{action:'add',bot_token:validToken,bot_admin_username:'@operator',comments:'new bot'})
  assert.equal(added.response.status,200);const rid=Number(added.data.data.rid)
  assert.equal((await call(2,'POST',{action:'add',bot_token:validToken,bot_admin_username:'',comments:''})).response.status,409)
  assert.equal((await call(1,'POST',{action:'update',rid,bot_token:'',bot_admin_username:'@updated',comments:'updated'})).response.status,200)
  assert.equal((await setup.query('SELECT bot_admin_username,comments FROM t_telegram_bot WHERE rid=$1',[rid])).rows[0].comments,'updated')
  assert.equal((await call(1,'POST',{action:'refresh',rid})).response.status,409)
  assert.equal((await call(1,'POST',{action:'webhook',rid})).response.status,409)
  assert.equal((await call(1,'POST',{action:'delete',rid})).response.status,200)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot WHERE rid=$1',[rid])).rows[0].n),0)
  assert.ok(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'telegram.bot.%'")).rows[0].n)>=3)
 })
 await test('robot configuration clone requires explicit overwrite and recreates linked rows',async()=>{
  assert.equal((await call(1,'POST',{action:'clone',rid:2,source:1,force:false})).response.status,409)
  assert.equal((await call(1,'POST',{action:'clone',rid:2,source:1,force:true})).response.status,200)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_command WHERE bot_rid=2')).rows[0].n),1)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_keyreply WHERE bot_rid=2')).rows[0].n),1)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_ad WHERE bot_rid=2')).rows[0].n),1)
  assert.equal((await call(1,'POST',{action:'clone',rid:1,source:1,force:true})).response.status,400)
 })
 await test('recharge validates TRON address and stores its local transaction time',async()=>{
  const address='T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
  assert.equal((await call(1,'POST',{action:'recharge',rid:1,address,date:'2026-10-27T10:20'})).response.status,200)
  const row=(await setup.query('SELECT recharge_wallet_addr,to_char(get_tx_time,\'YYYY-MM-DD"T"HH24:MI\') AS get_tx_time FROM t_telegram_bot WHERE rid=1')).rows[0]
  assert.deepEqual(row,{recharge_wallet_addr:address,get_tx_time:'2026-10-27T10:20'})
  assert.equal((await call(1,'POST',{action:'recharge',rid:1,address:'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwa',date:''})).response.status,400)
 })
 await test('robot management rejects unauthenticated, bad origin, and invalid action requests',async()=>{
  assert.equal((await botManagement(new Request('https://bots-api.test/api/bot-management'))).status,401)
  assert.equal((await call(1,'POST',{action:'add',bot_token:validToken,bot_admin_username:'',comments:''},undefined,'https://attacker.test')).response.status,403)
  assert.equal((await call(1,'POST',{action:'unknown'})).response.status,400)
 })
}finally{await setup.end()}
