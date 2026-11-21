import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error' | 'info'>
type EnergyTrade = {
  rid:number; tx_hash:string; transferfrom_address:string; coin_name:string; amount:string; process_status:number; process_comments:string|null
  tg_notice_status_receive:string; tg_notice_status_send:string; tg_notice_obj_receive:string|null
  tg_notice_obj_send:string|null; bot_token:string|null; receive_wallet:string|null; energy_amount:number|null
  package_name:string|null; bot_username:string|null; bot_admin_username:string|null
}
type QuickOrder = {
  rid:number; tg_uid:string|null; wallet_addr:string; energy_amount:number; bot_token:string|null
  is_notice:string; comments:string|null; bot_username:string|null; bot_admin_username:string|null
  bot_rid:number; tg_notice_obj_send:string|null
}
type AiOrder = {
  rid:number; tg_uid:string|null; wallet_addr:string; quantity:number; bot_token:string|null
  is_notice:string; is_notice_admin:string; tg_admin_uid:string|null; comments:string|null
  tg_notice_obj_send:string|null; bot_username:string|null; bot_admin_username:string|null
  bot_rid:number; max_buy_quantity:number; total_buy_quantity:number
  trx_price_energy_32000:number|null; trx_price_energy_65000:number|null
}
type Notice = { chatId:string; text:string; replyMarkup?:unknown; direction?:'receive'|'send' }
const ids=(value:string|null)=>String(value??'').split(',').map(v=>v.trim()).filter(Boolean)
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const shortAddress=(value:string)=>value.slice(0,8)+'****'+value.slice(-8)
const botLink=(value:string|null)=>'https://t.me/'+encodeURIComponent(String(value??'').replace(/^@/,''))
function energyKeyboard(bot:string|null,admin:string|null) {
  return {inline_keyboard:[
    [{text:'笔数套餐',url:botLink(bot)}],
    [{text:'联系客服',url:botLink(admin)},{text:'TRX闪兑',url:botLink(bot)}],
  ]}
}
export function planEnergyTradeNotices(row:EnergyTrade) {
  let receiveDone=row.tg_notice_status_receive!=='N',sendDone=row.tg_notice_status_send!=='N'
  const notices:Notice[]=[]
  if(!row.bot_token) return {receiveDone:true,sendDone:true,notices}
  const receive=ids(row.tg_notice_obj_receive),send=ids(row.tg_notice_obj_send)
  if(!receive.length) receiveDone=true
  if(!send.length) sendDone=true
  if(!receiveDone&&[1,4,8,9].includes(Number(row.process_status))&&receive.length) {
    const text='🔋有新的能量交易：\n➖➖➖➖➖➖➖➖\n转入交易哈希：<code>'+escapeHtml(row.tx_hash)+'</code>\n转入钱包地址：<code>'+escapeHtml(row.transferfrom_address)+'</code>\n转入币名：'+escapeHtml(row.coin_name)+'\n转入金额：'+escapeHtml(row.amount)
    const replyMarkup={inline_keyboard:[[{text:'查看转入交易',url:'https://tronscan.io/#/transaction/'+encodeURIComponent(row.tx_hash)}]]}
    receive.forEach(chatId=>notices.push({chatId,text,replyMarkup,direction:'receive'}));receiveDone=true
  }
  if(!sendDone&&Number(row.process_status)===9&&send.length) {
    const isBishuPurchase=String(row.coin_name).toLowerCase()==='usdt'&&String(row.process_comments??'').startsWith('成功,笔数套餐增加：')
    const addedQuantity=isBishuPurchase?escapeHtml(String(row.process_comments).slice('成功,笔数套餐增加：'.length)):'0'
    const text=isBishuPurchase?'✳️<b>笔数套餐购买成功</b>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：笔数套餐\n<b>免费转账</b>：'+addedQuantity+' 次\n<b>下单地址</b>：'+escapeHtml(shortAddress(row.transferfrom_address))+'\n\n<b>笔数套餐转账不扣TRX，智能监控地址补足能量</b>\n发送 /buyenergy 继续购买能量！\n➖➖➖➖➖➖➖➖':'🔋<b>新的能量订单成功</b>\n认准24小时自动购买能量地址(点击复制)：<code>'+escapeHtml(row.receive_wallet)+'</code>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：自助下单\n<b>购买套餐</b>：'+escapeHtml(row.package_name)+'\n<b>能量数量</b>：'+escapeHtml(row.energy_amount)+'\n<b>支付金额</b>：'+escapeHtml(row.amount)+' TRX\n<b>支付地址</b>：'+escapeHtml(shortAddress(row.transferfrom_address))+'\n\n<b>能量已经到账！请在时间范围内使用！</b>\n发送 /buyenergy 继续购买能量！\n➖➖➖➖➖➖➖➖'
    const replyMarkup={inline_keyboard:[
      ...(isBishuPurchase?[[{text:'能量闪租',url:botLink(row.bot_username)},{text:'笔数套餐',url:botLink(row.bot_username)}]]:[[{text:'笔数套餐',url:botLink(row.bot_username)}]]),
      [{text:'联系客服',url:botLink(row.bot_admin_username)},{text:'TRX闪兑',url:botLink(row.bot_username)}],
    ]}
    send.forEach(chatId=>notices.push({chatId,text,replyMarkup,direction:'send'}));sendDone=true
  }
  if([6,7,5,4].includes(Number(row.process_status))){receiveDone=true;sendDone=true}
  return {receiveDone,sendDone,notices}
}

async function telegram(notice:Notice,token:string,fetcher:typeof fetch) {
  const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:notice.chatId,text:notice.text,parse_mode:'HTML',...(notice.replyMarkup?{reply_markup:notice.replyMarkup}:{})}),
    redirect:'error',signal:AbortSignal.timeout(12_000),
  })
  const result=await response.json().catch(()=>null) as {ok?:boolean}|null
  return response.ok&&result?.ok===true
}
async function sendMany(notices:Notice[],token:string,fetcher:typeof fetch,shouldContinue:()=>boolean) {
  let sent=0,failed=0
  for(const notice of notices) {
    if(!shouldContinue()) break
    try {if(await telegram(notice,token,fetcher)) sent++;else failed++} catch {failed++}
  }
  return {sent,failed}
}
function assertContinuing(shouldContinue:()=>boolean) {
  if(!shouldContinue()) throw new Error('WORKER_STOPPING')
}
async function lockRow<T extends QueryResultRow>(pool:Database,rid:number,sql:string,handle:(row:T,client:PoolClient)=>Promise<{sent:number;failed:number}> ) {
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const result=await client.query<T>(sql,[rid]),row=result.rows[0]
    if(!row){await client.query('ROLLBACK');return {sent:0,failed:0}}
    const stats=await handle(row,client)
    await client.query('COMMIT')
    return stats
  } catch(error) {
    try {await client.query('ROLLBACK')} catch {}
    throw error
  } finally {client.release()}
}
async function processIds<T extends QueryResultRow & {rid:number}>(pool:Database,selectSql:string,lockSql:string,handle:(row:T,client:PoolClient)=>Promise<{sent:number;failed:number}>,shouldContinue:()=>boolean,logger:Logger,task:string) {
  let scanned=0,sent=0,failed=0
  const pending=await pool.query<T>(selectSql)
  for(const candidate of pending.rows) {
    if(!shouldContinue()) break
    scanned++
    try {const stats=await lockRow(pool,candidate.rid,lockSql,handle);sent+=stats.sent;failed+=stats.failed}
    catch {failed++;logger.error(task+' failed')}
  }
  return {scanned,sent,failed}
}
const tradeSelect="SELECT rid FROM t_energy_wallet_trade_list WHERE tg_notice_status_receive='N' OR tg_notice_status_send='N' ORDER BY rid LIMIT 5"
const tradeLock="SELECT a.rid,a.tx_hash,a.transferfrom_address,a.coin_name,a.amount,a.process_status,a.process_comments,a.tg_notice_status_receive,a.tg_notice_status_send,b.tg_notice_obj_receive,b.tg_notice_obj_send,c.bot_token,b.receive_wallet,d.energy_amount,d.package_name,c.bot_username,c.bot_admin_username FROM t_energy_wallet_trade_list a LEFT JOIN t_energy_platform_bot b ON a.energy_platform_bot_rid=b.rid LEFT JOIN t_telegram_bot c ON b.bot_rid=c.rid LEFT JOIN energy_platform_package d ON a.energy_package_rid=d.rid WHERE a.rid=$1 AND (a.tg_notice_status_receive='N' OR a.tg_notice_status_send='N') FOR UPDATE OF a SKIP LOCKED"
const quickSelect="SELECT rid FROM t_energy_quick_order WHERE is_notice='Y' ORDER BY rid LIMIT 5"
const quickLock="SELECT a.rid,a.tg_uid,a.wallet_addr,a.energy_amount,c.bot_token,a.is_notice,a.comments,c.bot_username,c.bot_admin_username,a.bot_rid,b.tg_notice_obj_send FROM t_energy_quick_order a LEFT JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid LEFT JOIN t_telegram_bot c ON a.bot_rid=c.rid WHERE a.rid=$1 AND a.is_notice='Y' FOR UPDATE OF a SKIP LOCKED"
const trusteeSelect="SELECT rid FROM t_energy_ai_trusteeship WHERE is_notice='Y' OR is_notice_admin='Y' ORDER BY rid LIMIT 5"
const trusteeLock="SELECT a.rid,a.tg_uid::text AS tg_uid,a.wallet_addr,a.per_buy_energy_quantity AS quantity,c.bot_token,a.is_notice_admin,a.is_notice,b.tg_admin_uid,a.comments,b.tg_notice_obj_send,c.bot_username,c.bot_admin_username,a.bot_rid,a.max_buy_quantity,a.total_buy_quantity,b.trx_price_energy_32000,b.trx_price_energy_65000 FROM t_energy_ai_trusteeship a LEFT JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid LEFT JOIN t_telegram_bot c ON a.bot_rid=c.rid WHERE a.rid=$1 AND (a.is_notice='Y' OR a.is_notice_admin='Y') FOR UPDATE OF a SKIP LOCKED"
const bishuSelect="SELECT rid FROM t_energy_ai_bishu WHERE is_notice='Y' OR is_notice_admin='Y' ORDER BY rid LIMIT 5"
const bishuLock="SELECT a.rid,a.tg_uid,a.wallet_addr,b.per_bishu_energy_quantity AS quantity,c.bot_token,a.is_notice_admin,a.is_notice,b.tg_admin_uid,a.comments,b.tg_notice_obj_send,c.bot_username,c.bot_admin_username,a.bot_rid,a.max_buy_quantity,a.total_buy_quantity,NULL::integer AS trx_price_energy_32000,NULL::integer AS trx_price_energy_65000 FROM t_energy_ai_bishu a LEFT JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid LEFT JOIN t_telegram_bot c ON a.bot_rid=c.rid WHERE a.rid=$1 AND (a.is_notice='Y' OR a.is_notice_admin='Y') FOR UPDATE OF a SKIP LOCKED"
async function runEnergyTrades(pool:Database,fetcher:typeof fetch,shouldContinue:()=>boolean,logger:Logger) {
  return processIds<EnergyTrade>(pool,tradeSelect,tradeLock,async(row,client)=>{
    if(!row.bot_token) {
      await client.query("UPDATE t_energy_wallet_trade_list SET tg_notice_status_receive='Y',tg_notice_status_send='Y' WHERE rid=$1",[row.rid])
      return {sent:0,failed:0}
    }
    const plan=planEnergyTradeNotices(row)
    const receiveStats=await sendMany(plan.notices.filter(notice=>notice.direction==='receive'),row.bot_token,fetcher,shouldContinue)
    const sendStats=await sendMany(plan.notices.filter(notice=>notice.direction==='send'),row.bot_token,fetcher,shouldContinue)
    const stats={sent:receiveStats.sent+sendStats.sent,failed:receiveStats.failed+sendStats.failed}
    assertContinuing(shouldContinue)
    const receiveDone=plan.receiveDone&&receiveStats.failed===0,sendDone=plan.sendDone&&sendStats.failed===0
    if(receiveDone||sendDone) await client.query(
      'UPDATE t_energy_wallet_trade_list SET tg_notice_status_receive=$2,tg_notice_status_send=$3 WHERE rid=$1',
      [row.rid,receiveDone?'Y':row.tg_notice_status_receive,sendDone?'Y':row.tg_notice_status_send])
    return stats
  },shouldContinue,logger,'sendenergytgmessage.trade')
}
function orderNotice(kind:'quick'|'trustee'|'bishu',row:QuickOrder|AiOrder,chatId:string,text:string) {
  return {chatId,text,replyMarkup:energyKeyboard(row.bot_username,row.bot_admin_username)} as Notice
}
async function runQuickOrders(pool:Database,fetcher:typeof fetch,shouldContinue:()=>boolean,logger:Logger) {
  return processIds<QuickOrder>(pool,quickSelect,quickLock,async(row,client)=>{
    let sent=0,failed=0
    if(!row.bot_token) {
      await client.query("UPDATE t_energy_quick_order SET is_notice='N' WHERE rid=$1",[row.rid])
      return {sent,failed}
    }
    const text='🔋<b>快捷能量订单成功</b>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：钱包余额支付\n<b>能量数量</b>：'+escapeHtml(row.energy_amount)+'\n<b>能量地址</b>：'+escapeHtml(shortAddress(row.wallet_addr))+'\n\n<b>能量已经到账！请在时间范围内使用！</b>\n发送 /buyenergy 继续购买能量！\n➖➖➖➖➖➖➖➖'
    const notices:Notice[]=[]
    if(row.tg_uid) notices.push(orderNotice('quick',row,row.tg_uid,text))
    for(const chatId of ids(row.tg_notice_obj_send)) notices.push(orderNotice('quick',row,chatId,text))
    const result=await sendMany(notices,row.bot_token,fetcher,shouldContinue);sent+=result.sent;failed+=result.failed
    assertContinuing(shouldContinue)
    await client.query("UPDATE t_energy_quick_order SET is_notice='N' WHERE rid=$1",[row.rid])
    return {sent,failed}
  },shouldContinue,logger,'sendenergytgmessage.quick')
}
async function remainingTrusteeText(pool:Database,row:AiOrder) {
  if(Number(row.max_buy_quantity)>0) return Number(row.max_buy_quantity)-Number(row.total_buy_quantity)+' 次(地址设置最多 <b>'+row.max_buy_quantity+'</b> 次),已使用 <b>'+row.total_buy_quantity+' </b>次'
  const price=Number(row.quantity)===65000?row.trx_price_energy_32000:row.trx_price_energy_65000
  const result=await pool.query<{remaining:string;cash_trx:string}>(
    "SELECT floor(cash_trx/NULLIF($3::numeric,0))::text AS remaining,cash_trx::text AS cash_trx FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1",
    [row.bot_rid,row.tg_uid,price])
  const user=result.rows[0]
  return user?user.remaining+' 次(每次消耗 <b>'+price+'</b> TRX. 余额剩余：<b>'+user.cash_trx+'</b> TRX)':'未知！未查询到用户余额，联系客服！'
}
async function runAiOrders(kind:'trustee'|'bishu',pool:Database,fetcher:typeof fetch,shouldContinue:()=>boolean,logger:Logger) {
  const isTrustee=kind==='trustee',table=isTrustee?'t_energy_ai_trusteeship':'t_energy_ai_bishu'
  const select=isTrustee?trusteeSelect:bishuSelect,lock=isTrustee?trusteeLock:bishuLock
  return processIds<AiOrder>(pool,select,lock,async(row,client)=>{
    if(!row.bot_token) {
      await client.query('UPDATE '+table+" SET is_notice='N',is_notice_admin='N' WHERE rid=$1",[row.rid])
      return {sent:0,failed:0}
    }
    let sent=0,failed=0
    const keyboard=energyKeyboard(row.bot_username,row.bot_admin_username)
    if(row.tg_uid&&row.is_notice==='Y') {
      const remaining=isTrustee?await remainingTrusteeText(pool,row):Number(row.max_buy_quantity)>0
        ?Number(row.max_buy_quantity)-Number(row.total_buy_quantity)+' 次(地址设置最多 <b>'+row.max_buy_quantity+'</b> 次),已使用 <b>'+row.total_buy_quantity+' </b>次':'0 次'
      const mode=isTrustee?'智能托管':'笔数套餐',icon=isTrustee?'🔋':'🖌'
      const title=isTrustee?'新的能量订单成功':'新的笔数能量订单成功'
      const text=icon+'<b>'+title+'</b>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：'+mode+'\n<b>能量数量</b>：'+escapeHtml(row.quantity)+'\n<b>能量地址</b>：'+escapeHtml(shortAddress(row.wallet_addr))+'\n\n<b>能量已经到账！请在时间范围内使用！</b>\n发送 /buyenergy 继续购买能量！\n\n⚠️<u>预计剩余：</u>'+remaining+'\n➖➖➖➖➖➖➖➖'
      const list=ids(row.tg_uid)
      if(isTrustee) list.length=1
      const result=await sendMany(list.map(chatId=>({chatId,text,replyMarkup:keyboard})),row.bot_token,fetcher,shouldContinue)
      sent+=result.sent;failed+=result.failed
      if(row.tg_notice_obj_send) {
        const icon=isTrustee?'🔋':'🖌',title=isTrustee?'新的能量订单成功':'新的笔数能量订单成功',mode=isTrustee?'智能托管':'笔数套餐'
        const groupText=icon+'<b>'+title+'</b>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：'+mode+'\n<b>能量数量</b>：'+escapeHtml(row.quantity)+'\n<b>能量地址</b>：'+escapeHtml(shortAddress(row.wallet_addr))+'\n\n<b>能量已经到账！请在时间范围内使用！</b>\n发送 /buyenergy 继续购买能量！\n➖➖➖➖➖➖➖➖'
        const groupResult=await sendMany(ids(row.tg_notice_obj_send).map(chatId=>({chatId,text:groupText,replyMarkup:keyboard})),row.bot_token,fetcher,shouldContinue)
        sent+=groupResult.sent;failed+=groupResult.failed
        assertContinuing(shouldContinue)
      }
    }
    if(row.tg_admin_uid&&row.is_notice_admin==='Y') {
      const mode=isTrustee?'智能托管':'笔数套餐'
      const text='❌<b>'+mode+'，能量代理失败！</b>\n➖➖➖➖➖➖➖➖\n<b>下单模式</b>：'+mode+'\n<b>能量数量</b>：'+escapeHtml(row.quantity)+'\n<b>能量地址</b>：<code>'+escapeHtml(row.wallet_addr)+'</code>\n<b>失败原因</b>：'+escapeHtml(row.comments)+'\n\n<b>请立即查看管理后台，如需要重新发起，在 能量管理->'+mode+' 刷新该地址即可！</b>\n<b>如果不刷新该地址，后续不会再自动下发！</b>\n➖➖➖➖➖➖➖➖'
      const result=await sendMany(ids(row.tg_admin_uid).map(chatId=>({chatId,text})),row.bot_token,fetcher,shouldContinue)
      sent+=result.sent;failed+=result.failed
      assertContinuing(shouldContinue)
    }
    await client.query('UPDATE '+table+" SET is_notice='N',is_notice_admin='N' WHERE rid=$1",[row.rid])
    return {sent,failed}
  },shouldContinue,logger,'sendenergytgmessage.'+kind)
}
export async function sendEnergyTelegramNotifications(options:{pool?:Database;fetcher?:typeof fetch;logger?:Logger;shouldContinue?:()=>boolean}={}) {
  if(process.env.PLATFORM_TELEGRAM_ACTIONS!=='true') return {skipped:true,scanned:0,sent:0,failed:0}
  const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console,shouldContinue=options.shouldContinue??(()=>true)
  if(!shouldContinue()) return {skipped:true,scanned:0,sent:0,failed:0}
  let scanned=0,sent=0,failed=0
  for(const run of [
    ()=>runEnergyTrades(pool,fetcher,shouldContinue,logger),
    ()=>runQuickOrders(pool,fetcher,shouldContinue,logger),
    ()=>runAiOrders('trustee',pool,fetcher,shouldContinue,logger),
    ()=>runAiOrders('bishu',pool,fetcher,shouldContinue,logger),
  ]) {
    if(!shouldContinue()) break
    const result=await run();scanned+=result.scanned;sent+=result.sent;failed+=result.failed
  }
  return {skipped:false,scanned,sent,failed}
}
