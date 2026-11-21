import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { BotServiceError, invalidateLegacyBotCache, telegramRequest, type BotDependencies } from './bot-service.server'
import type { ConfigKind } from '../config/telegram-config'
export type CommandInput={bot_rid:number;command_type:number;command:string;description:string;seq_sn:number}
export type KeyboardInput={keyboard_type:number;keyboard_name:string;keyboard_icon_custom_emoji_id:string|null;inline_type:number;keyboard_value:string;seq_sn:number}
type Dependencies=Pick<BotDependencies,'invalidate'|'telegram'>
const tableFor={command:'t_telegram_bot_command',keyboard:'t_telegram_bot_keyboard'} as const
export function normalizeCustomEmojiId(value:string) {
  const raw=value.trim()
  if(!raw)return null
  const match=/emoji-id=["']?(\d+)["']?/i.exec(raw)
  const digits=match?match[1]:raw.replace(/\D/g,'')
  if(digits.length>64)throw new BotServiceError(400,'TG Emoji ID 过长')
  return !digits||digits==='0'?null:digits
}
export function commandScopes(commands:Array<{command:string;description:string;command_type:number}>) {
  const scopes={all_private_chats:[] as Array<{command:string;description:string}>,all_group_chats:[] as Array<{command:string;description:string}>}
  for(const row of commands) {
    if(!/^[a-z0-9_]{1,32}$/.test(row.command)||!row.description||Array.from(row.description).length>256)throw new BotServiceError(400,'命令格式不符合 Telegram 要求，请先修改命令与描述')
    if(![1,2,3].includes(row.command_type))throw new BotServiceError(400,'命令类型无效')
    const value={command:row.command,description:row.description}
    if(row.command_type===1||row.command_type===2)scopes.all_private_chats.push(value)
    if(row.command_type===1||row.command_type===3)scopes.all_group_chats.push(value)
  }
  if(Object.values(scopes).some(scope=>scope.length>100))throw new BotServiceError(400,'每个范围最多同步 100 条命令')
  return scopes
}
export class TelegramConfigService {
  constructor(private pool:Pool,private dependencies:Dependencies={invalidate:invalidateLegacyBotCache,telegram:telegramRequest}){}
  async list(kind:ConfigKind,page:number,pageSize:number,search:string,botRid?:number) {
    const values:unknown[]=[`%${search}%`]
    const table=tableFor[kind]
    const filter=kind==='command'?`a.command ILIKE $1${botRid?' AND a.bot_rid=$2':''}`:'a.keyboard_name ILIKE $1'
    const join=kind==='command'?' JOIN t_telegram_bot b ON b.rid=a.bot_rid':''
    if(kind==='command'&&botRid)values.push(botRid)
    const count=await this.pool.query(`SELECT count(*)::int total FROM ${table} a${join} WHERE ${filter}`,values)
    const extra=kind==='command'?',b.bot_username,b.bot_firstname':''
    const rows=await this.pool.query(`SELECT a.*,a.create_time AT TIME ZONE 'Asia/Shanghai' AS create_time,a.update_time AT TIME ZONE 'Asia/Shanghai' AS update_time${extra} FROM ${table} a${join} WHERE ${filter} ORDER BY a.rid DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pageSize,(page-1)*pageSize])
    return {rows:rows.rows,total:count.rows[0].total}
  }
  async options(){return(await this.pool.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid LIMIT 2000')).rows}
  private async transaction<T extends {rid:number;bots:number[]}>(kind:ConfigKind,action:string,actor:string,work:(client:PoolClient)=>Promise<T>) {
    const client=await this.pool.connect();let committed=false
    try{
      await client.query('BEGIN');const result=await work(client)
      for(const rid of new Set(result.bots))await this.dependencies.invalidate(rid)
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,`telegram.${kind}.${action}`,result.rid])
      await client.query('COMMIT');committed=true
      for(const rid of new Set(result.bots))try{await this.dependencies.invalidate(rid)}catch{console.error('Configuration cache post-commit invalidation failed')}
      return result
    }catch(error){if(!committed)await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async saveCommand(data:CommandInput,actor:string,rid?:number){
    return this.transaction('command',rid?'update':'add',actor,async client=>{
      if(!(await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[data.bot_rid])).rowCount)throw new BotServiceError(404,'机器人不存在')
      let oldBot:number|undefined
      if(rid){const found=await client.query('SELECT bot_rid FROM t_telegram_bot_command WHERE rid=$1 FOR UPDATE',[rid]);if(!found.rowCount)throw new BotServiceError(404,'命令不存在');oldBot=found.rows[0].bot_rid}
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('command:' || $1 || ':' || $2,0))",[String(data.bot_rid),data.command])
      if((await client.query('SELECT rid FROM t_telegram_bot_command WHERE bot_rid=$1 AND command=$2 AND rid<>$3',[data.bot_rid,data.command,rid||0])).rowCount)throw new BotServiceError(409,'机器人命令已存在')
      const values=[data.bot_rid,data.command_type,data.command,data.description,data.seq_sn,actor]
      const result=rid?await client.query('UPDATE t_telegram_bot_command SET bot_rid=$1,command_type=$2,command=$3,description=$4,seq_sn=$5,update_by=$6,update_time=now() WHERE rid=$7 RETURNING rid',[...values,rid]):await client.query('INSERT INTO t_telegram_bot_command(bot_rid,command_type,command,description,seq_sn,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,now(),$6,now()) RETURNING rid',values)
      return {rid:result.rows[0].rid,bots:oldBot?[oldBot,data.bot_rid]:[data.bot_rid]}
    })
  }
  async saveKeyboard(data:KeyboardInput,actor:string,rid?:number){
    return this.transaction('keyboard',rid?'update':'add',actor,async client=>{
      if(rid&&!(await client.query('SELECT rid FROM t_telegram_bot_keyboard WHERE rid=$1 FOR UPDATE',[rid])).rowCount)throw new BotServiceError(404,'键盘不存在')
      const duplicate=[data.keyboard_name,data.keyboard_icon_custom_emoji_id,data.keyboard_type,data.inline_type,data.keyboard_value]
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('keyboard:' || $1,0))",[JSON.stringify(duplicate)])
      if((await client.query('SELECT rid FROM t_telegram_bot_keyboard WHERE keyboard_name=$1 AND keyboard_icon_custom_emoji_id IS NOT DISTINCT FROM $2 AND keyboard_type=$3 AND inline_type=$4 AND keyboard_value=$5 AND rid<>$6',[...duplicate,rid||0])).rowCount)throw new BotServiceError(409,'相同键盘已存在')
      const values=[data.keyboard_type,data.keyboard_name,data.keyboard_icon_custom_emoji_id,data.inline_type,data.keyboard_value,data.seq_sn,actor]
      const result=rid?await client.query('UPDATE t_telegram_bot_keyboard SET keyboard_type=$1,keyboard_name=$2,keyboard_icon_custom_emoji_id=$3,inline_type=$4,keyboard_value=$5,seq_sn=$6,update_by=$7,update_time=now() WHERE rid=$8 RETURNING rid',[...values,rid]):await client.query('INSERT INTO t_telegram_bot_keyboard(keyboard_type,keyboard_name,keyboard_icon_custom_emoji_id,inline_type,keyboard_value,seq_sn,status,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,0,$7,now(),$7,now()) RETURNING rid',values)
      const id=result.rows[0].rid
      const bots=await client.query('SELECT bot_rid FROM t_telegram_bot_keyreply_keyboard WHERE keyboard_rid=$1 UNION SELECT bot_rid FROM t_telegram_bot_ad_keyboard WHERE keyboard_rid=$1',[id])
      return {rid:id,bots:bots.rows.map(row=>row.bot_rid)}
    })
  }
  async status(rid:number,enabled:boolean,actor:string){
    return this.transaction('keyboard','status',actor,async client=>{
      const result=await client.query('UPDATE t_telegram_bot_keyboard SET status=$2,update_by=$3,update_time=now() WHERE rid=$1 RETURNING rid',[rid,enabled?0:1,actor])
      if(!result.rowCount)throw new BotServiceError(404,'键盘不存在')
      const bots=await client.query('SELECT bot_rid FROM t_telegram_bot_keyreply_keyboard WHERE keyboard_rid=$1 UNION SELECT bot_rid FROM t_telegram_bot_ad_keyboard WHERE keyboard_rid=$1',[rid])
      return {rid,bots:bots.rows.map(row=>row.bot_rid)}
    })
  }
  async remove(kind:ConfigKind,rid:number,actor:string){
    return this.transaction(kind,'delete',actor,async client=>{
      const table=tableFor[kind]
      const result=await client.query(`SELECT * FROM ${table} WHERE rid=$1 FOR UPDATE`,[rid]);if(!result.rowCount)throw new BotServiceError(404,'记录不存在')
      if(kind==='keyboard'&&(await client.query('SELECT rid FROM t_telegram_bot_keyreply_keyboard WHERE keyboard_rid=$1 UNION ALL SELECT rid FROM t_telegram_bot_ad_keyboard WHERE keyboard_rid=$1 LIMIT 1',[rid])).rowCount)throw new BotServiceError(409,'该键盘仍被关键词或广告使用，请先解除关联')
      await client.query(`DELETE FROM ${table} WHERE rid=$1`,[rid])
      return {rid,bots:kind==='command'?[result.rows[0].bot_rid]:[]}
    })
  }
  async copyCommands(source:number,target:number,actor:string){
    if(source===target)throw new BotServiceError(400,'来源机器人和覆盖机器人不能相同')
    return this.transaction('command','copy',actor,async client=>{
      if((await client.query('SELECT rid FROM t_telegram_bot WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE',[[source,target]])).rowCount!==2)throw new BotServiceError(404,'来源或覆盖机器人不存在')
      if(!(await client.query('SELECT rid FROM t_telegram_bot_command WHERE bot_rid=$1 LIMIT 1',[source])).rowCount)throw new BotServiceError(400,'来源机器人没有可复制的命令')
      await client.query('DELETE FROM t_telegram_bot_command WHERE bot_rid=$1',[target])
      const copied=await client.query('INSERT INTO t_telegram_bot_command(bot_rid,command,description,command_type,seq_sn,create_by,create_time,update_by,update_time) SELECT $2,command,description,command_type,seq_sn,$3,now(),$3,now() FROM t_telegram_bot_command WHERE bot_rid=$1',[source,target,actor])
      return {rid:target,bots:[target],count:copied.rowCount||0}
    })
  }
  async syncCommands(botRid:number,actor:string){
    const bot=await this.pool.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1',[botRid]);if(!bot.rowCount)throw new BotServiceError(404,'机器人不存在')
    const rows=await this.pool.query("SELECT command,description,command_type FROM t_telegram_bot_command a WHERE bot_rid=$1 AND platform_plugin_config_effective('command',a.bot_rid,a.rid,a.command,NULL) ORDER BY seq_sn DESC,rid ASC",[botRid])
    const scopes=commandScopes(rows.rows)
    await this.dependencies.telegram(bot.rows[0].bot_token,'setMyCommands',{commands:scopes.all_private_chats,scope:{type:'all_private_chats'}})
    try{await this.dependencies.telegram(bot.rows[0].bot_token,'setMyCommands',{commands:scopes.all_group_chats,scope:{type:'all_group_chats'}})}catch{throw new BotServiceError(502,'私聊命令已同步，群聊命令未完成，请重试')}
    await this.pool.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,'telegram.command.sync',botRid])
    return {private:scopes.all_private_chats.length,group:scopes.all_group_chats.length}
  }
}
