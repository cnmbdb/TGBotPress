import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { digest } from './security'
const raw=process.env.TG_USERS_TEST_DB_URL,dbUrl=raw?new URL(raw):null,ip=dbUrl?.hostname.split('.').map(Number)
const privateHost=dbUrl?.hostname==='postgres'||(process.env.TG_USERS_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(ip[0]===192&&ip[1]===168)))
if(!raw||!dbUrl||!privateHost||!dbUrl.username.startsWith('tg_users_test_')||!dbUrl.pathname.slice(1).startsWith('tg_users_test_'))throw new Error('Users integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=dbUrl.hostname;process.env.DB_PORT=dbUrl.port||'5432';process.env.DB_DATABASE=dbUrl.pathname.slice(1);process.env.DB_USERNAME=dbUrl.username;process.env.DB_PASSWORD=dbUrl.password;process.env.PLATFORM_ORIGIN='https://users.test';process.env.PLATFORM_LEGACY_CACHE_REQUIRED='false';process.env.PLATFORM_TELEGRAM_ACTIONS='false'
const setup=new pg.Pool({connectionString:raw,max:6})
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(50) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_platform_cloudflare_security(rid bigint PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web')")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint NOT NULL,action text NOT NULL,resource_id bigint)')
await setup.query('CREATE TABLE t_telegram_bot(rid bigserial PRIMARY KEY,bot_token varchar(100),bot_firstname varchar(100),bot_username varchar(100))')
await setup.query('CREATE TABLE t_telegram_bot_user(rid bigserial PRIMARY KEY,bot_rid bigint NOT NULL,tg_uid bigint NOT NULL,tg_username varchar(200),tg_nickname varchar(200),status smallint NOT NULL DEFAULT 1,bind_trc_wallet_addr varchar(200),first_time timestamp,last_time timestamp,stop_time timestamp,cash_trx numeric(20,6) NOT NULL DEFAULT 0,cash_usdt numeric(20,6) NOT NULL DEFAULT 0,max_monitor_wallet integer NOT NULL DEFAULT 0)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,status) VALUES(1,'root-admin',1),(2,'limited-admin',1)")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')',[digest('a'.repeat(64)),digest('b'.repeat(64))])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'受限用户管理员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'群组用户',NULL,0),(2,'用户列表','admin.groupuser.user.index',1),(3,'发送消息','admin.groupuser.user.sendmessage',2),(4,'群发消息','admin.groupuser.user.batchsendmessage',2),(5,'用户充值','admin.groupuser.user.rechargemanual',2),(6,'删除用户','admin.groupuser.user.delete',2),(7,'批量删除停用','admin.groupuser.user.batchdelete',2)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(2,1),(2,2),(2,5)')
await setup.query("INSERT INTO t_telegram_bot(rid,bot_token,bot_firstname,bot_username) VALUES(1,'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','Main bot','main_bot'),(2,'234567:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','Other bot','other_bot')")
await setup.query("INSERT INTO t_telegram_bot_user(rid,bot_rid,tg_uid,tg_username,tg_nickname,status,bind_trc_wallet_addr,first_time,last_time,stop_time,cash_trx,cash_usdt,max_monitor_wallet) VALUES(1,1,1001,'Alice','Alice A',1,'Twallet1',now()-interval '3 days',now(),NULL,5,10,1),(2,1,1002,'Bob','Bob B',2,NULL,now()-interval '5 days',now()-interval '2 days',now()-interval '2 days',0,0,0),(3,1,1003,'Carol','Carol C',3,NULL,now()-interval '7 days',now()-interval '6 days',now()-interval '6 days',0,0,0),(4,1,1004,'Dave','Dave D',1,NULL,now(),now(),NULL,0,0,0),(5,1,1005,'Eve','Eve E',1,NULL,now(),now(),NULL,0,0,0),(6,1,1006,'Frank','Frank F',1,NULL,now(),now(),NULL,0,0,0),(7,2,2001,'Other','Other user',1,NULL,now(),now(),NULL,0,0,0)")
for(const[table,column]of[['t_admin','id'],['t_admin_device_session','rid'],['t_roles','id'],['t_permissions','id'],['t_telegram_bot','rid'],['t_telegram_bot_user','rid']]as const)await setup.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'),(SELECT max(${column}) FROM ${table}))`)
const tokens=new Map([[1,'a'.repeat(64)],[2,'b'.repeat(64)]])
const {usersApi}=await import('./users-api.server')
function req(admin:number,method='GET',body?:unknown,url='https://users.test/api/users',origin='https://users.test'){const headers:Record<string,string>={cookie:`tg_platform_session=${tokens.get(admin)}`};let payload:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';if(body)payload=JSON.stringify(body)}return new Request(url,{method,headers,body:payload})}
async function call(admin:number,method='GET',body?:unknown,url?:string,origin?:string){const response=await usersApi(req(admin,method,body,url,origin));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('user list filters, status labels, bot options, pagination, and per-action permissions work',async()=>{
  const filtered=await call(1,'GET',undefined,'https://users.test/api/users?page=1&pageSize=10&username=https%3A%2F%2Ft.me%2F%40alice&uid=100&nickname=Alice&botRid=1')
  assert.equal(filtered.response.status,200);assert.equal(filtered.data.total,1);assert.equal(filtered.data.rows[0].tg_uid,'1001');assert.equal(filtered.data.rows[0].status_label,'使用中');assert.equal(filtered.data.rows[0].bot_username,'main_bot')
  const options=await call(1,'GET',undefined,'https://users.test/api/users?action=options');assert.equal(options.response.status,200);assert.equal(options.data.bots.length,2)
  const all=await call(1);assert.equal(all.data.total,7);assert.deepEqual(all.data.rows.slice(0,3).map((row:any)=>row.status_label),['使用中','使用中','使用中'])
  const manager=await call(2);assert.deepEqual(manager.data.permissions,{'发送消息':false,'群发消息':false,'用户充值':true,'删除用户':false,'批量删除停用':false});assert.equal(manager.data.telegramEnabled,false)
  assert.equal((await call(2,'POST',{action:'delete',rid:1})).response.status,403)
  assert.equal((await call(2,'POST',{action:'sendmessage',rid:1,message:'no'})).response.status,403)
  assert.equal((await call(2,'POST',{action:'batchdelete',bot_rid:1})).response.status,403)
 })
 await test('manual recharge updates only supplied values, permits zero, validates amounts, and audits',async()=>{
  assert.equal((await call(2,'POST',{action:'rechargemanual',rid:1,cash_trx:'0',cash_usdt:'12.5',max_monitor_wallet:''})).response.status,200)
  let row=(await setup.query('SELECT cash_trx::text,cash_usdt::text,max_monitor_wallet FROM t_telegram_bot_user WHERE rid=1')).rows[0]
  assert.deepEqual(row,{cash_trx:'0.000000',cash_usdt:'12.500000',max_monitor_wallet:1})
  assert.equal((await call(2,'POST',{action:'rechargemanual',rid:1,cash_trx:'',cash_usdt:'',max_monitor_wallet:''})).response.status,400)
  assert.equal((await call(2,'POST',{action:'rechargemanual',rid:1,cash_trx:'-1',cash_usdt:'',max_monitor_wallet:''})).response.status,400)
  assert.equal((await call(2,'POST',{action:'rechargemanual',rid:999,cash_trx:'1',cash_usdt:'',max_monitor_wallet:''})).response.status,404)
  assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='groupuser.user.manual_recharge'")).rows[0].n),1)
 })
 await test('single Telegram send success, inactive-user transition, and disabled sandbox transport are handled',async()=>{
  const originalFetch=globalThis.fetch;const sent:string[]=[]
  globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));sent.push(String(body.chat_id));return Response.json(body.chat_id==='1004'?{ok:false,description:'Forbidden: user is deactivated'}:{ok:true,result:{message_id:7}})}
  process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  try{
   assert.equal((await call(1,'POST',{action:'sendmessage',rid:1,message:'<b>Hello</b>'})).response.status,200)
   assert.equal((await call(1,'POST',{action:'sendmessage',rid:4,message:'Hello'})).response.status,502)
   assert.deepEqual(sent,['1001','1004'])
   const inactive=(await setup.query('SELECT status,stop_time FROM t_telegram_bot_user WHERE rid=4')).rows[0];assert.equal(inactive.status,3);assert.ok(inactive.stop_time)
   assert.equal((await call(1,'POST',{action:'sendmessage',rid:2,message:'inactive'})).response.status,409)
   assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='groupuser.user.send_message'")).rows[0].n),1)
  }finally{globalThis.fetch=originalFetch;process.env.PLATFORM_TELEGRAM_ACTIONS='false'}
  assert.equal((await call(1,'POST',{action:'sendmessage',rid:1,message:'disabled'})).response.status,502)
 })
 await test('batch Telegram send scopes active recipients and marks deactivated users without contacting Telegram in disabled mode',async()=>{
  assert.equal((await call(1,'POST',{action:'batchsendmessage',bot_rid:1,message:'hello'})).response.status,409)
  const originalFetch=globalThis.fetch;const sent:string[]=[]
  globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));sent.push(String(body.chat_id));return Response.json(body.chat_id==='1005'?{ok:false,description:'Forbidden: user is deactivated'}:{ok:true,result:{message_id:8}})}
  process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  try{
   const result=await call(1,'POST',{action:'batchsendmessage',bot_rid:1,message:'announcement'});assert.equal(result.response.status,200);assert.equal(result.data.message,'群发完成：成功 2，失败 1，停用 1')
   assert.deepEqual([...sent].sort(),['1001','1005','1006'])
   const status=Number((await setup.query('SELECT status FROM t_telegram_bot_user WHERE rid=5')).rows[0].status);assert.equal(status,3)
  }finally{globalThis.fetch=originalFetch;process.env.PLATFORM_TELEGRAM_ACTIONS='false'}
  assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='groupuser.user.broadcast'")).rows[0].n),1)
 })
 await test('individual and batch deletes remove only intended user states and retain active rows',async()=>{
  assert.equal((await call(1,'POST',{action:'batchdelete',bot_rid:1})).response.status,200)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_user WHERE rid IN (2,3,4,5)')).rows[0].n),0)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_user WHERE rid IN (1,6)')).rows[0].n),2)
  assert.equal(Number((await setup.query('SELECT count(*)::int n FROM t_telegram_bot_user WHERE rid=7')).rows[0].n),1)
  assert.equal((await call(1,'POST',{action:'delete',rid:6})).response.status,200)
  assert.equal((await call(1,'POST',{action:'delete',rid:6})).response.status,404)
  assert.ok(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'groupuser.user.%'")).rows[0].n)>=5)
 })
 await test('user API rejects invalid authentication, origin, method, action, and message schema',async()=>{
  assert.equal((await usersApi(new Request('https://users.test/api/users'))).status,401)
  assert.equal((await call(1,'PUT')).response.status,405)
  assert.equal((await call(1,'POST',{action:'delete',rid:1},undefined,'https://attacker.test')).response.status,403)
  assert.equal((await call(1,'POST',{action:'unknown'})).response.status,400)
  assert.equal((await call(1,'POST',{action:'sendmessage',rid:1,message:' '})).response.status,400)
 })
}finally{await setup.end()}
