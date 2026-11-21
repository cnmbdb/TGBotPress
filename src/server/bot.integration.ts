import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { BotService, BotServiceError, webhookSecret, type BotDependencies } from './bot-service.server'

const connectionString=process.env.TG_TEST_DB_URL
const testUrl=connectionString?new URL(connectionString):null
const privateTestHost=(()=>{if(!testUrl)return false;if(testUrl.hostname==='tg-native-test-pg')return true;const parts=testUrl.hostname.split('.').map(Number);return process.env.TG_TEST_ALLOW_PRIVATE_DB==='1'&&parts.length===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168))&&testUrl.username.startsWith('tgbot_api_test_')&&testUrl.pathname.slice(1).startsWith('tgbot_api_test_')})()
if(!connectionString || !testUrl || !privateTestHost) throw new Error('Integration tests require a disposable sandbox PostgreSQL database and role')
const schema='test_'+randomUUID().replaceAll('-','')
const pool=new pg.Pool({connectionString,options:`-c search_path=${schema} -c timezone=Asia/Shanghai`,max:5})
const fixture=`
 CREATE SCHEMA ${schema};
 CREATE TABLE t_telegram_bot(rid serial PRIMARY KEY,bot_token varchar(100) NOT NULL,bot_admin_username varchar(100),bot_firstname varchar(100),bot_username varchar(100),comments varchar(255),create_by int,create_time timestamp,update_by int,update_time timestamp,recharge_wallet_addr varchar(100),get_tx_time timestamp);
 CREATE TABLE t_telegram_bot_command(rid serial PRIMARY KEY,bot_rid int,command text,description text,command_type int,seq_sn int,create_by int,create_time timestamp,update_by int,update_time timestamp);
 CREATE TABLE t_telegram_bot_keyreply(rid serial PRIMARY KEY,bot_rid int,key_type int,monitor_word text,reply_photo text,reply_content text,opt_type int,status int,create_by int,create_time timestamp,update_by int,update_time timestamp);
 CREATE TABLE t_telegram_bot_keyboard(rid serial PRIMARY KEY,label text);
 CREATE TABLE t_telegram_bot_keyreply_keyboard(rid serial PRIMARY KEY,bot_rid int,keyreply_rid int,keyboard_rid int,create_by int,create_time timestamp,update_by int,update_time timestamp);
 CREATE TABLE t_telegram_bot_ad(rid serial PRIMARY KEY,bot_rid int,notice_cycle int,notice_obj text,notice_photo text,notice_ad text,status int,last_notice_time timestamp,create_by int,create_time timestamp,update_by int,update_time timestamp);
 CREATE TABLE t_telegram_bot_ad_keyboard(rid serial PRIMARY KEY,bot_rid int,ad_rid int,keyboard_rid int,create_by int,create_time timestamp,update_by int,update_time timestamp);
 CREATE TABLE t_energy_platform_bot(rid serial PRIMARY KEY,bot_rid int,receive_wallet text);
 CREATE TABLE t_transit_wallet(rid serial PRIMARY KEY,bot_rid int,receive_wallet text);
 CREATE TABLE t_premium_platform(rid serial PRIMARY KEY,receive_wallet text);
 CREATE TABLE t_platform_audit_log(id serial PRIMARY KEY,admin_id int,action text,resource_id int);
 ${['t_telegram_bot_group','t_telegram_bot_user','t_collection_wallet','t_telegram_moderation_log','t_telegram_group_message_history','t_telegram_support_message','t_telegram_verification','t_telegram_bot_group_policy','t_telegram_bot_moderation_config'].map(table=>`CREATE TABLE ${table}(rid serial PRIMARY KEY,bot_rid int);`).join('\n')}
`
const token=(id:number)=>`${id}00000:ABCDEFGHIJKLMNOPQRSTUV_testonly`
const tables=['t_telegram_bot','t_telegram_bot_command','t_telegram_bot_keyreply','t_telegram_bot_keyboard','t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad','t_telegram_bot_ad_keyboard','t_energy_platform_bot','t_transit_wallet','t_premium_platform','t_platform_audit_log','t_telegram_bot_group','t_telegram_bot_user','t_collection_wallet','t_telegram_moderation_log','t_telegram_group_message_history','t_telegram_support_message','t_telegram_verification','t_telegram_bot_group_policy','t_telegram_bot_moderation_config']
const invalidated:number[]=[]
const calls:Array<{token:string;method:string;data:unknown}>=[]
const dependencies:BotDependencies={invalidate:async rid=>{invalidated.push(rid)},telegram:async(token,method,data)=>{calls.push({token,method,data});return method==='getMe'?{id:11,first_name:'Refreshed',username:'refreshed_bot'}:{}},templateRid:1,autoClone:true}
async function reset(){await pool.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY`);invalidated.length=0;calls.length=0}
async function bot(id:number){return (await pool.query('INSERT INTO t_telegram_bot(bot_token,bot_firstname,bot_username,comments) VALUES($1,$2,$3,$4) RETURNING rid',[token(id),`Bot ${id}`,`bot_${id}`,'fixture'])).rows[0].rid as number}
async function config(rid:number){
 await pool.query("INSERT INTO t_telegram_bot_command(bot_rid,command,description,command_type,seq_sn) VALUES($1,'start','Start',1,1)",[rid])
 const reply=(await pool.query("INSERT INTO t_telegram_bot_keyreply(bot_rid,key_type,monitor_word,reply_content,opt_type,status) VALUES($1,1,'hi','hello',1,1) RETURNING rid",[rid])).rows[0].rid
 const keyboard=(await pool.query("INSERT INTO t_telegram_bot_keyboard(label) VALUES('shared') RETURNING rid")).rows[0].rid
 await pool.query('INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid,keyboard_rid) VALUES($1,$2,$3)',[rid,reply,keyboard])
 const ad=(await pool.query("INSERT INTO t_telegram_bot_ad(bot_rid,notice_cycle,notice_obj,notice_ad,status) VALUES($1,1,'123','ad',1) RETURNING rid",[rid])).rows[0].rid
 await pool.query('INSERT INTO t_telegram_bot_ad_keyboard(bot_rid,ad_rid,keyboard_rid) VALUES($1,$2,$3)',[rid,ad,keyboard])
 return {reply,keyboard,ad}
}
await pool.query(fixture)
try {
 await test('add atomically inherits all five template configuration sets with remapped IDs',async()=>{
  await reset();const source=await bot(1);const original=await config(source)
  const service=new BotService(pool,dependencies)
  const added=await service.add({bot_token:token(2),bot_admin_username:'@operator',comments:'new'},'1')
  assert.equal(added.rid,2)
  for(const table of ['t_telegram_bot_command','t_telegram_bot_keyreply','t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad','t_telegram_bot_ad_keyboard'])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE bot_rid=2`)).rows[0].n,1)
  const relation=(await pool.query('SELECT r.rid,r.bot_rid,k.keyreply_rid,k.keyboard_rid FROM t_telegram_bot_keyreply r JOIN t_telegram_bot_keyreply_keyboard k ON k.keyreply_rid=r.rid WHERE r.bot_rid=2')).rows[0]
  assert.notEqual(relation.rid,original.reply);assert.equal(relation.keyboard_rid,original.keyboard)
  const adRelation=(await pool.query('SELECT a.rid,k.ad_rid FROM t_telegram_bot_ad a JOIN t_telegram_bot_ad_keyboard k ON k.ad_rid=a.rid WHERE a.bot_rid=2')).rows[0]
  assert.notEqual(adRelation.rid,original.ad);assert.equal(adRelation.rid,adRelation.ad_rid)
  assert.deepEqual(invalidated,[2,2]);assert.equal((await pool.query('SELECT count(*)::int n FROM t_platform_audit_log')).rows[0].n,1)
 })
 await test('copy refuses existing target data until overwrite is explicitly selected',async()=>{
  await reset();await bot(1);await bot(2);await config(1);await config(2)
  const service=new BotService(pool,dependencies)
  await assert.rejects(service.clone(2,1,false,'1'),(error:unknown)=>error instanceof BotServiceError && error.status===409)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_platform_audit_log')).rows[0].n,0)
  const result=await service.clone(2,1,true,'1');assert.equal(result.commands,1);assert.equal(result.replyKeyboards,1);assert.equal(result.adKeyboards,1)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot_command WHERE bot_rid=2')).rows[0].n,1)
  await assert.rejects(service.clone(1,1,true,'1'),BotServiceError)
 })
 await test('delete cleans every original relation and preserves keyboard references used by another bot',async()=>{
  await reset();await bot(1);await bot(2);const own=await config(1)
  await pool.query('INSERT INTO t_telegram_bot_ad_keyboard(bot_rid,ad_rid,keyboard_rid) VALUES(2,999,$1)',[own.keyboard])
  const orphan=(await pool.query("INSERT INTO t_telegram_bot_keyboard(label) VALUES('orphan') RETURNING rid")).rows[0].rid
  await pool.query('INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid,keyboard_rid) VALUES(1,$1,$2)',[own.reply,orphan])
  for(const table of tables.filter(table=>!['t_telegram_bot','t_telegram_bot_keyboard','t_premium_platform','t_platform_audit_log'].includes(table)&&!['t_telegram_bot_command','t_telegram_bot_keyreply','t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad','t_telegram_bot_ad_keyboard'].includes(table)))await pool.query(`INSERT INTO ${table}(bot_rid) VALUES(1)`)
  await new BotService(pool,dependencies).remove(1,'1')
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot WHERE rid=1')).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot WHERE rid=2')).rows[0].n,1)
  assert.deepEqual((await pool.query('SELECT rid FROM t_telegram_bot_keyboard ORDER BY rid')).rows.map(row=>row.rid),[own.keyboard])
  for(const table of tables.filter(table=>!['t_telegram_bot','t_telegram_bot_keyboard','t_premium_platform','t_platform_audit_log'].includes(table)))assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE bot_rid=1`)).rows[0].n,0)
 })
 await test('duplicate concurrent inserts serialize and create one record and one audit entry',async()=>{
  await reset();const service=new BotService(pool,{...dependencies,autoClone:false})
  const result=await Promise.allSettled([service.add({bot_token:token(3),bot_admin_username:'',comments:''},'1'),service.add({bot_token:token(3),bot_admin_username:'',comments:''},'1')])
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot')).rows[0].n,1)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_platform_audit_log')).rows[0].n,1)
 })
 await test('cache failure aborts the database mutation and audit together',async()=>{
  await reset();const service=new BotService(pool,{...dependencies,autoClone:false,invalidate:async()=>{throw new Error('fixture failure')}})
  await assert.rejects(service.add({bot_token:token(4),bot_admin_username:'',comments:''},'1'))
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_telegram_bot')).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_platform_audit_log')).rows[0].n,0)
 })
 await test('recharge checks all three business wallet types before saving',async()=>{
  await reset();await bot(1);await bot(2);const service=new BotService(pool,dependencies)
  for(const table of ['t_energy_platform_bot','t_premium_platform','t_transit_wallet']){
   await pool.query(`INSERT INTO ${table}(receive_wallet) VALUES('collision')`)
   await assert.rejects(service.recharge(1,'collision','2026-10-27T10:20','1'),(error:unknown)=>error instanceof BotServiceError&&error.status===409)
   await pool.query(`DELETE FROM ${table}`)
  }
  await pool.query("UPDATE t_telegram_bot SET recharge_wallet_addr='duplicate' WHERE rid=2")
  await assert.rejects(service.recharge(1,'duplicate','','1'),BotServiceError)
  await service.recharge(1,'unique-wallet','2026-10-27T10:20','1')
  const detail=await service.detail(1);assert.equal(detail.recharge_wallet_addr,'unique-wallet');assert.equal(detail.get_tx_time,'2026-10-27T10:20')
 })
 await test('changing the bot token refreshes the stored Telegram account identity',async()=>{
  await reset();await bot(1);const service=new BotService(pool,dependencies),replacement=token(8)
  await service.update(1,{bot_token:replacement,bot_admin_username:'@operator',comments:'updated token'},'1')
  const detail=await service.detail(1)
  assert.equal(detail.bot_token,replacement);assert.equal(detail.bot_firstname,'Refreshed');assert.equal(detail.bot_username,'refreshed_bot')
  assert.ok(calls.some(call=>call.method==='getMe'&&call.token===replacement))
 })
 await test('update and Telegram transport preserve metadata and send the complete authenticated webhook payload',async()=>{
  await reset();await bot(1);const service=new BotService(pool,dependencies)
  await service.update(1,{bot_token:'',bot_admin_username:'@admin',comments:"literal '; DROP TABLE x; --"},'1')
  assert.equal((await service.detail(1)).bot_token,token(1))
  await service.refresh(1,'1');assert.equal((await service.detail(1)).bot_firstname,'Refreshed')
  process.env.WEB_URL='https://worker.example';process.env.TELEGRAM_WEBHOOK_SECRET_KEY='01234567890123456789012345678901'
  await service.webhook(1,'1')
  const call=calls.find(call=>call.method==='setWebhook')!
  assert.deepEqual(call.data,{url:'https://worker.example/api/telegram/getdata?rid=1',secret_token:webhookSecret(1,token(1),process.env.TELEGRAM_WEBHOOK_SECRET_KEY,''),allowed_updates:['message','edited_message','callback_query','my_chat_member','chat_member','chat_join_request']})
 })
} finally { await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end() }
