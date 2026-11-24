import { randomUUID } from 'node:crypto'
import type { DatabaseConnection as Pool } from '../server/database.types'
import { identity } from '../server/api.server'
import { runPluginTaskWithLease } from './module-lifecycle.server'
import { pluginInstallRecords } from './install-records.server'
import { deactivateInstalledPlugin, loadInstalledPlugin } from './plugin-runtime.server'
import { pluginStorage } from './plugin-storage.server'
import { createPluginTelegramApi } from './telegram-api.server'
import { pluginInstallRoot, removeInstalledPluginFiles } from './package-installer.server'

type Db = Pick<Pool, 'query' | 'connect'>
type DynamicInstall = { plugin_id: string; package_name: string; version: string; install_path: string; state: 'active'|'draining'|'uninstalled' }
type Logger = Pick<Console, 'error'>
type RuntimeSnapshot = { expiresAt: number; rows: DynamicInstall[] }
const runtimeSnapshots = new WeakMap<object, Map<string, RuntimeSnapshot>>()
const telegramUpdateTypeSnapshots = new WeakMap<object,Map<string,{expiresAt:number;types:string[]}>>()
const botInstanceSnapshots = new WeakMap<object,Map<number,{expiresAt:number;pluginIds:Set<string>}>>()

function safePluginError(error: unknown) {
  const detail=(error instanceof Error?`${error.name}: ${error.message}`:'PluginError: plugin handler failed')
    .replace(/bot\d+:[A-Za-z0-9_-]{20,}/gu,'bot[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/giu,'Bearer [REDACTED]')
    .replace(/\b(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu,'$1=[REDACTED]')
  return detail.slice(0,500)
}

export function invalidateThirdPartyPluginRegistry(pool?: object) {
  if (pool) { runtimeSnapshots.delete(pool); telegramUpdateTypeSnapshots.delete(pool); botInstanceSnapshots.delete(pool) }
}

function cachedTelegramTypes(pool:object) {
  let snapshots=telegramUpdateTypeSnapshots.get(pool)
  if(!snapshots){snapshots=new Map();telegramUpdateTypeSnapshots.set(pool,snapshots)}
  return snapshots
}

async function enabledPluginsForBot(pool:Pick<Pool,'query'>,botId:number) {
  let snapshots=botInstanceSnapshots.get(pool)
  if(!snapshots){snapshots=new Map();botInstanceSnapshots.set(pool,snapshots)}
  const cached=snapshots.get(botId)
  if(cached&&cached.expiresAt>Date.now())return cached.pluginIds
  const result=await pool.query<{plugin_id:string}>("SELECT plugin_id FROM t_platform_plugin_instance WHERE bot_id=$1 AND state='active'",[botId])
  const enabledPluginIds=new Set(result.rows.map(row=>row.plugin_id))
  snapshots.set(botId,{expiresAt:Date.now()+1_000,pluginIds:enabledPluginIds})
  return enabledPluginIds
}

async function enabledBotIds(pool:Pick<Pool,'query'>,pluginId:string) {
  const result=await pool.query<{bot_id:number}>("SELECT b.rid::int AS bot_id FROM t_telegram_bot b JOIN t_platform_plugin_instance x ON x.bot_id=b.rid AND x.plugin_id=$1 AND x.state='active' WHERE COALESCE(b.bot_token,'')<>'' ORDER BY b.rid",[pluginId])
  return result.rows.map(row=>row.bot_id)
}

async function thirdPartyBotEventAllowed(pool:Pick<Pool,'query'>,pluginId:string,botId:number,receivedAt?:Date|string|null) {
  const result=await pool.query<{enabled_at:Date|string|null}>('SELECT enabled_at FROM t_platform_plugin_instance WHERE plugin_id=$1 AND bot_id=$2 AND state=\'active\' LIMIT 1',[pluginId,botId])
  if(!result.rowCount)return false
  const enabledAt=result.rows[0]?.enabled_at
  return !receivedAt||!enabledAt||new Date(receivedAt).getTime()>=new Date(enabledAt).getTime()
}

export async function setThirdPartyPluginBotEnabled(pool:Db,pluginId:string,botId:number,enabled:boolean) {
  if(!Number.isSafeInteger(botId)||botId<1)throw new Error('plugin_bot_id_invalid')
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':lifecycle',0))",[pluginId])
    const install=await client.query<{state:string;manifest_json:unknown}>('SELECT l.state,i.manifest_json FROM t_platform_plugin_lifecycle l JOIN t_platform_plugin_install i ON i.plugin_id=l.plugin_id WHERE l.plugin_id=$1 AND i.source=\'npmjs\' AND i.status=\'installed\' FOR UPDATE OF l',[pluginId])
    if(install.rows[0]?.state!=='active')throw new Error('plugin_not_active')
    const bot=await client.query<{rid:number}>('SELECT rid FROM t_telegram_bot WHERE rid=$1 AND COALESCE(bot_token,\'\')<>\'\' FOR UPDATE',[botId])
    if(!bot.rowCount)throw new Error('plugin_bot_not_found')
    const manifest=typeof install.rows[0].manifest_json==='object'?install.rows[0].manifest_json as {contributes?:{commands?:Array<{name:string;description:string}>}}:undefined
    const commands=manifest?.contributes?.commands??[]
    if(!enabled){
      const running=await client.query<{count:number}>(`SELECT count(*)::int AS count FROM t_platform_plugin_execution
        WHERE plugin_id=$1 AND lease_until>now() AND (task_name LIKE $2 OR task_name LIKE $3)`,[pluginId,`telegram-update:${botId}:%`,`task:bot:${botId}:%`])
      if(Number(running.rows[0]?.count??0)>0)throw new Error('plugin_bot_tasks_still_running:'+running.rows[0]?.count)
      await client.query('DELETE FROM t_platform_plugin_command WHERE plugin_id=$1 AND bot_id=$2',[pluginId,botId])
    }else if(commands.length){
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin-commands:'||$1,0))",[botId])
      for(const command of commands){
        const staticOwner=await client.query<{command:string}>("SELECT command FROM t_telegram_bot_command c WHERE c.bot_rid=$1 AND c.status=0 AND c.command=$2 AND platform_plugin_config_effective('command',c.bot_rid,c.rid,c.command,NULL) LIMIT 1",[botId,command.name])
        if(staticOwner.rowCount)throw new Error('plugin_command_conflict:'+command.name)
        const reservation=await client.query<{plugin_id:string}>(`INSERT INTO t_platform_plugin_command(plugin_id,bot_id,command_name,description,updated_at)
          VALUES($1,$2,$3,$4,now()) ON CONFLICT(bot_id,command_name) DO NOTHING RETURNING plugin_id`,[pluginId,botId,command.name,command.description])
        if(!reservation.rowCount){
          const owner=await client.query<{plugin_id:string}>('SELECT plugin_id FROM t_platform_plugin_command WHERE bot_id=$1 AND command_name=$2',[botId,command.name])
          if(owner.rows[0]?.plugin_id!==pluginId)throw new Error('plugin_command_conflict:'+command.name)
        }
      }
    }
    await client.query(`INSERT INTO t_platform_plugin_instance(plugin_id,bot_id,state,enabled_at,disabled_at,updated_at)
      VALUES($1,$2,$3,CASE WHEN $3='active' THEN now() ELSE NULL END,CASE WHEN $3='disabled' THEN now() ELSE NULL END,now())
      ON CONFLICT(plugin_id,bot_id) DO UPDATE SET state=EXCLUDED.state,
        enabled_at=CASE WHEN EXCLUDED.state='active' THEN now() ELSE t_platform_plugin_instance.enabled_at END,
        disabled_at=CASE WHEN EXCLUDED.state='disabled' THEN now() ELSE t_platform_plugin_instance.disabled_at END,updated_at=now()`,[pluginId,botId,enabled?'active':'disabled'])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
  invalidateThirdPartyPluginRegistry(pool)
  return {pluginId,botId,enabled}
}

function cachedRegistry(pool: object) {
  let snapshots = runtimeSnapshots.get(pool)
  if (!snapshots) { snapshots = new Map(); runtimeSnapshots.set(pool, snapshots) }
  return snapshots
}

function loadDynamicPlugin(pool: Db, install: DynamicInstall) {
  return loadInstalledPlugin(install.plugin_id,install.install_path,install.package_name,'npmjs',pluginStorage(pool,install.plugin_id),createPluginTelegramApi(pool,install.plugin_id))
}

async function claimTaskSchedule(pool: Pick<Pool,'query'>, pluginId: string, taskId: string, intervalMs: number) {
  const result=await pool.query<{task_id:string}>(`INSERT INTO t_platform_plugin_task_schedule(plugin_id,task_id,next_run_at,updated_at)
    VALUES($1,$2,now()+($3::bigint*interval '1 millisecond'),now())
    ON CONFLICT(plugin_id,task_id) DO UPDATE SET next_run_at=now()+($3::bigint*interval '1 millisecond'),updated_at=now()
    WHERE t_platform_plugin_task_schedule.next_run_at<=now() RETURNING task_id`,[pluginId,taskId,intervalMs])
  return result.rowCount===1
}

async function dynamicInstalls(pool: Pick<Pool,'query'>, states: string[]) {
  const key=[...states].sort().join(',')
  const snapshots=cachedRegistry(pool)
  const cached=snapshots.get(key)
  if(cached&&cached.expiresAt>Date.now())return cached.rows
  const rows=(await pool.query<DynamicInstall>(`SELECT i.plugin_id,i.package_name,i.version,i.install_path,l.state
    FROM t_platform_plugin_install i JOIN t_platform_plugin_lifecycle l ON l.plugin_id=i.plugin_id
    WHERE i.source='npmjs' AND i.status='installed' AND l.state=ANY($1::text[])
    ORDER BY i.plugin_id`,[states])).rows
  snapshots.set(key,{expiresAt:Date.now()+1_000,rows})
  return rows
}

export async function activeThirdPartyTelegramUpdateTypes(pool: Pick<Pool,'query'> & {dialect?:string}, botId?: number) {
  if(pool.dialect!=='postgres')return []
  const key=String(botId??'all')
  const snapshots=cachedTelegramTypes(pool)
  const cached=snapshots.get(key)
  if(cached&&cached.expiresAt>Date.now())return cached.types
  const result=await pool.query<{update_type:string}>(`SELECT DISTINCT jsonb_array_elements_text(i.manifest_json->'telegramUpdateTypes') AS update_type
    FROM t_platform_plugin_install i JOIN t_platform_plugin_lifecycle l ON l.plugin_id=i.plugin_id
    JOIN t_platform_plugin_instance x ON x.plugin_id=i.plugin_id AND x.state='active'
    JOIN t_telegram_bot b ON b.rid=x.bot_id AND COALESCE(b.bot_token,'')<>''
    WHERE i.source='npmjs' AND i.status='installed' AND l.state='active'
      AND (i.manifest_json->'permissions' ? 'telegram.updates.read' OR i.manifest_json->'permissions' ? 'telegram.commands.register' OR i.manifest_json->'permissions' ? 'telegram')
      AND ($1::bigint IS NULL OR b.rid=$1)`,[botId??null])
  const types=result.rows.map(row=>row.update_type).filter(type=>/^[a-z][a-z0-9_]{0,63}$/u.test(type))
  snapshots.set(key,{expiresAt:Date.now()+1_000,types})
  return types
}

export async function listThirdPartyPluginStatuses(pool: Db) {
  const records = await pluginInstallRecords(pool)
  const orphanedFailures=await pool.query<{plugin_id:string;package_name:string;version:string;source:'npmjs';integrity_sha512:string|null;install_path:string|null;status:'failed';manifest_json:unknown;last_error:string|null;installed_at:null;updated_at:Date|string}>(`SELECT a.plugin_id,a.package_name,a.version,a.source,a.integrity_sha512,a.install_path,a.status,a.manifest_json,a.last_error,NULL::timestamptz AS installed_at,a.updated_at
    FROM t_platform_plugin_install_attempt a LEFT JOIN t_platform_plugin_install i ON i.plugin_id=a.plugin_id
    WHERE a.source='npmjs' AND a.status='failed' AND i.plugin_id IS NULL ORDER BY a.plugin_id`)
  const thirdParty = [...records.filter(record=>record.source==='npmjs'),...orphanedFailures.rows]
  const states = thirdParty.length ? (await pool.query<{plugin_id:string;state:string;executions:number;runtime_failures:number;runtime_error:string|null}>(`SELECT i.plugin_id,COALESCE(l.state,'uninstalled') AS state,
    (SELECT count(*)::int FROM t_platform_plugin_execution e WHERE e.plugin_id=i.plugin_id AND e.lease_until>now()) AS executions,
    (SELECT count(*)::int FROM t_platform_plugin_event_delivery d WHERE d.plugin_id=i.plugin_id AND d.status='failed' AND d.updated_at>now()-interval '24 hours') AS runtime_failures,
    (SELECT d.last_error FROM t_platform_plugin_event_delivery d WHERE d.plugin_id=i.plugin_id AND d.status='failed' ORDER BY d.updated_at DESC LIMIT 1) AS runtime_error
    FROM t_platform_plugin_install i LEFT JOIN t_platform_plugin_lifecycle l ON l.plugin_id=i.plugin_id WHERE i.source='npmjs'`)).rows : []
  const botInstances=thirdParty.length?(await pool.query<{plugin_id:string;bot_id:number;bot_username:string|null;bot_firstname:string|null;enabled:boolean}>(`SELECT i.plugin_id,b.rid::int AS bot_id,b.bot_username,b.bot_firstname,COALESCE(x.state='active',false) AS enabled
    FROM t_platform_plugin_install i CROSS JOIN t_telegram_bot b LEFT JOIN t_platform_plugin_instance x ON x.plugin_id=i.plugin_id AND x.bot_id=b.rid
    WHERE i.source='npmjs' AND i.status='installed' AND COALESCE(b.bot_token,'')<>'' ORDER BY i.plugin_id,b.rid`)).rows:[]
  return Promise.all(thirdParty.map(async install=>{
    const state=states.find(row=>row.plugin_id===install.plugin_id)
    let manifest=install.manifest_json && typeof install.manifest_json==='object' ? install.manifest_json as Record<string,unknown> : undefined
    return {id:install.plugin_id,name:String(manifest?.name??install.package_name),description:String(manifest?.description??''),menuRoutes:[],apiRoutes:[],tasks:[],drainTasks:[],dependencies:[],integration:'third-party',thirdParty:true,state:state?.state??'uninstalled',blockers:0,executions:state?.executions??0,runtimeFailures:state?.runtime_failures??0,runtimeError:state?.runtime_error??null,bots:botInstances.filter(bot=>bot.plugin_id===install.plugin_id),queue:null,install}
  }))
}

export async function dispatchThirdPartyPluginRoute(pool: Db, request: Request, pluginId: string) {
  const installation=(await dynamicInstalls(pool,['active'])).find(item=>item.plugin_id===pluginId)
  if(!installation)return Response.json({message:'第三方插件未启用'},{status:404,headers:{'Cache-Control':'no-store'}})
  const user=await identity(request)
  const result=await runPluginTaskWithLease(pluginId,`http:${randomUUID()}`,[],async()=>{
    const loaded=await loadDynamicPlugin(pool,installation)
    const url=new URL(request.url),pluginPath=url.searchParams.get('path')??'/'
    const route=loaded.registrations?.routes.find(item=>item.method===request.method.toUpperCase()&&item.path===pluginPath)
    if(!route)return Response.json({message:'插件路由不存在'},{status:404,headers:{'Cache-Control':'no-store'}})
    return route.handler({request,pluginId,user:{id:String(user.id),roles:user.roles}})
  },pool)
  if(result&&typeof result==='object'&&'skipped'in result&&result.skipped)return Response.json({message:'插件正在停用或已卸载'},{status:409,headers:{'Cache-Control':'no-store'}})
  const response=result
  if(!(response instanceof Response))throw new Error('plugin_route_response_invalid')
  return response
}

type ThirdPartyTelegramDispatch = { matched: boolean; handled: boolean; failedPlugins: string[] }

async function claimTelegramDelivery(pool: Pick<Pool,'query'>, pluginId: string, botId: number, updateId: number) {
  const result=await pool.query<{plugin_id:string}>(`INSERT INTO t_platform_plugin_event_delivery(plugin_id,bot_id,update_id,status,attempts,lease_until,updated_at)
    VALUES($1,$2,$3,'processing',1,now()+interval '180 seconds',now())
    ON CONFLICT(plugin_id,bot_id,update_id) DO UPDATE SET status='processing',attempts=t_platform_plugin_event_delivery.attempts+1,lease_until=now()+interval '180 seconds',last_error=NULL,updated_at=now()
    WHERE t_platform_plugin_event_delivery.status<>'succeeded' AND (t_platform_plugin_event_delivery.lease_until IS NULL OR t_platform_plugin_event_delivery.lease_until<=now())
    RETURNING plugin_id`,[pluginId,botId,updateId])
  return result.rowCount===1
}

async function finishTelegramDelivery(pool: Pick<Pool,'query'>, pluginId: string, botId: number, updateId: number, error?: unknown) {
  if(error===undefined){
    await pool.query("UPDATE t_platform_plugin_event_delivery SET status='succeeded',lease_until=NULL,last_error=NULL,updated_at=now() WHERE plugin_id=$1 AND bot_id=$2 AND update_id=$3",[pluginId,botId,updateId])
    return
  }
  const redacted=safePluginError(error)
  await pool.query("UPDATE t_platform_plugin_event_delivery SET status='failed',lease_until=NULL,last_error=$4,updated_at=now() WHERE plugin_id=$1 AND bot_id=$2 AND update_id=$3",[pluginId,botId,updateId,redacted])
}

function telegramCommandMatch(update:Record<string,unknown>) {
  const message=update.message
  if(!message||typeof message!=='object'||(message as Record<string,any>).from?.is_bot===true)return null
  const raw=String((message as Record<string,any>).text??'').trim()
  const match=/^\/([a-z0-9_]{1,32})(?:@([a-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/iu.exec(raw)
  if(!match)return null
  return {name:match[1]!.toLowerCase(),mention:match[2]?.toLowerCase(),args:String(match[3]??'').trim().split(/\s+/u).filter(Boolean)}
}

export async function dispatchThirdPartyTelegramUpdate(pool: Db, botId: number, update: Record<string,unknown>, updateTypes: string[], updateId: number, logger: Logger=console, receivedAt?: Date|string|null): Promise<ThirdPartyTelegramDispatch|null> {
  if(!updateTypes.length)return null
  const [allInstalls,enabled]=await Promise.all([dynamicInstalls(pool,['active']),enabledPluginsForBot(pool,botId)])
  const installs=allInstalls.filter(install=>enabled.has(install.plugin_id))
  let matched=false,handled=false
  const failedPlugins:string[]=[]
  for(const installation of installs){
    try{
      const result=await runPluginTaskWithLease(installation.plugin_id,`telegram-update:${botId}:${updateId}`,[],async()=>{
        if(!(await thirdPartyBotEventAllowed(pool,installation.plugin_id,botId,receivedAt)))return {matched:false,handled:false}
        const loaded=await loadDynamicPlugin(pool,installation)
        if(!(loaded.manifest.permissions??[]).some(permission=>permission==='telegram'||permission==='telegram.updates.read'||permission==='telegram.commands.register')||!loaded.manifest.telegramUpdateTypes?.some(type=>updateTypes.includes(type)))return {matched:false,handled:false}
        if(!(await claimTelegramDelivery(pool,installation.plugin_id,botId,updateId)))return {matched:true,handled:false}
        try{
          let pluginHandled=false
          let commandHandled=false
          const commandMatch=telegramCommandMatch(update)
          if(commandMatch){
            let mentionMatches=true
            if(commandMatch.mention){const bot=await pool.query<{bot_username:string|null}>('SELECT bot_username FROM t_telegram_bot WHERE rid=$1',[botId]);mentionMatches=String(bot.rows[0]?.bot_username??'').replace(/^@/u,'').toLowerCase()===commandMatch.mention}
            if(mentionMatches){
              const staticCommand=await pool.query<{command:string}>("SELECT c.command FROM t_telegram_bot_command c WHERE c.bot_rid=$1 AND c.status=0 AND c.command=$2 AND platform_plugin_config_effective('command',c.bot_rid,c.rid,c.command,NULL) LIMIT 1",[botId,commandMatch.name])
              const owner=await pool.query<{plugin_id:string}>('SELECT plugin_id FROM t_platform_plugin_command WHERE bot_id=$1 AND command_name=$2',[botId,commandMatch.name])
              const command=!staticCommand.rowCount&&owner.rows[0]?.plugin_id===installation.plugin_id?loaded.registrations?.commands.find(item=>item.name===commandMatch.name):undefined
              if(command){const result=await command.handler({botId,update,command:commandMatch.name,args:commandMatch.args});commandHandled=result===true;pluginHandled=commandHandled}
            }
          }
          if(!commandHandled)for(const handler of loaded.registrations?.telegramHandlers??[])if(await handler({botId,update})===true)pluginHandled=true
          await finishTelegramDelivery(pool,installation.plugin_id,botId,updateId)
          return {matched:true,handled:pluginHandled}
        }catch(error){await finishTelegramDelivery(pool,installation.plugin_id,botId,updateId,error).catch(()=>undefined);throw error}
      },pool)
      if(result&&typeof result==='object'&&'matched'in result){matched=matched||result.matched;handled=handled||result.handled}
      else if(result&&typeof result==='object'&&(result as {skipped?:boolean}).skipped===true)failedPlugins.push(installation.plugin_id)
    }catch(error){failedPlugins.push(installation.plugin_id);logger.error(`Third-party Telegram plugin ${installation.plugin_id} failed: ${safePluginError(error)}`)}
  }
  return matched?{matched,handled,failedPlugins}:failedPlugins.length?{matched:false,handled:false,failedPlugins}:null
}

export async function runThirdPartyPluginTasks(pool: Db, shouldContinue: ()=>boolean, logger: Logger=console) {
  const installs=await dynamicInstalls(pool,['active','draining'])
  let scanned=0,succeeded=0,failed=0
  for(const installation of installs){
    if(!shouldContinue())break
    const botIds=await enabledBotIds(pool,installation.plugin_id)
    if(!botIds.length)continue
    let loaded
    try{loaded=await runPluginTaskWithLease(installation.plugin_id,'runtime-discovery',['runtime-discovery'],()=>loadDynamicPlugin(pool,installation),pool)}
    catch(error){logger.error(`Third-party plugin ${installation.plugin_id} failed to load: ${safePluginError(error)}`);failed++;continue}
    if(loaded&&typeof loaded==='object'&&'skipped'in loaded&&loaded.skipped)continue
    for(const task of loaded.registrations?.tasks??[]){
      if(!shouldContinue())break
      for(const botId of botIds){
        if(!shouldContinue())break
        const taskName=`task:bot:${botId}:${task.id}`
        try{
          const result=await runPluginTaskWithLease(installation.plugin_id,taskName,task.drain?[taskName]:[],async()=>{
            if(!(await thirdPartyBotEventAllowed(pool,installation.plugin_id,botId)))return {skipped:true,reason:'bot_instance_disabled'}
            if(!(await claimTaskSchedule(pool,installation.plugin_id,taskName,task.intervalMs)))return {skipped:true,reason:'task_not_due'}
            scanned++
            return task.run({shouldContinue,botId})
          },pool)
          if(!(result&&typeof result==='object'&&'skipped'in result&&result.skipped))succeeded++
        }catch(error){failed++;logger.error(`Third-party task ${installation.plugin_id}/${task.id} for bot ${botId} failed: ${safePluginError(error)}`)}
      }
    }
  }
  return {skipped:false,scanned,succeeded,failed}
}

export async function transitionThirdPartyPlugin(pool: Db, pluginId: string, action: 'disable'|'resume'|'uninstall') {
  const client=await pool.connect()
  let deactivate: Pick<DynamicInstall,'plugin_id'|'package_name'|'install_path'>|undefined
  const cleanupPaths:string[]=[]
  try{
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':lifecycle',0))",[pluginId])
    const current=await client.query<{state:string}>('SELECT l.state FROM t_platform_plugin_lifecycle l JOIN t_platform_plugin_install i ON i.plugin_id=l.plugin_id WHERE l.plugin_id=$1 AND i.source=\'npmjs\' AND i.status IN (\'installed\',\'removed\') FOR UPDATE OF l',[pluginId])
    const state=current.rows[0]?.state
    if(!state)throw new Error('plugin_not_found')
    if(action==='disable'){
      if(state==='uninstalled')throw new Error('plugin_uninstalled')
      if(state==='active')await client.query("UPDATE t_platform_plugin_lifecycle SET state='draining',disabled_at=now(),updated_at=now() WHERE plugin_id=$1",[pluginId])
      await client.query('COMMIT')
      invalidateThirdPartyPluginRegistry(pool)
      return 'draining'
    }
    if(action==='resume'){
      if(state==='uninstalled')throw new Error('plugin_uninstalled')
      if(state==='draining')await client.query("UPDATE t_platform_plugin_lifecycle SET state='active',enabled_at=now(),updated_at=now() WHERE plugin_id=$1",[pluginId])
      await client.query('COMMIT')
      invalidateThirdPartyPluginRegistry(pool)
      return 'active'
    }
    if(state!=='draining')throw new Error('plugin_must_be_draining')
    const running=await client.query<{count:number}>('SELECT count(*)::int AS count FROM t_platform_plugin_execution WHERE plugin_id=$1 AND lease_until>now()',[pluginId])
    if(Number(running.rows[0]?.count??0)>0)throw new Error('plugin_tasks_still_running:'+running.rows[0]?.count)
    const installed=await client.query<{package_name:string;install_path:string}>('SELECT package_name,install_path FROM t_platform_plugin_install WHERE plugin_id=$1 AND source=\'npmjs\' AND status=\'installed\' FOR UPDATE',[pluginId])
    if(!installed.rows[0])throw new Error('plugin_install_record_missing')
    deactivate={plugin_id:pluginId,package_name:installed.rows[0].package_name,install_path:installed.rows[0].install_path}
    if(installed.rows[0].install_path)cleanupPaths.push(installed.rows[0].install_path)
    const history=await client.query<{install_path:string|null}>('SELECT install_path FROM t_platform_plugin_install_history WHERE plugin_id=$1',[pluginId])
    cleanupPaths.push(...history.rows.map(row=>row.install_path).filter((path):path is string=>Boolean(path)))
    await client.query("UPDATE t_platform_plugin_install SET status='removed',install_path=NULL,updated_at=now() WHERE plugin_id=$1 AND source='npmjs'",[pluginId])
    await client.query("UPDATE t_platform_plugin_lifecycle SET state='uninstalled',disabled_at=COALESCE(disabled_at,now()),updated_at=now() WHERE plugin_id=$1",[pluginId])
    await client.query('DELETE FROM t_platform_plugin_instance WHERE plugin_id=$1',[pluginId])
    await client.query('DELETE FROM t_platform_plugin_command WHERE plugin_id=$1',[pluginId])
    await client.query('DELETE FROM t_platform_plugin_task_schedule WHERE plugin_id=$1',[pluginId])
    await client.query('DELETE FROM t_platform_plugin_install_history WHERE plugin_id=$1',[pluginId])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
  invalidateThirdPartyPluginRegistry(pool)
  if(deactivate)await deactivateInstalledPlugin(deactivate.plugin_id,deactivate.install_path,deactivate.package_name).catch(()=>undefined)
  for(const installPath of cleanupPaths)await removeInstalledPluginFiles(pluginInstallRoot(),pluginId,installPath).catch(error=>console.error(`Failed to remove files for third-party plugin ${pluginId}: ${safePluginError(error)}`))
  return 'uninstalled'
}
