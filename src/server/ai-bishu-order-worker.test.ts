import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { test } from 'node:test'
import { placeBishuCountOrder } from './ai-energy-order-worker.server'
import { syncAiBishuOrders } from './ai-bishu-order-worker.server'

type Row={rid:number;bot_rid:number;tg_uid:string;wallet_addr:string;max_buy_quantity:number;total_buy_quantity:number;total_buy_energy_quantity:number;per_bishu_energy_quantity:number;per_energy_day_bishu:number;is_notice:string;is_notice_admin:string;poll_group:string;energy_platform_bot_rid:number;bot_status:number;is_active:string;is_open_bishu:string;recovery_type:number;dealer_type:number;agent_tg_uid:string|null;agent_per_price:string|null}
const row:Row={rid:11,bot_rid:4,tg_uid:'5101',wallet_addr:'Trecipient',max_buy_quantity:9,total_buy_quantity:3,total_buy_energy_quantity:195000,per_bishu_energy_quantity:65000,per_energy_day_bishu:1,is_notice:'N',is_notice_admin:'N',poll_group:'A',energy_platform_bot_rid:8,bot_status:0,is_active:'Y',is_open_bishu:'Y',recovery_type:1,dealer_type:1,agent_tg_uid:null,agent_per_price:null}
const platform=(name:number,key='ciphertext-fixture')=>({rid:31,platform_name:name,platform_uid:'platform-account',platform_apikey:key,permission_id:9,platform_balance:'90000',seq_sn:10,comments:null})
function rsaFixture(){const pair=generateKeyPairSync('rsa',{modulusLength:2048});const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();const publicPem=pair.publicKey.export({type:'spki',format:'pem'}).toString();const ciphertext='v2:'+publicEncrypt({key:publicPem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from('supplier-secret')).toString('base64');return {privatePem,ciphertext}}
function workerFixture(selected=platform(3),changes:Partial<Row>={}){
  const candidate={...row,...changes},sql:string[]=[],params:unknown[][]=[],requests:Array<{url:string;body:Record<string,unknown>}>=[]
  let claimTaken=false
  const client={query:async(text:string,values:unknown[]=[]):Promise<any>=>{sql.push(text);params.push(values);if(text.startsWith('SELECT a.rid')){if(claimTaken)return {rows:[],rowCount:0};claimTaken=true;return {rows:[candidate],rowCount:1}}if(text.startsWith('SELECT rid FROM t_energy_ai_bishu'))return {rows:[{rid:candidate.rid}],rowCount:1};if(text.startsWith('UPDATE t_telegram_bot_user'))return {rows:[{rid:90}],rowCount:1};return {rows:[],rowCount:1}},release(){}}
  const pool={connect:async()=>client,query:async(text:string,values:unknown[]=[]):Promise<any>=>{sql.push(text);params.push(values);if(text.startsWith('SELECT rid,cash_trx >='))return {rows:[{rid:90,enough:true}],rowCount:1};if(text.startsWith('SELECT rid,platform_name'))return {rows:[selected],rowCount:1};if(text.startsWith('SELECT rid,cash_trx'))return {rows:[{rid:90,cash_trx:'100'}],rowCount:1};return {rows:[],rowCount:1}}} as never
  const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;requests.push({url:String(input),body});return Response.json({code:200,data:{txid:'fixture-txid',use_trx:'1.250000'}})}) as typeof fetch
  return {pool,sql,params,requests,fetcher}
}

test('AI count-package worker does no DB work while gated off',async()=>{
  const result=await syncAiBishuOrders({enabled:false,pool:{query:async()=>{throw new Error('unexpected query')},connect:async()=>{throw new Error('unexpected connect')}} as never})
  assert.deepEqual(result,{skipped:true,scanned:0,succeeded:0,failed:0,manual:0})
})

test('developer supplier preserves the bishuorder batch request and response contract',async()=>{
  const before=process.env.THIRD_URL;process.env.THIRD_URL='https://supplier.example/base'
  let captured:{url:string;body:Record<string,unknown>}|undefined
  try{const result=await placeBishuCountOrder(async(input,init)=>{captured={url:String(input),body:JSON.parse(String(init?.body))};return Response.json({code:200,data:{orderId:'dev-batch-7',orderMoney:0}})},platform(5),'Treceiver',7,'developer',()=>1_800_000_000_000)
    assert.deepEqual(result,{kind:'success',value:{orderId:'dev-batch-7',useTrx:'0'}});assert.equal(captured?.url,'https://supplier.example/api/thirdpart/bishuorder');assert.deepEqual(captured?.body,{tg_uid:'platform-account',maxDelegateNums:7,receiveAddress:'Treceiver'})
  }finally{if(before==null)delete process.env.THIRD_URL;else process.env.THIRD_URL=before}
})

test('TRONgas bulk and Sohu count providers decrypt credentials and send their legacy payloads',async()=>{
  const keys=rsaFixture(),before=process.env.TRON_RSA_PRIVATE_KEY;process.env.TRON_RSA_PRIVATE_KEY=keys.privatePem
  try{
    let captured:{url:string;body:Record<string,unknown>}|undefined
    const trongas=await placeBishuCountOrder(async(input,init)=>{captured={url:String(input),body:JSON.parse(String(init?.body))};return Response.json({code:10000,data:{orderId:'tron-bulk',orderMoney:'0'}})},platform(4,keys.ciphertext),'Treceiver',6,'trongas',()=>1_800_000_000_000)
    assert.equal(trongas.kind,'success');assert.equal(captured?.url,'https://trongas.io/api/auto/add');assert.equal(captured?.body.password,'supplier-secret');assert.equal(captured?.body.maxDelegateNums,6);assert.equal(captured?.body.receiveAddress,'Treceiver')
    const sohu=await placeBishuCountOrder(async(input,init)=>{captured={url:String(input),body:JSON.parse(String(init?.body))};return Response.json({code:1,data:{amount:'0'}})},platform(6,keys.ciphertext),'Treceiver',6,'sohu',()=>1_800_000_000_001)
    assert.equal(sohu.kind,'success');assert.equal(captured?.url,'https://admin.weidubot.cc/api/trc_api/delegate_energy_times');assert.deepEqual(captured?.body,{token:'supplier-secret',times:6,address:'Treceiver'})
  }finally{if(before==null)delete process.env.TRON_RSA_PRIVATE_KEY;else process.env.TRON_RSA_PRIVATE_KEY=before}
})

test('own-pledge count package writes source_type 4 order and increments energy counts atomically',async()=>{
  const before={env:process.env.APP_ENV,url:process.env.TRON_SIGNER_URL,token:process.env.TRON_SIGNER_TOKEN};Object.assign(process.env,{APP_ENV:'development',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789'})
  const f=workerFixture(platform(3))
  try{const result=await syncAiBishuOrders({pool:f.pool,enabled:true,batchSize:1,fetcher:f.fetcher,logger:{error(){}}});assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0});assert.equal(f.requests[0].url,'http://signer.test/api/internal/tron/sign');assert.equal(f.requests[0].body.operation,'delegate_resource');assert.ok(f.sql.some(sql=>sql.includes('source_type,recovery_status,use_trx')));assert.ok(f.sql.some(sql=>sql.includes('total_buy_energy_quantity=total_buy_energy_quantity+CASE')));assert.ok(f.sql.includes('COMMIT'))}
  finally{for(const [key,value]of Object.entries({APP_ENV:before.env,TRON_SIGNER_URL:before.url,TRON_SIGNER_TOKEN:before.token})){if(value==null)delete process.env[key];else process.env[key]=value}}
})

test('Sohu batch mode charges the remaining agent allowance once and does not create a per-order ledger row',async()=>{
  const keys=rsaFixture(),before=process.env.TRON_RSA_PRIVATE_KEY;process.env.TRON_RSA_PRIVATE_KEY=keys.privatePem
  const f=workerFixture(platform(6,keys.ciphertext),{dealer_type:3,max_buy_quantity:9,total_buy_quantity:3,agent_tg_uid:'777',agent_per_price:'0.2'})
  try{const result=await syncAiBishuOrders({pool:f.pool,enabled:true,batchSize:1,fetcher:async(input,init)=>{f.requests.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json({code:1,data:{amount:'0'}})},logger:{error(){}}});assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0});assert.equal(f.requests[0].body.times,6);assert.equal(f.params.some(values=>values[2]==='1.2'),true);assert.equal(f.sql.some(sql=>sql.startsWith('INSERT INTO t_energy_platform_order')),false);assert.ok(f.sql.some(sql=>sql.includes('total_buy_quantity=CASE WHEN $6 THEN max_buy_quantity')))}
  finally{if(before==null)delete process.env.TRON_RSA_PRIVATE_KEY;else process.env.TRON_RSA_PRIVATE_KEY=before}
})

test('ambiguous AI count supplier outcome is held for manual review and cannot retry',async()=>{
  const f=workerFixture(platform(5),{agent_tg_uid:null})
  const before=process.env.THIRD_URL;process.env.THIRD_URL='https://supplier.example'
  try{const result=await syncAiBishuOrders({pool:f.pool,enabled:true,batchSize:1,fetcher:async()=>{throw new Error('timeout')},logger:{error(){}}});assert.deepEqual(result,{skipped:false,scanned:1,succeeded:0,failed:0,manual:1});const failed=f.params.find(values=>values[0]===row.rid&&values[1]==='N');assert.ok(failed);assert.equal(String(failed[2]).includes('禁止自动重试'),true);assert.equal(f.sql.some(sql=>sql.startsWith('INSERT INTO t_energy_platform_order')),false)}
  finally{if(before==null)delete process.env.THIRD_URL;else process.env.THIRD_URL=before}
})
