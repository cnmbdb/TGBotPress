import {test} from 'node:test'
import assert from 'node:assert/strict'
import {planTransitNotices,sendTransitTelegramNotifications} from './send-transit-telegram.server'
const row=(overrides:Record<string,unknown>={})=>({
 rid:1,tx_hash:'tx<&',transferfrom_address:'T123456789abcdefghijk',coin_name:'USDT',amount:'10',process_status:9,
 tg_notice_status_receive:'N',tg_notice_status_send:'N',sendback_amount:'50',tg_notice_obj_receive:'-1001,1002',
 tg_notice_obj_send:'-1003',bot_token:'fixture-token',receive_wallet:'Twallet',current_huan_yuzhi_amount:'2.5',
 sendback_time:'2026-01-01 12:00:00',bot_admin_username:'@admin',...overrides
})
test('plans legacy receive and successful exchange notifications',()=>{
 const plan=planTransitNotices(row() as never)
 assert.equal(plan.receiveDone,true);assert.equal(plan.sendDone,true);assert.equal(plan.notices.length,3)
 assert.deepEqual(plan.notices.map(n=>n.chatId),['-1001','1002','-1003'])
 assert.match(plan.notices[0].text,/tx&lt;&amp;/)
 assert.equal((plan.notices[2].replyMarkup as any).inline_keyboard[0][0].url,'https://t.me/admin')
})
test('keeps pending statuses and completes terminal or missing-recipient rows',()=>{
 const pending=planTransitNotices(row({process_status:0}) as never)
 assert.equal(pending.receiveDone,false);assert.equal(pending.sendDone,false);assert.equal(pending.notices.length,0)
 const terminal=planTransitNotices(row({process_status:2}) as never)
 assert.equal(terminal.receiveDone,true);assert.equal(terminal.sendDone,true)
 const empty=planTransitNotices(row({tg_notice_obj_receive:'',tg_notice_obj_send:null}) as never)
 assert.equal(empty.receiveDone,true);assert.equal(empty.sendDone,true)
})
test('missing token completes legacy notification flags',()=>{
 const plan=planTransitNotices(row({bot_token:null}) as never)
 assert.equal(plan.receiveDone,true);assert.equal(plan.sendDone,true);assert.equal(plan.notices.length,0)
})
test('routes due messages through injected Telegram transport',async()=>{
 const previous=process.env.PLATFORM_TELEGRAM_ACTIONS,calls:any[]=[],updates:any[]=[]
 const client={query:async(sql:string,values?:unknown[])=>{
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[],rowCount:0}
  if(sql.includes('FOR UPDATE OF a SKIP LOCKED')) return {rows:[row()],rowCount:1}
  if(sql.includes('UPDATE t_transit_wallet_trade_list')){updates.push(values);return {rows:[],rowCount:1}}
  throw Error('unexpected query')
 },release(){}}
 process.env.PLATFORM_TELEGRAM_ACTIONS='true'
 try {
  const result=await sendTransitTelegramNotifications({
   pool:{query:async()=>({rows:[{rid:1}],rowCount:1}),connect:async()=>client} as never,
   logger:{info(){},error(){}},
   fetcher:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});return Response.json({ok:true})}
  })
  assert.deepEqual(result,{skipped:false,scanned:1,sent:3,failed:0})
  assert.equal(calls.length,3);assert.ok(calls.every(x=>x.url==='https://api.telegram.org/botfixture-token/sendMessage'))
  assert.deepEqual(updates[0].slice(1),['Y','Y'])
 } finally {if(previous==null) delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=previous}
})
test('development default performs no database or Telegram work',async()=>{
 const previous=process.env.PLATFORM_TELEGRAM_ACTIONS;delete process.env.PLATFORM_TELEGRAM_ACTIONS
 let queries=0
 try {
  const result=await sendTransitTelegramNotifications({
   pool:{query:async()=>{queries++;throw Error('unexpected')},connect:async()=>{throw Error('unexpected')}} as never,
   fetcher:async()=>{throw Error('unexpected')}
  })
  assert.deepEqual(result,{skipped:true,scanned:0,sent:0,failed:0});assert.equal(queries,0)
 } finally {if(previous!=null) process.env.PLATFORM_TELEGRAM_ACTIONS=previous}
})
