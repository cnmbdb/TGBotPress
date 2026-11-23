import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '../server/database.types'
import { pluginCatalog, type PluginId } from './catalog'

type Db=Pick<Pool,'query'|'connect'>
export type PluginConfigType='command'|'keyboard'|'keyreply'|'keyreply_keyboard'
type ConfigRow={rid:number;bot_rid?:number;command?:string;keyboard_name?:string;monitor_word?:string;opt_type?:number}

function automaticPluginTargets(type:PluginConfigType,name:string,opt:number):string[]{
  const pluginOwnedTargets=pluginCatalog.flatMap(plugin=>{
    const links=(plugin as typeof plugin & {automaticConfigLinks?:{commands?:Record<string,string[]>;keyreplyOptions?:Record<number|string,string[]>}}).automaticConfigLinks
    if(type==='command')return links?.commands?.[name.toLowerCase()]??[]
    if(type==='keyreply'||type==='keyreply_keyboard')return links?.keyreplyOptions?.[opt]??[]
    return []
  })
  if(type==='command')return [...(({trx:['transit'],z0:['transit'],buyenergy:['energy']} as Record<string,string[]>)[name.toLowerCase()]??[]),...pluginOwnedTargets]
  if(type==='keyboard')return name.toLowerCase().includes('克隆/代理')?['cloneproxy']:[]
  if(type==='keyreply'||type==='keyreply_keyboard'){
    const ids=opt===3||opt===10||opt===11?['energy']:opt===6?['monitor']:opt===7?['shop']:opt===9?['transit']:opt===8?['transit','energy']:opt===1&&name.toLowerCase().includes('克隆/代理')?['cloneproxy']:[]
    return [...ids,...pluginOwnedTargets]
  }
  return []
}
export async function annotatePluginConfigRows(pool:Pick<Pool,'query'> & {dialect?:string},type:PluginConfigType,rows:ConfigRow[]) {
  if(!rows.length)return rows.map(row=>({...row,plugin_ids:[],plugin_names:[],plugin_effective:true,plugin_manual_override:false}))
  if(pool.dialect==='mysql'||pool.dialect==='sqlite'){
    const links=(await pool.query<{plugin_id:string;config_type:PluginConfigType;bot_rid:number;config_rid:number;manual_override:boolean}>("SELECT plugin_id,config_type,bot_rid,config_rid,manual_override FROM t_platform_plugin_config_link")).rows
    const lifecycle=(await pool.query<{plugin_id:string;state:string}>("SELECT plugin_id,state FROM t_platform_plugin_lifecycle")).rows
    const active=new Set(lifecycle.filter(row=>row.state==='active').map(row=>row.plugin_id))
    const byConfig=(kind:PluginConfigType,bot:number,rid:number,name:string,opt:number)=>{
      const found=links.filter(link=>link.config_type===kind&&Number(link.bot_rid)===bot&&Number(link.config_rid)===rid)
      const manual=found.filter(link=>Boolean(link.manual_override))
      return {ids:[...new Set((manual.length?manual:found).map(link=>link.plugin_id).filter(id=>id!=='__none__').concat(manual.length?[]:automaticPluginTargets(kind,name,opt)))],manual:manual.length>0}
    }
    const relations=type==='keyreply_keyboard'?new Map((await pool.query<{rid:number;bot_rid:number;reply_rid:number;monitor_word:string;opt_type:number;keyboard_rid:number;keyboard_name:string}>(`SELECT relation.rid,relation.bot_rid,reply.rid AS reply_rid,reply.monitor_word,reply.opt_type,keyboard.rid AS keyboard_rid,keyboard.keyboard_name FROM t_telegram_bot_keyreply_keyboard relation JOIN t_telegram_bot_keyreply reply ON reply.rid=relation.keyreply_rid JOIN t_telegram_bot_keyboard keyboard ON keyboard.rid=relation.keyboard_rid WHERE relation.rid IN (${rows.map(()=>'?').join(',')})`,rows.map(row=>row.rid))).rows.map(row=>[Number(row.rid),row])):new Map()
    const labels=new Map(pluginCatalog.map(plugin=>[plugin.id,plugin.name]))
    return rows.map(row=>{
      const bot=type==='keyboard'?0:Number(row.bot_rid??0),rid=Number(row.rid),name=String(type==='command'?row.command??'':type==='keyboard'?row.keyboard_name??'':type==='keyreply'?row.monitor_word??'':''),opt=Number(row.opt_type??0)
      let target=byConfig(type,bot,rid,name,opt),ids=target.ids,effective=ids.length===0||ids.some(id=>active.has(id))
      if(type==='keyreply_keyboard'){
        const relation=relations.get(rid)
        if(relation){const parent=byConfig('keyreply',Number(relation.bot_rid),Number(relation.reply_rid),String(relation.monitor_word??''),Number(relation.opt_type));const keyboard=byConfig('keyboard',0,Number(relation.keyboard_rid),String(relation.keyboard_name??''),0);ids=[...new Set([...ids,...parent.ids,...keyboard.ids])];effective=effective&&(parent.ids.length===0||parent.ids.some(id=>active.has(id)))&&(keyboard.ids.length===0||keyboard.ids.some(id=>active.has(id)))}
      }
      return {...row,plugin_ids:ids,plugin_names:ids.map(id=>labels.get(id as PluginId)??id),plugin_effective:effective,plugin_manual_override:target.manual}
    })
  }
  const values: unknown[]=[]
  const sourceRows=rows.map(row=>{
    const configRid=Number(row.rid),botRid=type==='keyboard'?0:Number(row.bot_rid??0)
    const itemName=String(type==='command'?row.command??'':type==='keyboard'?row.keyboard_name??'':type==='keyreply'?row.monitor_word??'':'')
    const optType=Number(row.opt_type??0)
    const offset=values.length+1
    values.push(configRid,botRid,itemName,optType)
    return `SELECT $${offset+1}::bigint AS config_rid,$${offset+2}::bigint AS bot_rid,$${offset+3}::text AS item_name,$${offset+4}::int AS opt_type`
  }).join(' UNION ALL ')
  const query=await pool.query<{config_rid:number;bot_rid:number;plugin_ids:string[];effective:boolean;manual_override:boolean}>(`SELECT r.config_rid,r.bot_rid,
    platform_plugin_config_targets($1,r.bot_rid,r.config_rid,r.item_name,r.opt_type) AS plugin_ids,
    (platform_plugin_config_effective($1,r.bot_rid,r.config_rid,r.item_name,r.opt_type) AND ($1<>'keyreply_keyboard' OR EXISTS (
      SELECT 1 FROM t_telegram_bot_keyreply_keyboard relation
      JOIN t_telegram_bot_keyreply reply ON reply.rid=relation.keyreply_rid
      JOIN t_telegram_bot_keyboard keyboard ON keyboard.rid=relation.keyboard_rid
      WHERE relation.rid=r.config_rid AND relation.bot_rid=r.bot_rid
        AND platform_plugin_config_effective('keyreply',reply.bot_rid,reply.rid,reply.monitor_word,reply.opt_type)
        AND platform_plugin_config_effective('keyboard',0,keyboard.rid,keyboard.keyboard_name,NULL)
    ))) AS effective,
    EXISTS(SELECT 1 FROM t_platform_plugin_config_link l WHERE l.config_type=$1 AND l.bot_rid=r.bot_rid AND l.config_rid=r.config_rid AND l.manual_override) AS manual_override
    FROM (${sourceRows}) AS r`,[type,...values])
  const result=new Map(query.rows.map(row=>[`${row.bot_rid}:${row.config_rid}`,row]))
  const labels=new Map(pluginCatalog.map(plugin=>[plugin.id,plugin.name]))
  return rows.map(row=>{const state=result.get(`${type==='keyboard'?0:Number(row.bot_rid??0)}:${row.rid}`);const ids=state?.plugin_ids??[];return {...row,plugin_ids:ids,plugin_names:ids.map(id=>labels.get(id as PluginId)??id),plugin_effective:state?.effective??true,plugin_manual_override:state?.manual_override??false}})
}

async function associatedBotsForConfig(client:Pick<PoolClient,'query'>,type:PluginConfigType,botRid:number,configRid:number){
  if(type!=='keyboard')return [botRid]
  const result=await client.query<{bot_rid:number}>(`SELECT bot_rid FROM t_telegram_bot_keyreply_keyboard WHERE keyboard_rid=$1 UNION SELECT bot_rid FROM t_telegram_bot_ad_keyboard WHERE keyboard_rid=$1`,[configRid])
  return result.rows.map(row=>row.bot_rid)
}
async function enqueueBots(client:Pick<PoolClient,'query'>,botIds:number[]){
  for(const botRid of [...new Set(botIds)].filter(id=>id>0))await client.query(`INSERT INTO t_platform_plugin_config_refresh(bot_rid,status,attempts,next_attempt_at,updated_at) VALUES($1,'pending',0,now(),now()) ON CONFLICT(bot_rid) DO UPDATE SET status='pending',next_attempt_at=now(),last_error_code=NULL,updated_at=now()`,[botRid])
}

export async function setPluginConfigAssociations(pool:Db,input:{type:PluginConfigType;configRid:number;botRid:number;pluginIds:string[];actor:string;resetAuto?:boolean}){
  const {type,configRid,pluginIds,actor,resetAuto=false}=input
  const allowed=new Set<string>(pluginCatalog.map(plugin=>plugin.id))
  if(pluginIds.some(id=>!allowed.has(id)))throw new Error('plugin_config_unknown_plugin')
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin-config:'||$1||':'||$2||':'||$3,0))",[type,input.botRid,configRid])
    let actualBot=input.botRid
    if(type==='command'||type==='keyreply'){
      const table=type==='command'?'t_telegram_bot_command':'t_telegram_bot_keyreply'
      const row=await client.query<{bot_rid:number}>(`SELECT bot_rid FROM ${table} WHERE rid=$1 FOR UPDATE`,[configRid])
      if(!row.rowCount)throw new Error('plugin_config_missing')
      actualBot=Number(row.rows[0].bot_rid)
      if(input.botRid!==actualBot)throw new Error('plugin_config_bot_mismatch')
    }else if(type==='keyboard'){
      const row=await client.query('SELECT rid FROM t_telegram_bot_keyboard WHERE rid=$1 FOR UPDATE',[configRid])
      if(!row.rowCount)throw new Error('plugin_config_missing');actualBot=0
    }else{
      const row=await client.query<{bot_rid:number}>('SELECT bot_rid FROM t_telegram_bot_keyreply_keyboard WHERE rid=$1 FOR UPDATE',[configRid])
      if(!row.rowCount)throw new Error('plugin_config_missing');actualBot=Number(row.rows[0].bot_rid)
      if(input.botRid!==actualBot)throw new Error('plugin_config_bot_mismatch')
    }
    const bots=await associatedBotsForConfig(client,type,actualBot,configRid)
    await client.query('DELETE FROM t_platform_plugin_config_link WHERE config_type=$1 AND bot_rid=$2 AND config_rid=$3 AND manual_override=true',[type,actualBot,configRid])
    if(!resetAuto){
      const selected=pluginIds.length?[...new Set(pluginIds)]:['__none__']
      for(const pluginId of selected)await client.query('INSERT INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by) VALUES($1,$2,$3,$4,true,$5)',[pluginId,type,actualBot,configRid,actor])
    }
    await enqueueBots(client,bots)
    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,'plugin.config.association.update',configRid])
    await client.query('COMMIT')
    return {ok:true,bot_rid:actualBot,plugin_ids:resetAuto?null:pluginIds,reset_auto:resetAuto}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function enqueuePluginConfigRefresh(pool:Pick<Pool,'query'>,pluginId:string){
  const bots=await pool.query<{bot_rid:number}>(`SELECT bot_rid FROM t_platform_plugin_config_link WHERE plugin_id=$1 AND bot_rid>0
    UNION SELECT r.bot_rid FROM t_telegram_bot_keyreply_keyboard r JOIN t_platform_plugin_config_link l ON l.config_type='keyboard' AND l.config_rid=r.keyboard_rid AND l.bot_rid=0 WHERE l.plugin_id=$1
    UNION SELECT r.bot_rid FROM t_telegram_bot_ad_keyboard r JOIN t_platform_plugin_config_link l ON l.config_type='keyboard' AND l.config_rid=r.keyboard_rid AND l.bot_rid=0 WHERE l.plugin_id=$1
    UNION SELECT c.bot_rid FROM t_telegram_bot_command c WHERE $1=ANY(platform_plugin_config_targets('command',c.bot_rid,c.rid,c.command,NULL))
    UNION SELECT k.bot_rid FROM t_telegram_bot_keyreply k WHERE $1=ANY(platform_plugin_config_targets('keyreply',k.bot_rid,k.rid,k.monitor_word,k.opt_type))
    UNION SELECT r.bot_rid FROM t_telegram_bot_keyreply_keyboard r WHERE $1=ANY(platform_plugin_config_targets('keyreply_keyboard',r.bot_rid,r.rid,NULL,NULL))` ,[pluginId])
  for(const row of bots.rows)await pool.query(`INSERT INTO t_platform_plugin_config_refresh(bot_rid,status,attempts,next_attempt_at,updated_at) VALUES($1,'pending',0,now(),now()) ON CONFLICT(bot_rid) DO UPDATE SET status='pending',next_attempt_at=now(),last_error_code=NULL,updated_at=now()`,[row.bot_rid])
}

export async function enqueueBotPluginConfigRefresh(pool:Pick<Pool,'query'>,botIds:number[]){
  for(const botRid of [...new Set(botIds)].filter(id=>id>0))await pool.query(`INSERT INTO t_platform_plugin_config_refresh(bot_rid,status,attempts,next_attempt_at,updated_at) VALUES($1,'pending',0,now(),now()) ON CONFLICT(bot_rid) DO UPDATE SET status='pending',next_attempt_at=now(),last_error_code=NULL,updated_at=now()`,[botRid])
}
