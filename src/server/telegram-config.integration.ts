import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { TelegramConfigService, type CommandInput, type KeyboardInput } from './telegram-config-service.server'
import { BotServiceError, type BotDependencies } from './bot-service.server'
const url=process.env.TG_TEST_DB_URL
const testUrl=url?new URL(url):null
const privateTestHost=(()=>{if(!testUrl)return false;if(testUrl.hostname==='tg-native-test-pg')return true;const parts=testUrl.hostname.split('.').map(Number);return process.env.TG_CONFIG_API_TEST_ALLOW_PRIVATE_DB==='1'&&parts.length===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168))&&testUrl.username.startsWith('tgconfig_api_test_')&&testUrl.pathname.slice(1).startsWith('tgconfig_api_test_')})()
if(!url||!testUrl||!privateTestHost)throw new Error('Integration tests require a disposable sandbox PostgreSQL database and role')
const schema='config_'+randomUUID().replaceAll('-','')
const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema} -c timezone=Asia/Shanghai`,max:5})
const invalidated:number[]=[],calls:Array<{method:string;data:unknown}>=[]
const deps:Pick<BotDependencies,'invalidate'|'telegram'>={invalidate:async rid=>{invalidated.push(rid)},telegram:async(_token,method,data)=>{calls.push({method,data});return {}}}
const command=(bot_rid:number,name='start'):CommandInput=>({bot_rid,command:name,description:'Description',command_type:1,seq_sn:0})
const keyboard=(name='Test'):KeyboardInput=>({keyboard_type:2,keyboard_name:name,keyboard_icon_custom_emoji_id:null,inline_type:2,keyboard_value:'callback',seq_sn:0})
const tables=['t_telegram_bot','t_telegram_bot_command','t_telegram_bot_keyboard','t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad_keyboard','t_platform_audit_log']
await pool.query(`CREATE SCHEMA ${schema};
CREATE TABLE t_telegram_bot(rid serial PRIMARY KEY,bot_token text,bot_firstname text,bot_username text);
CREATE TABLE t_telegram_bot_command(rid serial PRIMARY KEY,bot_rid int,command_type int,command text,description text,seq_sn int,create_by int,create_time timestamp,update_by int,update_time timestamp);
CREATE TABLE t_telegram_bot_keyboard(rid serial PRIMARY KEY,keyboard_type int,keyboard_name text,keyboard_icon_custom_emoji_id text,inline_type int,keyboard_value text,seq_sn int,status int,create_by int,create_time timestamp,update_by int,update_time timestamp);
CREATE TABLE t_telegram_bot_keyreply_keyboard(rid serial PRIMARY KEY,keyboard_rid int,bot_rid int);
CREATE TABLE t_telegram_bot_ad_keyboard(rid serial PRIMARY KEY,keyboard_rid int,bot_rid int);
CREATE TABLE t_platform_audit_log(id serial PRIMARY KEY,admin_id int,action text,resource_id int);`)
async function reset(){await pool.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY`);await pool.query("INSERT INTO t_telegram_bot(bot_token,bot_firstname,bot_username) VALUES('fixture-token-1','First','first'),('fixture-token-2','Second','second'),('fixture-token-3','Third','third')");invalidated.length=0;calls.length=0}
try{
 await test('command CRUD keeps full fields, bot membership and audit within a transaction',async()=>{
  await reset();const service=new TelegramConfigService(pool,deps)
  const added=await service.saveCommand(command(1),'1')
  await assert.rejects(service.saveCommand(command(1),'1'),(error:unknown)=>error instanceof BotServiceError&&error.status===409)
  await service.saveCommand({...command(2,'updated'),command_type:3,seq_sn:20},'1',added.rid)
  const page=await service.list('command',1,10,'updated',2);assert.equal(page.total,1);assert.equal(page.rows[0].command_type,3);assert.equal(page.rows[0].seq_sn,20);assert.equal(page.rows[0].bot_firstname,'Second')
  assert.deepEqual(invalidated,[1,1,1,2,1,2])
  await service.remove('command',added.rid,'1');assert.equal((await service.list('command',1,10,'')).total,0)
  assert.equal((await pool.query('SELECT count(*)::int n FROM t_platform_audit_log')).rows[0].n,3)
 })
 await test('command copy replaces only the target and refuses empty or identical sources',async()=>{
  await reset();const service=new TelegramConfigService(pool,deps)
  await service.saveCommand(command(1,'source'),'1');await service.saveCommand(command(2,'old'),'1');await service.saveCommand(command(3,'unrelated'),'1')
  await service.copyCommands(1,2,'1')
  assert.equal((await service.list('command',1,10,'',2)).rows[0].command,'source')
  assert.equal((await service.list('command',1,10,'',3)).rows[0].command,'unrelated')
  await assert.rejects(service.copyCommands(1,1,'1'),BotServiceError)
  await pool.query('DELETE FROM t_telegram_bot_command WHERE bot_rid=1')
  await assert.rejects(service.copyCommands(1,2,'1'),BotServiceError)
  assert.equal((await service.list('command',1,10,'',2)).total,1)
 })
 await test('failed command copy rolls back replacement and its audit entry',async()=>{
  await reset();const normal=new TelegramConfigService(pool,deps)
  await normal.saveCommand(command(1,'source'),'1');await normal.saveCommand(command(2,'old'),'1')
  const broken=new TelegramConfigService(pool,{...deps,invalidate:async()=>{throw new Error('fixture failure')}})
  await assert.rejects(broken.copyCommands(1,2,'1'))
  assert.equal((await normal.list('command',1,10,'',2)).rows[0].command,'old')
  assert.equal((await pool.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action='telegram.command.copy'")).rows[0].n,0)
 })
 await test('sync checks and sends both scopes in deterministic configured order',async()=>{
  await reset();const service=new TelegramConfigService(pool,deps)
  await service.saveCommand({...command(1,'common'),seq_sn:10},'1');await service.saveCommand({...command(1,'private'),command_type:2,seq_sn:30},'1');await service.saveCommand({...command(1,'group'),command_type:3,seq_sn:20},'1')
  await service.syncCommands(1,'1')
  assert.deepEqual(calls,[{method:'setMyCommands',data:{commands:[{command:'private',description:'Description'},{command:'common',description:'Description'}],scope:{type:'all_private_chats'}}},{method:'setMyCommands',data:{commands:[{command:'group',description:'Description'},{command:'common',description:'Description'}],scope:{type:'all_group_chats'}}}])
  let attempt=0
  const broken=new TelegramConfigService(pool,{...deps,telegram:async()=>{if(++attempt===2)throw new Error('fixture failure');return {}}})
  await assert.rejects(broken.syncCommands(1,'1'),(error:unknown)=>error instanceof BotServiceError&&/群聊/.test(error.message))
 })
 await test('keyboard uniqueness handles NULL emoji IDs and status updates are idempotent',async()=>{
  await reset();const service=new TelegramConfigService(pool,deps)
  const added=await service.saveKeyboard(keyboard(),'1')
  await assert.rejects(service.saveKeyboard(keyboard(),'1'),(error:unknown)=>error instanceof BotServiceError&&error.status===409)
  await service.saveKeyboard({...keyboard('Updated'),keyboard_icon_custom_emoji_id:'1234567890123456789',inline_type:1,keyboard_value:'https://example.test',seq_sn:12},'1',added.rid)
  await service.status(added.rid,false,'1');await service.status(added.rid,false,'1')
  let row=(await service.list('keyboard',1,10,'Updated')).rows[0];assert.equal(row.status,1);assert.equal(row.keyboard_icon_custom_emoji_id,'1234567890123456789');assert.equal(row.seq_sn,12)
  await service.status(added.rid,true,'1');row=(await service.list('keyboard',1,10,'Updated')).rows[0];assert.equal(row.status,0)
 })
 await test('keyboard updates invalidate every using bot and both reference types prevent deletion',async()=>{
  await reset();const service=new TelegramConfigService(pool,deps)
  const added=await service.saveKeyboard(keyboard(),'1')
  await pool.query('INSERT INTO t_telegram_bot_keyreply_keyboard(keyboard_rid,bot_rid) VALUES($1,1)',[added.rid]);await pool.query('INSERT INTO t_telegram_bot_ad_keyboard(keyboard_rid,bot_rid) VALUES($1,2)',[added.rid])
  await service.status(added.rid,false,'1');assert.deepEqual(invalidated,[1,2,1,2])
  await assert.rejects(service.remove('keyboard',added.rid,'1'),BotServiceError)
  await pool.query('DELETE FROM t_telegram_bot_keyreply_keyboard')
  await assert.rejects(service.remove('keyboard',added.rid,'1'),BotServiceError)
  await pool.query('DELETE FROM t_telegram_bot_ad_keyboard');await service.remove('keyboard',added.rid,'1')
  assert.equal((await service.list('keyboard',1,10,'')).total,0)
 })
}finally{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end()}
