import type { DatabaseConnection as Pool, DatabaseClient as PoolClient, DatabaseRow } from '@tgbotpress/plugin-sdk'
export type ScanHost = { db: Pick<Pool, 'query' | 'connect'>; startAdVerificationChallenge: (...args: any[]) => Promise<any>; effectiveGroupAdKeywords: (...args: any[]) => string[] }
export function createModerationScan(host: ScanHost) {
const { db, startAdVerificationChallenge, effectiveGroupAdKeywords } = host

type Database=Pick<Pool,'query'|'connect'>
type Logger=Pick<Console,'error'|'info'>
type Policy={bot_rid:number;tg_groupid:string;group_moderation_enabled:boolean;block_forwarded_messages:boolean;ad_keywords:string|null;ad_keywords_auto_upload:boolean|null;ad_keywords_auto_sync:boolean|null;ad_action:string;ad_restrict_duration_seconds:number|null;ad_verification_timeout_seconds:number|null}
type History={rid:number;message_id:string;message_json:unknown}
type NoticeResult={ok:boolean;description?:string;result?:{status?:string}}
type Analysis={isAd:boolean;score:number;reasons:string[];preview:string;highConfidence:boolean}
const strong=['博彩','赌场','下注','包赢','刷单','跑分','洗钱','空投群','资金盘','高薪兼职','日赚','稳赚','保本收益','代开发票','出售账号','收购账号','免费空投','担保交易','无押贷款','裸聊','色粉','盘口','娱乐城']
const marketing=['代理招商','渠道合作','低价出售','限时优惠','免费领取','加我咨询','私聊咨询','联系我','承兑','代付','换汇','引流','推广','招聘','广告合作','广告位','商务合作','项目推广','资源对接','招代理','加群','进群','群发','拉人','代收','代充','收u','出u','币商']
const serviceKeys=['new_chat_members','new_chat_member','left_chat_member','new_chat_title','new_chat_photo','delete_chat_photo','group_chat_created','supergroup_chat_created','pinned_message']
const textPart=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v).trim():''
const messageText=(m:Record<string,any>)=>['text','caption'].map(k=>textPart(m[k])).filter(Boolean).join('\n')
const collectText=(m:Record<string,any>)=>[
  m.text,m.caption,m.from?.first_name,m.from?.last_name,m.from?.username,m.sender_chat?.title,
  m.forward_from_chat?.title,m.forward_sender_name,m.forward_origin?.chat?.title,
  m.forward_origin?.sender_user?.username,m.bio,
].map(textPart).filter(Boolean).join(' ').trim()
function analyzeMessage(m:Record<string,any>,keywords:string[],blockForwarded:boolean,threshold:number):Analysis{
  const text=collectText(m),normalized=text.toLocaleLowerCase('und'),reasons:string[]=[]
  const forwarded=!!(m.forward_origin||m.forward_from||m.forward_from_chat||m.forward_date||m.is_automatic_forward)
  let score=0,highConfidence=false
  if(forwarded&&blockForwarded)return{isAd:true,score:Math.max(threshold,5),reasons:['禁止转发消息'],preview:Array.from(text).slice(0,500).join(''),highConfidence:false}
  if(forwarded){score++;reasons.push('转发来源')}
  const textUrls=(normalized.match(/(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)[^\s<]+/giu)||[]).length
  const entityUrls=[...(m.entities||[]),...(m.caption_entities||[])].filter((e:any)=>e?.type==='url'||e?.type==='text_link').length
  const urlCount=Math.max(textUrls,entityUrls)
  if(urlCount){score+=Math.min(4,urlCount*2);reasons.push('包含外部链接')}
  const mention=(normalized.match(/(?:^|[\s，,：:；;])@[a-z0-9_]{5,}/giu)||[]).length
  if(mention){score+=2;reasons.push(mention>=2?'多个联系账号':'包含联系账号')}
  if(/(?:微信|vx|v信|qq|telegram|飞机)\s*[:：]?\s*[a-z0-9_-]{5,}/iu.test(normalized)){score+=2;reasons.push('包含站外联系方式')}
  if(/(?:加|联系|咨询|私聊|找|客服)\s*(?:我|本人|商家|代理)?\s*[:：]?\s*@[a-z0-9_]{5,}/iu.test(normalized)){score+=2;reasons.push('引导私聊联系')}
  const moneyBait=/(?:兜|口袋|钱包).{0,6}(?:比脸.{0,3})?(?:干净|空)|(?:没钱|缺钱|想赚钱|手头紧)/u.test(normalized)
  const direct=/(?:^|[^a-z0-9])(?:m|密|私|滴|找|联系|加)\s*我(?:$|[^a-z0-9])/iu.test(normalized)
  if(moneyBait&&direct){score+=6;reasons.push('高置信规避广告');highConfidence=true}
  if(/(?:诚\s*[招召聘]|招\s*[聘募]|群\s*演|兼\s*职|日\s*结|周\s*结|月\s*结|薪\s*资|工\s*资)/u.test(normalized)){score+=2;reasons.push('招募兼职推广')}
  if(/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)[^\s<]+/iu.test(normalized)){score+=2;reasons.push('群组邀请链接')}
  if(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u.test(normalized)){score+=2;reasons.push('包含手机号')}
  if(strong.some(k=>normalized.includes(k.toLocaleLowerCase('und')))){score+=4;reasons.push('高风险广告词')}
  if(marketing.some(k=>normalized.includes(k.toLocaleLowerCase('und')))){score+=2;reasons.push('营销推广词')}
  if(keywords.some(k=>normalized.includes(k.toLocaleLowerCase('und')))){score+=4;reasons.push('命中自定义广告词')}
  if(/(.)\1{7,}/u.test(normalized)){score++;reasons.push('重复字符刷屏')}
  if(Array.from(normalized).length>180&&urlCount){score++;reasons.push('长营销文案')}
  return{isAd:score>=Math.max(1,threshold),score,reasons:[...new Set(reasons)],preview:Array.from(text).slice(0,500).join(''),highConfidence}
}
function isServiceMessage(m:Record<string,any>){return serviceKeys.some(k=>Object.prototype.hasOwnProperty.call(m,k))}
function isKeywordCommand(m:Record<string,any>,username:string|null){const match=String(m.text??'').trim().match(/^\/jgjc(?:@([a-z0-9_]+))?\s*$/iu);if(!match)return false;const mentioned=String(match[1]??'');const bot=String(username??'').replace(/^@/,'');return !mentioned||(!!bot&&mentioned.toLowerCase()===bot.toLowerCase())}
async function telegram(fetcher:typeof fetch,token:string,method:string,payload:Record<string,unknown>):Promise<NoticeResult>{
  try{const r=await fetcher('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(12_000)});return await r.json() as NoticeResult}catch{return{ok:false,description:'Telegram 接口暂时无法连接'}}
}
const restricted={can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_react_to_messages:false}
async function locked<T extends DatabaseRow>(pool:Database,parameters:unknown[],sql:string,handle:(row:T,client:PoolClient)=>Promise<void>){
 const c=await pool.connect();let active=false
 try{await c.query('BEGIN');active=true;const r=await c.query<T>(sql,parameters);const row=r.rows[0];if(!row){await c.query('ROLLBACK');active=false;return false}await handle(row,c);await c.query('COMMIT');active=false;return true}
 catch(e){if(active)try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
}
async function scanRecentGroupMessages(options:{botRid:number;chatId:string;minutes?:number;messageId?:string;pool?:Database;fetcher?:typeof fetch;logger?:Logger}){
 if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true')return{skipped:true,scanned:0,processed:0,failed:0,challengeFallbacks:0}
 const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,minutes=Math.max(1,Math.min(30,options.minutes??30))
 const configResult=await pool.query<{bot_token:string|null;bot_username:string|null;ad_score_threshold:number;ad_keywords:string|null}>(
  'SELECT b.bot_token,b.bot_username,c.ad_score_threshold,c.ad_keywords FROM t_telegram_bot b LEFT JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid WHERE b.rid=$1',[options.botRid])
 const bot=configResult.rows[0];if(!bot?.bot_token)return{skipped:false,scanned:0,processed:0,failed:0,challengeFallbacks:0}
 const policyResult=await pool.query<Policy>(
  'SELECT bot_rid,tg_groupid::text AS tg_groupid,group_moderation_enabled,block_forwarded_messages,ad_keywords,ad_keywords_auto_upload,ad_keywords_auto_sync,ad_action,ad_restrict_duration_seconds,ad_verification_timeout_seconds FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2',[options.botRid,options.chatId])
 const policy=policyResult.rows[0];if(!policy?.group_moderation_enabled)return{skipped:false,scanned:0,processed:0,failed:0,challengeFallbacks:0}
 const recent=await pool.query<History>(
  'SELECT rid,message_id::text AS message_id,message_json FROM t_telegram_group_message_history WHERE bot_rid=$1 AND chat_id=$2 AND message_date>=now()-($3::text||\' minutes\')::interval AND ($4::bigint IS NULL OR message_id=$4::bigint) ORDER BY message_date LIMIT 500',
  [options.botRid,options.chatId,minutes,options.messageId??null])
 const userCache=new Map<string,boolean>();let scanned=0,processed=0,failed=0,challengeFallbacks=0
 const lockSql='SELECT rid,message_id::text AS message_id,message_json FROM t_telegram_group_message_history WHERE rid=$1 AND bot_rid=$2 AND chat_id=$3 FOR UPDATE SKIP LOCKED'
 for(const candidate of recent.rows){
  scanned++
  try{
   const result=await locked<History & Record<string,any>>(pool,[candidate.rid,options.botRid,options.chatId],lockSql,async(row,client)=>{
    const message=typeof row.message_json==='string'?JSON.parse(row.message_json):row.message_json
    if(!message||typeof message!=='object'||Array.isArray(message)||isServiceMessage(message)||isKeywordCommand(message,bot.bot_username))return
    const user=message.from;if(!user?.id||user.is_bot)return
    const logged=await client.query("SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$3 AND event_type IN ('group_ad','flood') LIMIT 1",[options.botRid,options.chatId,row.message_id])
    if(logged.rowCount)return
    const userId=String(user.id)
    let isAdmin=userCache.get(userId)
    if(isAdmin===undefined){
      const response=await telegram(fetcher,bot.bot_token!,'getChatMember',{chat_id:options.chatId,user_id:userId})
      isAdmin=['creator','administrator'].includes(String(response.result?.status||''));userCache.set(userId,isAdmin)
    }
    if(isAdmin)return
    const custom=effectiveGroupAdKeywords(policy.ad_keywords,bot.ad_keywords,policy.ad_keywords_auto_upload,policy.ad_keywords_auto_sync)
    const analysis=analyzeMessage(message,custom,policy.block_forwarded_messages,Number(bot.ad_score_threshold)||4)
    if(!analysis.isAd)return
    processed++
    await telegram(fetcher,bot.bot_token!,'deleteMessage',{chat_id:options.chatId,message_id:row.message_id})
    let action=analysis.highConfidence?'ban':policy.ad_action
    if(action==='verify'){
      const started=await startAdVerificationChallenge({client,fetcher,botRid:options.botRid,botToken:bot.bot_token!,chatId:options.chatId,userId,message,policy:{ad_verification_timeout_seconds:Number(policy.ad_verification_timeout_seconds)||1800}})
      if(!started){action='delete';challengeFallbacks++}
    }
    let restrictedUntil:string|null=null,ok=true
    if(action==='ban'){
      const r=await telegram(fetcher,bot.bot_token!,'banChatMember',{chat_id:options.chatId,user_id:userId});ok=r.ok
    }else if(action==='restrict'||action==='restrict_forever'){
      const payload:Record<string,unknown>={chat_id:options.chatId,user_id:userId,permissions:restricted,use_independent_chat_permissions:true}
      if(action==='restrict'){const seconds=Math.max(60,Number(policy.ad_restrict_duration_seconds)||3600);const at=new Date(Date.now()+seconds*1000);payload.until_date=Math.floor(at.getTime()/1000);restrictedUntil=at.toISOString()}
      const r=await telegram(fetcher,bot.bot_token!,'restrictChatMember',payload);ok=r.ok
    }else if(action!=='verify')action='delete'
    if(ok&&(action==='ban'||action==='restrict'||action==='restrict_forever')){
      await client.query("INSERT INTO t_telegram_moderated_member(bot_rid,chat_id,user_id,action,restricted_until,status,create_time,update_time) VALUES($1,$2,$3,$4,$5,'active',now(),now()) ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET action=EXCLUDED.action,restricted_until=EXCLUDED.restricted_until,status='active',update_time=now()",
       [options.botRid,options.chatId,userId,action,restrictedUntil])
    }
    await client.query('INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
      [options.botRid,options.chatId,userId,row.message_id,analysis.reasons.includes('短时间高频发言')?'flood':'group_ad',ok?action:'failed',analysis.score,analysis.reasons.join('、'),analysis.preview])
   })
   if(!result)continue
  }catch(error){failed++;logger.error('moderation recent scan failed for group '+options.chatId)}
 }
 return{skipped:false,scanned,processed,failed,challengeFallbacks}
}

return { analyzeMessage, scanRecentGroupMessages }
}
