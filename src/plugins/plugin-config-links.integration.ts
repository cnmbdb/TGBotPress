import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { Pool, QueryResultRow } from 'pg'
import { db } from '../server/db.server'
import { annotatePluginConfigRows, enqueuePluginConfigRefresh, setPluginConfigAssociations } from './plugin-config-links.server'
import { syncPluginConfigRefresh } from '../server/plugin-config-refresh.server'

test('plugin configuration links preserve manual status and combine active shared plugins', async t => {
  if (!process.env.PLATFORM_DB_HOST && !process.env.DB_HOST) { t.skip('No sandbox PostgreSQL configured'); return }
  const schema='plugin_config_link_test_'+randomUUID().replaceAll('-','')
  await db.query('CREATE SCHEMA "'+schema+'"')
  const connect=db.connect.bind(db)
  const isolated={
    connect:async()=>{const client=await connect();await client.query('SET search_path TO "'+schema+'",public');return client},
    query:async <T extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>{const client=await connect();try{await client.query('SET search_path TO "'+schema+'",public');return await client.query<T>(sql,values)}finally{client.release()}}
  } as unknown as Pool
  try{
    await isolated.query('CREATE TABLE t_platform_plugin_lifecycle(plugin_id text primary key,state text not null)')
    await isolated.query('CREATE TABLE t_telegram_bot(rid bigint primary key,bot_token text not null)')
    await isolated.query("INSERT INTO t_telegram_bot(rid,bot_token) VALUES (9,'sandbox-token')")
    await isolated.query("INSERT INTO t_platform_plugin_lifecycle(plugin_id,state) VALUES ('energy','active'),('transit','active'),('premium','active'),('shop','active'),('cloneproxy','active'),('monitor','active')")
    await isolated.query("CREATE TABLE t_telegram_bot_command(rid serial primary key,bot_rid bigint not null,command text not null,description text not null default '',command_type integer not null default 1,seq_sn integer not null default 0,status integer not null default 0)")
    await isolated.query('CREATE TABLE t_telegram_bot_keyreply(rid serial primary key,bot_rid bigint not null,monitor_word text not null,opt_type integer not null,status integer not null default 0)')
    await isolated.query('CREATE TABLE t_telegram_bot_keyboard(rid serial primary key,keyboard_name text not null,status integer not null default 0)')
    await isolated.query('CREATE TABLE t_telegram_bot_keyreply_keyboard(rid serial primary key,bot_rid bigint not null,keyreply_rid bigint not null,keyboard_rid bigint not null)')
    await isolated.query('CREATE TABLE t_telegram_bot_ad_keyboard(rid serial primary key,bot_rid bigint not null,keyboard_rid bigint not null)')
    await isolated.query('CREATE TABLE t_platform_audit_log(admin_id text,action text,resource_id bigint)')
    await isolated.query("INSERT INTO t_telegram_bot_command(bot_rid,command,description,command_type,status) VALUES (9,'buyenergy','Buy energy',1,0),(9,'start','Start',1,0)")
    await isolated.query("INSERT INTO t_telegram_bot_keyreply(bot_rid,monitor_word,opt_type,status) VALUES (9,'能量套餐',3,0),(9,'个人中心',8,0),(9,'普通共享回复',1,0),(9,'克隆/代理入口',1,0)")
    await isolated.query("INSERT INTO t_telegram_bot_keyboard(keyboard_name,status) VALUES ('能量菜单',0),('克隆/代理',0)")
    await isolated.query('INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid,keyboard_rid) VALUES (9,1,1),(9,4,2)')
    await isolated.query(await readFile(new URL('../../migrations/028-plugin-telegram-config-links.sql',import.meta.url),'utf8'))

    const targets=async(type:string,bot:number,rid:number,name:string|null,opt:number|null)=>{const result=await isolated.query<{targets:string[]}>('SELECT platform_plugin_config_targets($1,$2,$3,$4,$5) AS targets',[type,bot,rid,name,opt]);return result.rows[0].targets.sort()}
    const effective=async(type:string,bot:number,rid:number,name:string|null,opt:number|null)=>{const result=await isolated.query<{effective:boolean}>('SELECT platform_plugin_config_effective($1,$2,$3,$4,$5) AS effective',[type,bot,rid,name,opt]);return result.rows[0].effective}
    assert.deepEqual(await targets('command',9,1,'buyenergy',null),['energy'])
    assert.deepEqual(await targets('command',9,2,'start',null),[])
    assert.deepEqual(await targets('keyreply',9,2,'个人中心',8),['energy','premium','transit'])
    assert.deepEqual(await targets('keyboard',0,1,'能量菜单',null),['energy'])
    assert.deepEqual(await targets('keyreply_keyboard',9,1,null,null),['energy'])
    assert.equal(await effective('command',9,1,'buyenergy',null),true)
    assert.equal(await effective('command',9,2,'start',null),true)
    assert.equal(await effective('keyreply',9,3,'普通共享回复',1),true)
    const annotated=await annotatePluginConfigRows(isolated,'command',[{rid:1,bot_rid:9,command:'buyenergy'}])
    assert.deepEqual(annotated[0].plugin_ids,['energy'])
    assert.deepEqual(annotated[0].plugin_names,['能量管理'])
    assert.equal(annotated[0].plugin_effective,true)

    await isolated.query("UPDATE t_telegram_bot_keyreply SET status=1 WHERE rid=3")
    await isolated.query("UPDATE t_platform_plugin_lifecycle SET state='uninstalled' WHERE plugin_id='energy'")
    assert.equal(await effective('command',9,1,'buyenergy',null),false,'uninstall disables linked config')
    await isolated.query("UPDATE t_platform_plugin_lifecycle SET state='active' WHERE plugin_id='energy'")
    assert.equal(await effective('command',9,1,'buyenergy',null),true,'reinstall restores linked config')
    const manualOff=await isolated.query<{status:number;effective:boolean}>("SELECT status,platform_plugin_config_effective('keyreply',bot_rid,rid,monitor_word,opt_type) AS effective FROM t_telegram_bot_keyreply WHERE rid=3")
    assert.equal(manualOff.rows[0].status,1,'original manual off state is preserved')
    assert.equal(manualOff.rows[0].effective,true,'shared config remains plugin-effective while its manual switch stays off')
    const deliverable=await isolated.query<{count:number}>("SELECT count(*)::int AS count FROM t_telegram_bot_keyreply WHERE rid=3 AND status=0 AND platform_plugin_config_effective('keyreply',bot_rid,rid,monitor_word,opt_type)")
    assert.equal(deliverable.rows[0].count,0,'manual off config stays excluded after reinstall')
    await isolated.query("UPDATE t_platform_plugin_lifecycle SET state='draining' WHERE plugin_id='energy'")
    assert.equal(await effective('command',9,1,'buyenergy',null),false)
    assert.equal((await annotatePluginConfigRows(isolated,'command',[{rid:1,bot_rid:9,command:'buyenergy'}]))[0].plugin_effective,false)
    assert.equal(await effective('keyreply_keyboard',9,1,null,null),false)
    await setPluginConfigAssociations(isolated,{type:'keyreply_keyboard',configRid:1,botRid:9,pluginIds:['shop'],actor:'test-admin'})
    const relationMetadata=await annotatePluginConfigRows(isolated,'keyreply_keyboard',[{rid:1,bot_rid:9}])
    assert.equal(relationMetadata[0].plugin_effective,false,'relation UI also reflects its paused parent reply and keyboard')
    await setPluginConfigAssociations(isolated,{type:'keyreply_keyboard',configRid:1,botRid:9,pluginIds:[],actor:'test-admin',resetAuto:true})
    await enqueuePluginConfigRefresh(isolated,'energy')
    const lifecycleRefresh=await isolated.query<{status:string}>('SELECT status FROM t_platform_plugin_config_refresh WHERE bot_rid=9')
    assert.equal(lifecycleRefresh.rows[0].status,'pending','plugin transitions enqueue a bot command and keyboard refresh')
    const telegramCalls:Array<{commands:Array<{command:string}>}>=[]
    const flushed=await syncPluginConfigRefresh({pool:isolated,enabled:true,dependencies:{telegram:async(_token,_method,payload)=>{telegramCalls.push(payload as {commands:Array<{command:string}>});return{}},invalidate:async()=>{}}})
    assert.deepEqual(flushed,{skipped:false,processed:1,failed:0})
    assert.equal(telegramCalls.length,2)
    const syncedCommands=telegramCalls.flatMap(call=>call.commands.map(command=>command.command))
    assert.ok(syncedCommands.includes('start'))
    assert.ok(!syncedCommands.includes('buyenergy'),'disabled plugin command is omitted from Telegram scopes')
    assert.equal((await isolated.query<{status:string}>('SELECT status FROM t_platform_plugin_config_refresh WHERE bot_rid=9')).rows[0].status,'done')
    assert.equal(await effective('keyreply',9,2,'个人中心',8),true,'shared reply stays effective while another linked plugin is active')
    await isolated.query("UPDATE t_platform_plugin_lifecycle SET state='uninstalled' WHERE plugin_id IN ('transit','premium')")
    assert.equal(await effective('keyreply',9,2,'个人中心',8),false)
    assert.equal(await effective('keyreply',9,3,'普通共享回复',1),true)

    await setPluginConfigAssociations(isolated,{type:'command',configRid:1,botRid:9,pluginIds:['shop'],actor:'test-admin'})
    assert.deepEqual(await targets('command',9,1,'buyenergy',null),['shop'])
    assert.equal(await effective('command',9,1,'buyenergy',null),true,'manual override replaces automatic energy mapping')
    await setPluginConfigAssociations(isolated,{type:'command',configRid:1,botRid:9,pluginIds:[],actor:'test-admin',resetAuto:true})
    assert.deepEqual(await targets('command',9,1,'buyenergy',null),['energy'],'reset restores automatic mapping')
    await setPluginConfigAssociations(isolated,{type:'command',configRid:1,botRid:9,pluginIds:[],actor:'test-admin'})
    assert.deepEqual(await targets('command',9,1,'buyenergy',null),[],'empty manual selection explicitly marks shared')
    assert.equal(await effective('command',9,1,'buyenergy',null),true)
    const preserved=await isolated.query<{status:number}>('SELECT status FROM t_telegram_bot_command WHERE rid=1')
    assert.equal(preserved.rows[0].status,0,'plugin transitions never rewrite the manual status field')
    const refresh=await isolated.query<{status:string}>('SELECT status FROM t_platform_plugin_config_refresh WHERE bot_rid=9')
    assert.equal(refresh.rows[0].status,'pending')
    assert.equal((await isolated.query('SELECT count(*)::int AS count FROM t_platform_audit_log')).rows[0].count,5)
  }finally{await db.query('DROP SCHEMA "'+schema+'" CASCADE')}
})
