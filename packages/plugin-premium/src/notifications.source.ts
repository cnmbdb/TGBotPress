import type { DatabaseConnection as Pool } from './host-types.js'

type Database=Pick<Pool,'query'|'connect'>
type Logger=Pick<Console,'error'|'info'>
type Row={rid:number;buy_tg_uid:string|null;premium_tg_username:string;premium_package_month:number;comments:string|null;status?:number;fulfillment_method?:string;tg_notice_user:string;tg_notice_admin:string;tg_admin_uid:string|null;bot_token:string|null}
type Notice={kind:'user'|'admin';chatId:string;text:string}
const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

export function planPremiumNotices(row:Row){
  if(!row.bot_token)return {userDone:true,adminDone:true,notices:[] as Notice[]}
  const userId=String(row.buy_tg_uid??'').trim(),adminId=String(row.tg_admin_uid??'').trim()
  const userDone=row.tg_notice_user.trim()!=='Y'||!userId,adminDone=row.tg_notice_admin.trim()!=='Y'||!adminId
  const name=escapeHtml(row.premium_tg_username),months=escapeHtml(row.premium_package_month),notices:Notice[]=[]
  const waitingStars=Number(row.status)===1&&row.fulfillment_method==='telegram_stars',succeeded=row.status==null||Number(row.status)===2,method=row.fulfillment_method==='telegram_stars'?'Telegram Stars':'TON'
  if(!userDone)notices.push({kind:'user',chatId:userId,text:succeeded?'👑 您的会员已开通成功：\n➖➖➖➖➖➖➖➖\n开通会员用户名：'+name+'\n开通会员月份：<code>'+months+'</code>':'⚠️ 您的会员订单暂未完成，请联系管理员处理。\n开通会员用户名：'+name+'\n开通会员月份：<code>'+months+'</code>'})
  if(!adminDone)notices.push({kind:'admin',chatId:adminId,text:(succeeded?'👑<b>有用户开通会员</b>':waitingStars?'⏳<b>机器人 Stars 余额不足，订单等待补充</b>':'⚠️<b>会员开通需要处理</b>')+' \n➖➖➖➖➖➖➖➖\n开通会员用户名：'+name+'\n开通会员月份：<code>'+months+'</code>\n开通方式：'+method+'\n开通备注：'+escapeHtml(row.comments)})
  return {userDone,adminDone,notices}
}
async function sendNotice(n:Notice,token:string,fetcher:typeof fetch){
  const r=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:n.chatId,text:n.text,parse_mode:'HTML'}),redirect:'error',signal:AbortSignal.timeout(12_000)})
  const body=await r.json().catch(()=>null) as {ok?:boolean}|null
  return r.ok&&body?.ok===true
}
const pendingSql="SELECT rid FROM t_premium_platform_order WHERE tg_notice_user='Y' OR tg_notice_admin='Y' ORDER BY rid LIMIT 5"
const lockSql=`SELECT a.rid,a.buy_tg_uid,a.premium_tg_username,a.premium_package_month,a.comments,a.status,a.fulfillment_method,a.tg_notice_user,a.tg_notice_admin,b.tg_admin_uid,c.bot_token
FROM t_premium_platform_order a
LEFT JOIN LATERAL (SELECT p.tg_admin_uid FROM t_premium_platform p WHERE p.bot_rid=a.bot_rid ORDER BY CASE WHEN p.rid=a.premium_platform_rid THEN 0 ELSE 1 END,p.rid LIMIT 1) b ON TRUE
LEFT JOIN t_telegram_bot c ON c.rid=a.bot_rid
WHERE a.rid=$1 AND (a.tg_notice_user='Y' OR a.tg_notice_admin='Y') FOR UPDATE OF a SKIP LOCKED`
const updateSql='UPDATE t_premium_platform_order SET tg_notice_user=$2,tg_notice_admin=$3 WHERE rid=$1'

export async function sendPremiumTelegramNotifications(options:{pool:Database;fetcher?:typeof fetch;logger?:Logger;shouldContinue?:()=>boolean;enabled?:boolean}){
  if(!options.enabled)return {skipped:true,scanned:0,sent:0,failed:0}
  const pool=options.pool,fetcher=options.fetcher??fetch,logger=options.logger??console,keepGoing=options.shouldContinue??(()=>true)
  if(!keepGoing())return {skipped:true,scanned:0,sent:0,failed:0}
  let scanned=0,sent=0,failed=0
  const pending=await pool.query<{rid:number}>(pendingSql)
  for(const item of pending.rows){
    if(!keepGoing())break
    scanned++;const client=await pool.connect();let active=false
    try{
      await client.query('BEGIN');active=true
      const result=await client.query<Row>(lockSql,[item.rid]),row=result.rows[0]
      if(!row){await client.query('ROLLBACK');active=false;continue}
      let userDone=row.tg_notice_user.trim()!=='Y',adminDone=row.tg_notice_admin.trim()!=='Y'
      if(!row.bot_token){userDone=true;adminDone=true}
      else{
        const plan=planPremiumNotices(row);userDone||=plan.userDone;adminDone||=plan.adminDone
        for(const notice of plan.notices){
          if(!keepGoing())break
          try{if(await sendNotice(notice,row.bot_token,fetcher)){sent++;if(notice.kind==='user')userDone=true;else adminDone=true}else failed++}catch{failed++}
        }
      }
      await client.query(updateSql,[row.rid,userDone?'N':'Y',adminDone?'N':'Y'])
      await client.query('COMMIT');active=false
    }catch{failed++;logger.error('sendpremiumtgmessage failed for order '+item.rid);if(active)try{await client.query('ROLLBACK')}catch{}}
    finally{client.release()}
  }
  return {skipped:false,scanned,sent,failed}
}
