import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error' | 'info'>
type TransitRow = {
  rid:number; tx_hash:string; transferfrom_address:string; coin_name:string; amount:string; process_status:number
  tg_notice_status_receive:string; tg_notice_status_send:string; sendback_amount:string
  tg_notice_obj_receive:string|null; tg_notice_obj_send:string|null; bot_token:string|null; receive_wallet:string
  current_huan_yuzhi_amount:string|number; sendback_time:string|null; bot_admin_username:string|null
}
type Notice = { chatId:string; text:string; replyMarkup:unknown }
const recipients=(value:string|null)=>String(value??'').split(',').map(x=>x.trim()).filter(Boolean)
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

export function planTransitNotices(row:TransitRow) {
  let receiveDone=row.tg_notice_status_receive!=='N', sendDone=row.tg_notice_status_send!=='N'
  const notices:Notice[]=[]
  if(!row.bot_token) return {receiveDone:true,sendDone:true,notices}
  const receive=recipients(row.tg_notice_obj_receive), send=recipients(row.tg_notice_obj_send)
  if(!receive.length) receiveDone=true
  if(!send.length) sendDone=true
  if(!receiveDone&&[1,8,9,10].includes(Number(row.process_status))&&receive.length) {
    const text='有新的闪兑交易：\n➖➖➖➖➖➖➖➖\n转入交易哈希：<code>'+escapeHtml(row.tx_hash)+'</code>\n转入钱包地址：<code>'+escapeHtml(row.transferfrom_address)+'</code>\n转入币名：'+escapeHtml(row.coin_name)+'\n转入金额：'+escapeHtml(row.amount)
    const replyMarkup={inline_keyboard:[[{text:'查看转入交易',url:'https://tronscan.io/#/transaction/'+encodeURIComponent(row.tx_hash)}]]}
    receive.forEach(chatId=>notices.push({chatId,text,replyMarkup})); receiveDone=true
  }
  if(!sendDone&&Number(row.process_status)===9&&send.length) {
    const advance=Number(row.current_huan_yuzhi_amount)>0?'\n<b>归还预支TRX数量</b>：'+escapeHtml(row.current_huan_yuzhi_amount)+' TRX':''
    const addr=String(row.transferfrom_address??'')
    const text='✅<b>USDT 兑换 TRX成功</b>\n认准24小时自动回TRX地址(点击复制)：<code>'+escapeHtml(row.receive_wallet)+'</code>\n➖➖➖➖➖➖➖➖\n<b>兑换金额</b>：'+escapeHtml(row.amount)+' USDT\n<b>TRX数量</b>：'+escapeHtml(row.sendback_amount)+' TRX'+advance+'\n<b>兑换地址</b>：'+escapeHtml(addr.slice(0,8)+'****'+addr.slice(-8))+'\n<b>兑换时间</b>：'+escapeHtml(row.sendback_time)+'\n➖➖➖➖➖➖➖➖'
    const admin=String(row.bot_admin_username??'').replace(/^@/,'')
    const replyMarkup={inline_keyboard:[[{text:'👨联系客服',url:'https://t.me/'+encodeURIComponent(admin)}]]}
    send.forEach(chatId=>notices.push({chatId,text,replyMarkup})); sendDone=true
  }
  if([6,7,10,5,2].includes(Number(row.process_status))) { receiveDone=true; sendDone=true }
  return {receiveDone,sendDone,notices}
}

async function sendNotice(notice:Notice,token:string,fetcher:typeof fetch) {
  const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:notice.chatId,text:notice.text,parse_mode:'HTML',reply_markup:notice.replyMarkup}),
    redirect:'error',signal:AbortSignal.timeout(12_000),
  })
  const result=await response.json().catch(()=>null) as {ok?:boolean}|null
  return response.ok&&result?.ok===true
}
const pendingSql="SELECT rid FROM t_transit_wallet_trade_list WHERE tg_notice_status_receive='N' OR tg_notice_status_send='N' ORDER BY rid LIMIT 5"
const lockedSql="SELECT a.rid,a.tx_hash,a.transferfrom_address,a.coin_name,a.amount,a.process_status,a.tg_notice_status_receive,a.tg_notice_status_send,a.sendback_amount,a.current_huan_yuzhi_amount::text AS current_huan_yuzhi_amount,a.sendback_time,b.tg_notice_obj_receive,b.tg_notice_obj_send,b.receive_wallet,c.bot_token,c.bot_admin_username FROM t_transit_wallet_trade_list a LEFT JOIN t_transit_wallet b ON a.transferto_address=b.receive_wallet LEFT JOIN t_telegram_bot c ON b.bot_rid=c.rid WHERE a.rid=$1 AND (a.tg_notice_status_receive='N' OR a.tg_notice_status_send='N') FOR UPDATE OF a SKIP LOCKED"
export async function sendTransitTelegramNotifications(options:{pool?:Database;fetcher?:typeof fetch;logger?:Logger;shouldContinue?:()=>boolean}={}) {
  if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true') return {skipped:true,scanned:0,sent:0,failed:0}
  const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,shouldContinue=options.shouldContinue??(()=>true)
  if(!shouldContinue()) return {skipped:true,scanned:0,sent:0,failed:0}
  let scanned=0,sent=0,failed=0
  const pending=await pool.query<{rid:number}>(pendingSql)
  for(const candidate of pending.rows) {
    if(!shouldContinue()) break
    scanned++; const client=await pool.connect(); let transaction=false
    try {
      await client.query('BEGIN');transaction=true
      const selected=await client.query<TransitRow>(lockedSql,[candidate.rid]),row=selected.rows[0]
      if(!row||!shouldContinue()){await client.query('ROLLBACK');transaction=false;continue}
      const plan=planTransitNotices(row)
      for(const notice of plan.notices) {
        if(!shouldContinue()) break
        try {if(await sendNotice(notice,row.bot_token!,fetcher)) sent++;else failed++} catch {failed++}
      }
      if(!shouldContinue()){await client.query('ROLLBACK');transaction=false;continue}
      if(plan.receiveDone||plan.sendDone) await client.query(
        'UPDATE t_transit_wallet_trade_list SET tg_notice_status_receive=$2,tg_notice_status_send=$3 WHERE rid=$1',
        [row.rid,plan.receiveDone?'Y':row.tg_notice_status_receive,plan.sendDone?'Y':row.tg_notice_status_send])
      await client.query('COMMIT');transaction=false
    } catch {
      failed++;logger.error('sendtransittgmessage failed for trade '+candidate.rid)
      if(transaction) try {await client.query('ROLLBACK')} catch {}
    } finally {client.release()}
  }
  return {skipped:false,scanned,sent,failed}
}
