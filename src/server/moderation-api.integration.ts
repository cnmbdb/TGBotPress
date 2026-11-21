import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_MODERATION_TEST_DB_URL,p=raw?new URL(raw):null,ip=p?.hostname.split('.').map(Number)
if(!raw||!p||!(p.hostname==='postgres'||(process.env.TG_MODERATION_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(process.env.TG_MODERATION_TEST_ALLOW_LOOPBACK_DB==='1'&&p.hostname==='127.0.0.1'))||!p.username.startsWith('tg_moderation_test_')||!p.pathname.slice(1).startsWith('tg_moderation_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:p.hostname,DB_PORT:p.port||'5432',DB_DATABASE:p.pathname.slice(1),DB_USERNAME:p.username,DB_PASSWORD:p.password,PLATFORM_ORIGIN:'https://moderation.test',PLATFORM_TELEGRAM_ACTIONS:'false'})
const pool=new pg.Pool({connectionString:raw,options:"-c timezone=Asia/Shanghai"})
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
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_username text,bot_admin_username text,bot_token text)',
'CREATE TABLE t_telegram_bot_group(rid int PRIMARY KEY,bot_rid int,group_type text,tg_groupid bigint,tg_groupusername text,tg_groupnickname text,status smallint DEFAULT 1,is_admin varchar(1),first_time timestamp,last_time timestamp,stop_time timestamp,follow_count int)',
'CREATE TABLE t_telegram_bot_moderation_config(bot_rid int PRIMARY KEY,support_enabled boolean,support_chat_id bigint,support_captcha_enabled boolean,support_verified_minutes int,ad_score_threshold smallint,ad_keywords text,create_time timestamp,update_time timestamp)',
"CREATE TABLE t_telegram_bot_group_policy(rid bigserial PRIMARY KEY,bot_rid int,tg_groupid bigint,join_captcha_enabled boolean,group_moderation_enabled boolean,block_forwarded_messages boolean,no_avatar_captcha_enabled boolean,no_username_captcha_enabled boolean,new_account_captcha_enabled boolean,new_account_max_age_seconds int,ad_keywords text,ad_keywords_auto_upload boolean,ad_keywords_auto_sync boolean,ad_action varchar(20),ad_restrict_duration_seconds int,verification_timeout_seconds int,ad_verification_timeout_seconds int,rate_limit_count smallint,rate_limit_window_seconds smallint,create_time timestamp,update_time timestamp,UNIQUE(bot_rid,tg_groupid))",
'CREATE TABLE t_telegram_moderation_log(rid bigserial PRIMARY KEY,bot_rid int,chat_id bigint,user_id bigint,message_id bigint,event_type varchar(40),action varchar(30),score smallint,reasons text,content_preview varchar(500),create_time timestamp)',
'CREATE TABLE t_telegram_verification(rid bigserial PRIMARY KEY,token_hash char(64) UNIQUE,bot_rid int,chat_id bigint,user_id bigint,user_chat_id bigint,verification_type varchar(30),status varchar(20),verification_message_id bigint,mini_app_message_id bigint,expires_at timestamp,verified_at timestamp,create_time timestamp,update_time timestamp)',
 'CREATE TABLE t_telegram_bot_keyreply(rid int PRIMARY KEY,bot_rid int,key_type int,status int,reply_content text,reply_photo text)',
 'CREATE TABLE t_telegram_bot_keyreply_keyboard(bot_rid int,keyreply_rid int,keyboard_rid int)',
 'CREATE TABLE t_telegram_bot_keyboard(rid int PRIMARY KEY,keyboard_name text,keyboard_icon_custom_emoji_id text,keyboard_type int,inline_type int,keyboard_value text,status int,seq_sn int)',
"CREATE TABLE t_telegram_moderated_member(rid bigserial PRIMARY KEY,bot_rid int,chat_id bigint,user_id bigint,action varchar(30),restricted_until timestamp,status varchar(20),update_time timestamp)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'moderation-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'群组用户','admin.groupuser.moderation.index',0),(2,'保存机器人配置','admin.groupuser.moderation.save_bot',1),(3,'保存群组策略','admin.groupuser.moderation.save_group',1),(4,'解除治理限制','admin.groupuser.moderation.release_member',1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_username,bot_admin_username,bot_token) VALUES(7,'bot_seven','admin_seven','sandbox-token')")
await pool.query("INSERT INTO t_telegram_bot_group(rid,bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,is_admin,follow_count) VALUES(17,7,'supergroup',-1001234567890,'test_group','Test Group',1,'Y',5)")
const {moderationApi}=await import('./moderation-api.server')
async function call(method='GET',body?:unknown,origin='https://moderation.test'){const headers:Record<string,string>={cookie:'tg_platform_session='+token};let requestBody:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}const response=await moderationApi(new Request('https://moderation.test/api/moderation',{method,headers,body:requestBody}));return{response,data:await response.json() as Record<string,any>}}
const group={action:'save_group',bot_rid:7,tg_groupid:'-1001234567890',join_captcha_enabled:true,group_moderation_enabled:true,block_forwarded_messages:true,no_avatar_captcha_enabled:true,no_username_captcha_enabled:false,new_account_captcha_enabled:true,new_account_max_age_seconds:86400,ad_keywords:'spam, giveaway',ad_keywords_auto_upload:false,ad_keywords_auto_sync:false,ad_action:'restrict',ad_restrict_duration_minutes:10,verification_timeout_seconds:180,ad_verification_timeout_minutes:30,rate_limit_count:6,rate_limit_window_seconds:10}
try{
 await test('群管中心 authenticated read and route permission projection',async()=>{
  const res=await call();assert.equal(res.response.status,200);assert.equal(res.data.groups.length,1);assert.equal(res.data.groups[0].tg_groupid,'-1001234567890');assert.equal(res.data.permissions.saveBot,false);assert.equal(res.data.permissions.saveGroup,false);assert.equal(res.data.telegramEnabled,false)
  const denied=await call('POST',{action:'save_bot',bot_rid:7,support_enabled:false,support_captcha_enabled:false,support_verified_minutes:60,ad_score_threshold:4,ad_keywords:''});assert.equal(denied.response.status,403)
  await pool.query('INSERT INTO t_role_has_permissions VALUES(2,1),(3,1),(4,1)')
  const permitted=(await call()).data;assert.equal(permitted.permissions.saveBot,true);assert.equal(permitted.permissions.saveGroup,true);assert.equal(permitted.permissions.releaseMember,true)
 })
 await test('bot/group settings writes, validation, audit and external-action guard',async()=>{
  const botConfig={action:'save_bot',bot_rid:7,support_enabled:true,support_captcha_enabled:true,support_verified_minutes:1440,ad_score_threshold:4,ad_keywords:'promo,博彩'}
  assert.equal((await call('POST',botConfig,'https://attacker.invalid')).response.status,403)
  assert.equal((await call('POST',botConfig)).response.status,200)
  const savedBot=(await pool.query('SELECT support_enabled,support_chat_id,support_captcha_enabled,ad_score_threshold,ad_keywords FROM t_telegram_bot_moderation_config WHERE bot_rid=7')).rows[0];assert.equal(savedBot.support_enabled,true);assert.equal(savedBot.support_chat_id,null);assert.equal(savedBot.support_captcha_enabled,true);assert.equal(Number(savedBot.ad_score_threshold),4)
  assert.equal((await call('POST',group)).response.status,200)
  const savedGroup=(await pool.query('SELECT join_captcha_enabled,group_moderation_enabled,ad_keywords,ad_action,ad_restrict_duration_seconds,ad_verification_timeout_seconds FROM t_telegram_bot_group_policy WHERE bot_rid=7')).rows[0];assert.equal(savedGroup.join_captcha_enabled,true);assert.equal(savedGroup.group_moderation_enabled,true);assert.equal(savedGroup.ad_keywords,'spam\ngiveaway');assert.equal(savedGroup.ad_action,'restrict');assert.equal(Number(savedGroup.ad_restrict_duration_seconds),600);assert.equal(Number(savedGroup.ad_verification_timeout_seconds),1800)
  assert.equal((await call('POST',{...group,tg_groupid:'-1009999999999'})).response.status,409)
  assert.equal((await call('POST',{action:'release_member',rid:42})).response.status,409)
  const member=(await pool.query("INSERT INTO t_telegram_moderated_member(bot_rid,chat_id,user_id,action,status,update_time) VALUES(7,-1001234567890,904,'restrict_forever','active',now()) RETURNING rid")).rows[0]
  const previousFetch=globalThis.fetch,previousActions=process.env.PLATFORM_TELEGRAM_ACTIONS;let telegramRelease:{method:string;payload:Record<string,unknown>}|undefined
  process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  globalThis.fetch=async(input,init)=>{telegramRelease={method:String(input).split('/').pop()||'',payload:JSON.parse(String(init?.body||'{}'))};return Response.json({ok:true,result:true})}
  try {
   const released=await call('POST',{action:'release_member',rid:member.rid});assert.equal(released.response.status,200);assert.equal(telegramRelease?.method,'restrictChatMember');assert.equal(telegramRelease?.payload.chat_id,'-1001234567890');assert.equal(telegramRelease?.payload.user_id,'904')
   const savedMember=(await pool.query('SELECT status FROM t_telegram_moderated_member WHERE rid=$1',[member.rid])).rows[0];assert.equal(savedMember.status,'released')
   const releaseLog=(await pool.query("SELECT event_type,action FROM t_telegram_moderation_log WHERE user_id=904")).rows[0];assert.deepEqual(releaseLog,{event_type:'manual_governance_release',action:'release'})
  }finally{globalThis.fetch=previousFetch;if(previousActions==null)delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=previousActions}
  const actions=(await pool.query('SELECT action FROM t_platform_audit_log ORDER BY rid')).rows.map(r=>r.action);assert.deepEqual(actions,['groupuser.moderation.save_bot','groupuser.moderation.save_group','groupuser.moderation.release_member'])
 })
 await test('native group verification serves the claw challenge and releases only the matching verified member',async()=>{
  const rawToken=randomBytes(32).toString('hex'),tokenHash=digest(rawToken)
  await pool.query("INSERT INTO t_telegram_verification(token_hash,bot_rid,chat_id,user_id,user_chat_id,verification_type,status,verification_message_id,expires_at,create_time,update_time) VALUES($1,7,-1001234567890,901,901,'ad_challenge','pending',77,now()+interval '15 minutes',now(),now())",[tokenHash])
  await pool.query("INSERT INTO t_telegram_moderated_member(bot_rid,chat_id,user_id,action,status,update_time) VALUES(7,-1001234567890,901,'restrict_forever','active',now())")
  const url='https://moderation.test/api/moderation?verify='+rawToken
  const show=await moderationApi(new Request(url));assert.equal(show.status,200);assert.match(show.headers.get('content-type')||'',/text\/html/);const page=await show.text();assert.match(page,/playcaptcha-root/);assert.match(page,/playcaptcha\.js/);const session=show.headers.get('set-cookie')?.split(';')[0];assert.ok(session)
  const previousFetch=globalThis.fetch,previousActions=process.env.PLATFORM_TELEGRAM_ACTIONS;process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:77}})
  try{const completed=await moderationApi(new Request(url,{method:'POST',headers:{origin:'https://moderation.test','content-type':'application/json','x-csrf-token':'native-verification',cookie:session!},body:'{}'}));assert.equal(completed.status,200);assert.equal((await completed.json()).message,'验证通过，可以返回 Telegram。');const row=(await pool.query('SELECT status,verified_at FROM t_telegram_verification WHERE token_hash=$1',[tokenHash])).rows[0];assert.equal(row.status,'verified');assert.ok(row.verified_at);const member=(await pool.query('SELECT status FROM t_telegram_moderated_member WHERE bot_rid=7 AND user_id=901')).rows[0];assert.equal(member.status,'released');const log=(await pool.query("SELECT event_type,action FROM t_telegram_moderation_log WHERE user_id=901")).rows[0];assert.deepEqual(log,{event_type:'ad_verification_passed',action:'passed'})}finally{globalThis.fetch=previousFetch;if(previousActions==null)delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=previousActions}
 })
 await test('verified join sends the saved welcome response and falls back when no template exists',async()=>{
  const previousFetch=globalThis.fetch,previousActions=process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS='true'
  await pool.query("UPDATE t_telegram_bot SET bot_token='12345:Abcdefghijklmnopqrstuvwxyz_123' WHERE rid=7")
  await pool.query("INSERT INTO t_telegram_bot_keyreply(rid,bot_rid,key_type,status,reply_content,reply_photo) VALUES(1,7,2,0,'欢迎加入','')")
  const calls:Array<{method:string;payload:Record<string,any>}> = []
  globalThis.fetch=async(input,init)=>{const method=String(input).split('/').pop()||'';const payload=JSON.parse(String(init?.body||'{}'));calls.push({method,payload});return method==='getChatMember'?Response.json({ok:true,result:{user:{first_name:'新成员',username:'new_member'}}}):Response.json({ok:true,result:{message_id:901}})}
  async function verify(type:'join_request'|'join_member',userId:number){
   const rawToken=randomBytes(32).toString('hex'),tokenHash=digest(rawToken)
   await pool.query("INSERT INTO t_telegram_verification(token_hash,bot_rid,chat_id,user_id,user_chat_id,verification_type,status,expires_at,create_time,update_time) VALUES($1,7,-1001234567890,$2,$2,$3,'pending',now()+interval '15 minutes',now(),now())",[tokenHash,userId,type])
   const url='https://moderation.test/api/moderation?verify='+rawToken,show=await moderationApi(new Request(url)),session=show.headers.get('set-cookie')?.split(';')[0]
   assert.ok(session)
   const completed=await moderationApi(new Request(url,{method:'POST',headers:{origin:'https://moderation.test','content-type':'application/json','x-csrf-token':'native-verification',cookie:session!},body:'{}'}))
   assert.equal(completed.status,200)
  }
  try{
   await verify('join_request',902)
   assert.deepEqual(calls.map(call=>call.method),['approveChatJoinRequest','getChatMember','sendMessage'])
   assert.equal(calls[2].payload.chat_id,'-1001234567890')
   assert.equal(calls[2].payload.text,'欢迎 新成员 加入群组！\n用户：@new_member\n欢迎加入')
   calls.length=0
   await pool.query('DELETE FROM t_telegram_bot_keyreply WHERE bot_rid=7')
   await verify('join_member',903)
   assert.deepEqual(calls.map(call=>call.method),['restrictChatMember','sendMessage'])
   assert.equal(calls[1].payload.text,'验证通过，欢迎加入。')
  }finally{globalThis.fetch=previousFetch;if(previousActions==null)delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=previousActions}
 })
 }finally{await pool.end()}
