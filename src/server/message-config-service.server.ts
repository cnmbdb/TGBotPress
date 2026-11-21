import type { Pool, PoolClient } from 'pg'
import { BotServiceError, invalidateLegacyBotCache } from './bot-service.server'

type Kind='reply'|'ad'
type Invalidate=(rid:number)=>Promise<void>
export type MessageInput={bot_rid:number;key_type:number;monitor_word:string;reply_photo:string;reply_content:string;opt_type:number}
export type AdInput={bot_rid:number;notice_cycle:number;notice_obj:string;notice_photo:string;notice_ad:string}
const table={reply:'t_telegram_bot_keyreply',ad:'t_telegram_bot_ad'} as const

export class MessageConfigService {
 constructor(private pool:Pool,private invalidate:Invalidate=invalidateLegacyBotCache){}
 async options(){return(await this.pool.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid LIMIT 2000')).rows}
 async list(kind:Kind,page:number,size:number,search:string,bot?:number){
  const values:unknown[]=[`%${search}%`];let where=kind==='reply'?'a.monitor_word ILIKE $1 OR a.reply_content ILIKE $1':'a.notice_ad ILIKE $1 OR a.notice_obj ILIKE $1'
  if(bot){values.push(bot);where=`(${where}) AND a.bot_rid=$2`}
  const count=await this.pool.query(`SELECT count(*)::int total FROM ${table[kind]} a WHERE ${where}`,values)
  const rows=await this.pool.query(`SELECT a.*,b.bot_firstname,b.bot_username,a.create_time AT TIME ZONE 'Asia/Shanghai' create_time,a.update_time AT TIME ZONE 'Asia/Shanghai' update_time FROM ${table[kind]} a JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where} ORDER BY a.rid DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size])
  return{rows:rows.rows,total:count.rows[0].total}
 }
 private async tx<T>(kind:Kind,action:string,actor:string,work:(c:PoolClient)=>Promise<{rid:number;bots:number[];data?:T}>):Promise<T>{
  const c=await this.pool.connect();let committed=false
  try{await c.query('BEGIN');const out=await work(c);for(const bot of new Set(out.bots))await this.invalidate(bot);await c.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,`telegram.${kind}.${action}`,out.rid]);await c.query('COMMIT');committed=true;for(const bot of new Set(out.bots))try{await this.invalidate(bot)}catch{console.error('Message config cache refresh failed')}return out.data as T}
  catch(e){if(!committed)await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async saveReply(d:MessageInput,actor:string,rid?:number){
  return this.tx('reply',rid?'update':'add',actor,async c=>{
   if(!(await c.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[d.bot_rid])).rowCount)throw new BotServiceError(404,'机器人不存在')
   let old:number|undefined;if(rid){const row=await c.query('SELECT bot_rid FROM t_telegram_bot_keyreply WHERE rid=$1 FOR UPDATE',[rid]);if(!row.rowCount)throw new BotServiceError(404,'关键字回复不存在');old=row.rows[0].bot_rid}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('reply:'||$1||':'||$2,0))",[d.bot_rid,d.monitor_word])
   if((await c.query('SELECT rid FROM t_telegram_bot_keyreply WHERE bot_rid=$1 AND monitor_word=$2 AND rid<>$3',[d.bot_rid,d.monitor_word,rid||0])).rowCount)throw new BotServiceError(409,'该机器人已有相同关键字')
   const args=[d.bot_rid,d.key_type,d.monitor_word,d.reply_photo,d.reply_content,d.opt_type,actor]
   const row=rid?await c.query('UPDATE t_telegram_bot_keyreply SET bot_rid=$1,key_type=$2,monitor_word=$3,reply_photo=$4,reply_content=$5,opt_type=$6,update_by=$7,update_time=now() WHERE rid=$8 RETURNING rid',[...args,rid]):await c.query('INSERT INTO t_telegram_bot_keyreply(bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,0,$7,now(),$7,now()) RETURNING rid',args)
   return{rid:row.rows[0].rid,bots:old?[old,d.bot_rid]:[d.bot_rid]}
  })
 }
 async saveAd(d:AdInput,actor:string,rid?:number){
  return this.tx('ad',rid?'update':'add',actor,async c=>{
   if(!(await c.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[d.bot_rid])).rowCount)throw new BotServiceError(404,'机器人不存在')
   let old:number|undefined;if(rid){const row=await c.query('SELECT bot_rid FROM t_telegram_bot_ad WHERE rid=$1 FOR UPDATE',[rid]);if(!row.rowCount)throw new BotServiceError(404,'定时广告不存在');old=row.rows[0].bot_rid}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ad:'||$1||':'||$2,0))",[d.bot_rid,d.notice_ad])
   if((await c.query('SELECT rid FROM t_telegram_bot_ad WHERE bot_rid=$1 AND notice_ad=$2 AND rid<>$3',[d.bot_rid,d.notice_ad,rid||0])).rowCount)throw new BotServiceError(409,'该机器人已有相同广告内容')
   const args=[d.bot_rid,d.notice_cycle,d.notice_obj||'-',d.notice_photo,d.notice_ad,actor]
   const row=rid?await c.query('UPDATE t_telegram_bot_ad SET bot_rid=$1,notice_cycle=$2,notice_obj=$3,notice_photo=$4,notice_ad=$5,update_by=$6,update_time=now() WHERE rid=$7 RETURNING rid',[...args,rid]):await c.query('INSERT INTO t_telegram_bot_ad(bot_rid,notice_cycle,notice_obj,notice_photo,notice_ad,status,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,1,$6,now(),$6,now()) RETURNING rid',args)
   return{rid:row.rows[0].rid,bots:old?[old,d.bot_rid]:[d.bot_rid]}
  })
 }
 async status(kind:Kind,rid:number,enabled:boolean,actor:string){return this.tx(kind,'status',actor,async c=>{const t=table[kind],row=await c.query(`UPDATE ${t} SET status=$1,update_by=$2,update_time=now() WHERE rid=$3 RETURNING bot_rid`,[enabled?0:1,actor,rid]);if(!row.rowCount)throw new BotServiceError(404,'记录不存在');return{rid,bots:[row.rows[0].bot_rid]}})}
 async remove(kind:Kind,rid:number,actor:string){return this.tx(kind,'delete',actor,async c=>{const t=table[kind],row=await c.query(`SELECT bot_rid FROM ${t} WHERE rid=$1 FOR UPDATE`,[rid]);if(!row.rowCount)throw new BotServiceError(404,'记录不存在');if(kind==='reply'&&(await c.query('SELECT rid FROM t_telegram_bot_keyreply_keyboard WHERE keyreply_rid=$1 LIMIT 1',[rid])).rowCount)throw new BotServiceError(409,'该回复已关联键盘，请先移除关联');if(kind==='ad')await c.query('DELETE FROM t_telegram_bot_ad_keyboard WHERE ad_rid=$1',[rid]);await c.query(`DELETE FROM ${t} WHERE rid=$1`,[rid]);return{rid,bots:[row.rows[0].bot_rid]}})}
 async copy(kind:Kind,source:number,target:number,overwrite:boolean,actor:string){
  if(source===target)throw new BotServiceError(400,'来源和目标机器人不能相同')
  return this.tx(kind,'copy',actor,async c=>{
   const bots=await c.query('SELECT rid FROM t_telegram_bot WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE',[[source,target]]);if(bots.rowCount!==2)throw new BotServiceError(404,'机器人不存在')
   const rows=await c.query(`SELECT * FROM ${table[kind]} WHERE bot_rid=$1 ORDER BY rid`,[source]);if(!rows.rowCount)throw new BotServiceError(400,'来源机器人没有可复制配置')
   const existing=await c.query(`SELECT rid FROM ${table[kind]} WHERE bot_rid=$1 LIMIT 1`,[target]);if(existing.rowCount&&!overwrite)throw new BotServiceError(409,'目标机器人已有配置，请确认覆盖')
   if(existing.rowCount){if(kind==='reply')await c.query('DELETE FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=$1',[target]);else await c.query('DELETE FROM t_telegram_bot_ad_keyboard WHERE bot_rid=$1',[target]);await c.query(`DELETE FROM ${table[kind]} WHERE bot_rid=$1`,[target])}
   for(const r of rows.rows){if(kind==='reply')await c.query('INSERT INTO t_telegram_bot_keyreply(bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,now())',[target,r.key_type,r.monitor_word,r.reply_photo,r.reply_content,r.opt_type,r.status,r.create_by,r.update_by]);else await c.query('INSERT INTO t_telegram_bot_ad(bot_rid,notice_cycle,notice_obj,notice_photo,notice_ad,status,last_notice_time,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,now(),$8,now())',[target,r.notice_cycle,'-',r.notice_photo,r.notice_ad,r.status,r.create_by,r.update_by])}
   return{rid:target,bots:[source,target],data:{copied:rows.rowCount}}
  })
 }
}
