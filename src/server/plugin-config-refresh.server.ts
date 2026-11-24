import { randomUUID } from 'node:crypto'
import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { invalidateLegacyBotCache, telegramRequest, type BotDependencies } from './bot-service.server'
import { commandScopes } from './telegram-config-service.server'

type Database=Pick<Pool,'query'|'connect'>
type Logger=Pick<Console,'error'>
const QUERY=`WITH picked AS (
 SELECT bot_rid FROM t_platform_plugin_config_refresh
 WHERE (status IN ('pending','failed') AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now())
 ORDER BY bot_rid LIMIT $1 FOR UPDATE SKIP LOCKED
) UPDATE t_platform_plugin_config_refresh q SET status='processing',attempts=attempts+1,lease_owner=$2,lease_until=now()+interval '45 seconds',updated_at=now()
FROM picked WHERE q.bot_rid=picked.bot_rid RETURNING q.bot_rid,q.attempts`
export async function syncPluginConfigRefresh(options:{pool?:Database;logger?:Logger;shouldContinue?:()=>boolean;enabled?:boolean;batchSize?:number;dependencies?:Pick<BotDependencies,'telegram'|'invalidate'>}={}){
  const pool=options.pool??db,logger=options.logger??console,keepGoing=options.shouldContinue??(()=>true)
  if(!(options.enabled??process.env.PLATFORM_TELEGRAM_ACTIONS==='true')||!keepGoing())return{skipped:true,processed:0,failed:0}
  const dependencies=options.dependencies??{telegram:telegramRequest,invalidate:invalidateLegacyBotCache}
  const owner='plugin-config-refresh-'+process.pid+'-'+randomUUID()
  const client=await pool.connect()
  let rows:{bot_rid:number;attempts:number}[]=[]
  try{await client.query('BEGIN');rows=(await client.query(QUERY,[Math.min(50,Math.max(1,options.batchSize??10)),owner])).rows;await client.query('COMMIT')}
  catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  let processed=0,failed=0
  for(const row of rows){
    if(!keepGoing())break
    try{
      const bot=await pool.query<{bot_token:string}>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1',[row.bot_rid])
      if(!bot.rowCount||!bot.rows[0].bot_token)throw new Error('plugin_config_bot_missing')
      const commands=await pool.query<{command:string;description:string;command_type:number}>("SELECT c.command,c.description,c.command_type FROM t_telegram_bot_command c WHERE c.bot_rid=$1 AND platform_plugin_config_effective('command',c.bot_rid,c.rid,c.command,NULL) ORDER BY c.seq_sn DESC,c.rid ASC",[row.bot_rid])
      const pluginCommands=await pool.query<{command_name:string;description:string}>(`SELECT p.command_name,p.description FROM t_platform_plugin_command p
        JOIN t_platform_plugin_instance i ON i.plugin_id=p.plugin_id AND i.bot_id=p.bot_id AND i.state='active'
        JOIN t_platform_plugin_lifecycle l ON l.plugin_id=p.plugin_id AND l.state='active'
        WHERE p.bot_id=$1 ORDER BY p.command_name`,[row.bot_rid])
      const merged=new Map(commands.rows.map(command=>[command.command,{...command}]))
      for(const command of pluginCommands.rows)if(!merged.has(command.command_name))merged.set(command.command_name,{command:command.command_name,description:command.description,command_type:1})
      const scopes=commandScopes([...merged.values()])
      await dependencies.telegram(bot.rows[0].bot_token,'setMyCommands',{commands:scopes.all_private_chats,scope:{type:'all_private_chats'}})
      await dependencies.telegram(bot.rows[0].bot_token,'setMyCommands',{commands:scopes.all_group_chats,scope:{type:'all_group_chats'}})
      await dependencies.invalidate(row.bot_rid).catch(()=>undefined)
      await pool.query("UPDATE t_platform_plugin_config_refresh SET status='done',lease_owner=NULL,lease_until=NULL,last_error_code=NULL,updated_at=now() WHERE bot_rid=$1 AND status='processing' AND lease_owner=$2",[row.bot_rid,owner]);processed++
    }catch{
      const delay=Math.min(300,5*2**Math.max(0,row.attempts-1))
      await pool.query("UPDATE t_platform_plugin_config_refresh SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+($3*interval '1 second'),lease_owner=NULL,lease_until=NULL,last_error_code='plugin_config_sync_failed',updated_at=now() WHERE bot_rid=$1 AND status='processing' AND lease_owner=$2",[row.bot_rid,owner,delay]);failed++;logger.error('Plugin Telegram config refresh failed')
    }
  }
  return{skipped:false,processed,failed}
}
