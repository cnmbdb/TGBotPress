import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { BotServiceError,invalidateLegacyBotCache } from './bot-service.server'

type Kind='reply'|'ad';type Invalidate=(rid:number)=>Promise<void>
const relation={reply:'t_telegram_bot_keyreply_keyboard',ad:'t_telegram_bot_ad_keyboard'} as const
const parent={reply:'t_telegram_bot_keyreply',ad:'t_telegram_bot_ad'} as const
export class KeyboardRelationsService{
 constructor(private pool:Pool,private invalidate:Invalidate=invalidateLegacyBotCache){}
 async options(){const [bots,replies,ads,keyboards]=await Promise.all([
  this.pool.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid'),
  this.pool.query('SELECT r.rid,r.bot_rid,r.monitor_word,b.bot_firstname,b.bot_username FROM t_telegram_bot_keyreply r JOIN t_telegram_bot b ON b.rid=r.bot_rid ORDER BY r.rid DESC LIMIT 5000'),
  this.pool.query('SELECT a.rid,a.bot_rid,left(a.notice_ad,100) label,b.bot_firstname,b.bot_username FROM t_telegram_bot_ad a JOIN t_telegram_bot b ON b.rid=a.bot_rid ORDER BY a.rid DESC LIMIT 5000'),
  this.pool.query('SELECT rid,keyboard_type,keyboard_name,inline_type,keyboard_value,status FROM t_telegram_bot_keyboard ORDER BY rid')
 ]);return{bots:bots.rows,replies:replies.rows,ads:ads.rows,keyboards:keyboards.rows}}
 async list(kind:Kind,page:number,size:number,search:string,bot?:number){
  const p=kind==='reply'?'t_telegram_bot_keyreply':'t_telegram_bot_ad',needle=kind==='reply'?'c.monitor_word':'c.notice_ad'
  const params:unknown[]=[`%${search}%`];let where=`(${needle} ILIKE $1 OR d.keyboard_name ILIKE $1)`
  if(bot){params.push(bot);where+=` AND a.bot_rid=$2`}
  const base=`FROM ${relation[kind]} a JOIN t_telegram_bot b ON b.rid=a.bot_rid JOIN ${p} c ON c.rid=a.${kind==='reply'?'keyreply_rid':'ad_rid'} JOIN t_telegram_bot_keyboard d ON d.rid=a.keyboard_rid WHERE ${where}`
  const count=await this.pool.query(`SELECT count(*)::int total ${base}`,params)
  const rows=await this.pool.query(`SELECT a.rid,a.bot_rid,a.${kind==='reply'?'keyreply_rid':'ad_rid'} parent_rid,a.keyboard_rid,b.bot_firstname,b.bot_username,${needle} parent_label,c.${kind==='reply'?'key_type':'notice_cycle'} parent_type,d.keyboard_name,d.keyboard_type,d.inline_type,d.keyboard_value,a.create_time AT TIME ZONE 'Asia/Shanghai' create_time,a.update_time AT TIME ZONE 'Asia/Shanghai' update_time ${base} ORDER BY a.rid DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,size,(page-1)*size])
  return{rows:rows.rows,total:count.rows[0].total}
 }
 private async tx<T>(kind:Kind,action:string,actor:string,work:(c:PoolClient)=>Promise<{rid:number;bots:number[];data?:T}>):Promise<T>{const c=await this.pool.connect();let committed=false;try{await c.query('BEGIN');const out=await work(c);for(const bot of new Set(out.bots))await this.invalidate(bot);await c.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,`telegram.${kind}.keyboard.${action}`,out.rid]);await c.query('COMMIT');committed=true;for(const bot of new Set(out.bots))try{await this.invalidate(bot)}catch{console.error('Keyboard relation cache refresh failed')}return out.data as T}catch(e){if(!committed)await c.query('ROLLBACK');throw e}finally{c.release()}}
 private async checkParents(c:PoolClient,kind:Kind,bot:number,par:number,key:number,exclude=0){
  const p=await c.query(`SELECT bot_rid FROM ${parent[kind]} WHERE rid=$1 FOR UPDATE`,[par]);if(!p.rowCount)throw new BotServiceError(404,kind==='reply'?'关键字不存在':'广告不存在');if(Number(p.rows[0].bot_rid)!==bot)throw new BotServiceError(400,'机器人与配置不匹配')
  const k=await c.query('SELECT keyboard_type FROM t_telegram_bot_keyboard WHERE rid=$1 FOR UPDATE',[key]);if(!k.rowCount)throw new BotServiceError(404,'键盘不存在')
  if((await c.query(`SELECT rid FROM ${relation[kind]} WHERE ${kind==='reply'?'keyreply_rid':'ad_rid'}=$1 AND keyboard_rid=$2 AND rid<>$3`,[par,key,exclude])).rowCount)throw new BotServiceError(409,'该配置已关联此键盘')
  if(kind==='ad'&&(await c.query('SELECT a.rid FROM t_telegram_bot_ad_keyboard a JOIN t_telegram_bot_keyboard k ON k.rid=a.keyboard_rid WHERE a.ad_rid=$1 AND a.rid<>$2 AND k.keyboard_type<>$3 LIMIT 1',[par,exclude,k.rows[0].keyboard_type])).rowCount)throw new BotServiceError(409,'同一个定时广告只能关联一种键盘类型')
 }
 async save(kind:Kind,d:{bot_rid:number;parent_rid:number;keyboard_rid:number},actor:string,rid?:number){return this.tx(kind,rid?'update':'add',actor,async c=>{
  let oldbot:number|undefined;if(rid){const old=await c.query(`SELECT bot_rid FROM ${relation[kind]} WHERE rid=$1 FOR UPDATE`,[rid]);if(!old.rowCount)throw new BotServiceError(404,'关联不存在');oldbot=old.rows[0].bot_rid}
  const locked=await c.query('SELECT rid FROM t_telegram_bot WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE',[[d.bot_rid,oldbot].filter(Boolean)]);if(!locked.rowCount)throw new BotServiceError(404,'机器人不存在')
  const par=kind==='reply'?'keyreply_rid':'ad_rid';await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('relation:'||$1||':'||$2,0))`,[kind,d.parent_rid])
  await this.checkParents(c,kind,d.bot_rid,d.parent_rid,d.keyboard_rid,rid||0)
  const args=[d.bot_rid,d.parent_rid,d.keyboard_rid,actor]
  const q=rid?await c.query(`UPDATE ${relation[kind]} SET bot_rid=$1,${par}=$2,keyboard_rid=$3,update_by=$4,update_time=now() WHERE rid=$5 RETURNING rid`,[...args,rid]):await c.query(`INSERT INTO ${relation[kind]}(bot_rid,${par},keyboard_rid,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now()) RETURNING rid`,args)
  return{rid:q.rows[0].rid,bots:oldbot?[oldbot,d.bot_rid]:[d.bot_rid]}
 })}
 async remove(kind:Kind,rid:number,actor:string){return this.tx(kind,'delete',actor,async c=>{const q=await c.query(`DELETE FROM ${relation[kind]} WHERE rid=$1 RETURNING rid,bot_rid`,[rid]);if(!q.rowCount)throw new BotServiceError(404,'关联不存在');return{rid,bots:[q.rows[0].bot_rid]}})}
 async quick(kind:Kind,parentRid:number,keyType:number,actor:string){return this.tx(kind,'fastadd',actor,async c=>{const pr=kind==='reply'?'keyreply_rid':'ad_rid';const p=await c.query(`SELECT rid,bot_rid FROM ${parent[kind]} WHERE rid=$1 FOR UPDATE`,[parentRid]);if(!p.rowCount)throw new BotServiceError(404,kind==='reply'?'关键字不存在':'广告不存在');const keys=await c.query('SELECT rid FROM t_telegram_bot_keyboard WHERE keyboard_type=$1 ORDER BY rid',[keyType]);if(!keys.rowCount)throw new BotServiceError(400,'该键盘类型没有键盘');await c.query(`DELETE FROM ${relation[kind]} WHERE ${pr}=$1`,[parentRid]);for(const key of keys.rows)await c.query(`INSERT INTO ${relation[kind]}(bot_rid,${pr},keyboard_rid,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now())`,[p.rows[0].bot_rid,parentRid,key.rid,actor]);return{rid:parentRid,bots:[p.rows[0].bot_rid],data:{added:keys.rowCount}}})}
 async quickBotReplies(bot:number,keyType:number,actor:string){return this.tx('reply','fastbotadd',actor,async c=>{const b=await c.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[bot]);if(!b.rowCount)throw new BotServiceError(404,'机器人不存在');const keys=await c.query('SELECT rid FROM t_telegram_bot_keyboard WHERE keyboard_type=$1 ORDER BY rid',[keyType]),replies=await c.query('SELECT rid FROM t_telegram_bot_keyreply WHERE bot_rid=$1 ORDER BY rid',[bot]);if(!keys.rowCount)throw new BotServiceError(400,'该键盘类型没有键盘');if(!replies.rowCount)throw new BotServiceError(400,'机器人没有关键字');await c.query('DELETE FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=$1',[bot]);for(const reply of replies.rows)for(const key of keys.rows)await c.query('INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid,keyboard_rid,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now())',[bot,reply.rid,key.rid,actor]);return{rid:bot,bots:[bot],data:{added:keys.rowCount*replies.rowCount}}})}
 async quickBotDelete(bot:number,key:number,actor:string){return this.tx('reply','fastbotdelete',actor,async c=>{const b=await c.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[bot]);if(!b.rowCount)throw new BotServiceError(404,'机器人不存在');const q=await c.query('DELETE FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=$1 AND keyboard_rid=$2',[bot,key]);return{rid:bot,bots:[bot],data:{deleted:q.rowCount}}})}
}
