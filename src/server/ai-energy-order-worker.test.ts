import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { test } from 'node:test'
import { syncAiEnergyOrders } from './ai-energy-order-worker.server'
import { platformScheduledTasks } from './platform-worker.server'

const row = {
  rid:21,bot_rid:4,tg_uid:'5101',wallet_addr:'Trecipient',energy_amount:65000,energy_day:1,
  trx_price_energy_32000:6,trx_price_energy_65000:12,is_notice:'N',is_notice_admin:'N',
  total_buy_energy_quantity:0,total_used_trx:'0',total_buy_quantity:0,poll_group:'A',
  energy_platform_bot_rid:8,agent_tg_uid:null,agent_per_price:null,recovery_type:'1',
}
const platform = (name:number, key='ciphertext-fixture') => ({
  rid:31,platform_name:name,platform_uid:'platform-account',platform_apikey:key,
  permission_id:9,platform_balance:'90000',seq_sn:10,
})
function fixture(selectedPlatform=platform(3)) {
  const sql:string[]=[],params:unknown[][]=[],requests:{url:string;body:Record<string,unknown>}[]=[]
  let claimTaken=false
  const client={query:async(text:string,values:unknown[]=[])=>{
    sql.push(text);params.push(values)
    if(text.startsWith('SELECT a.rid')) {
      if(claimTaken)return {rows:[],rowCount:0}
      claimTaken=true;return {rows:[row],rowCount:1}
    }
    if(text.startsWith("SELECT rid FROM t_energy_ai_trusteeship"))return {rows:[{rid:row.rid}],rowCount:1}
    if(text.startsWith('UPDATE t_telegram_bot_user'))return {rows:[{rid:90}],rowCount:1}
    return {rows:[],rowCount:1}
  },release(){}}
  const pool={connect:async()=>client,query:async(text:string,values:unknown[]=[])=>{
    sql.push(text);params.push(values)
    if(text.startsWith('SELECT rid,cash_trx'))return {rows:[{rid:90,cash_trx:'100'}],rowCount:1}
    if(text.startsWith('SELECT rid,platform_name'))return {rows:[selectedPlatform],rowCount:1}
    if(text.startsWith('UPDATE t_energy_ai_trusteeship'))return {rows:[],rowCount:1}
    return {rows:[],rowCount:1}
  }} as never
  return {pool,sql,params,requests,fetcher:(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>
    requests.push({url,body})
    return Response.json({code:200,data:{txid:'fixture-txid',use_trx:'6.500000'}})
  }) as typeof fetch}
}

test('AI energy order task is scheduled at the legacy interval and disabled by default',async()=>{
  const before=process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS='false'
  const pool={query:async()=>{throw new Error('disabled task must not query')},connect:async()=>{throw new Error('disabled task must not connect')}} as never
  try{
    const task=platformScheduledTasks(pool).find(item=>item.name==='handleaienergyorder')
    assert.ok(task);assert.equal(task.intervalMs,3000)
    assert.deepEqual(await task.run(()=>true),{skipped:true,scanned:0,succeeded:0,failed:0,manual:0})
    assert.deepEqual(await syncAiEnergyOrders({pool}),{skipped:true,scanned:0,succeeded:0,failed:0,manual:0})
  }finally{if(before==null)delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS;else process.env.PLATFORM_ENERGY_ORDER_ACTIONS=before}
})

test('own-pledge purchase sends encrypted key only and commits the order and user debit together',async()=>{
  const before={env:process.env.APP_ENV,url:process.env.TRON_SIGNER_URL,token:process.env.TRON_SIGNER_TOKEN}
  Object.assign(process.env,{APP_ENV:'development',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789'})
  const f=fixture()
  try{
    const result=await syncAiEnergyOrders({pool:f.pool,enabled:true,batchSize:1,now:()=>1_800_000_000_000,fetcher:f.fetcher,logger:{error(){}}})
    assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0})
    assert.equal(f.requests.length,1)
    assert.equal(f.requests[0].url,'http://signer.test/api/internal/tron/sign')
    assert.equal(f.requests[0].body.operation,'delegate_resource')
    assert.equal(f.requests[0].body.private_key_ciphertext,'ciphertext-fixture')
    assert.equal('private_key' in f.requests[0].body,false)
    assert.ok(f.sql.some(sql=>sql.startsWith('INSERT INTO t_energy_platform_order')))
    assert.ok(f.sql.some(sql=>sql.startsWith('UPDATE t_telegram_bot_user')))
    assert.ok(f.sql.includes('COMMIT'))
  }finally{for(const [key,value]of Object.entries({APP_ENV:before.env,TRON_SIGNER_URL:before.url,TRON_SIGNER_TOKEN:before.token})){if(value==null)delete process.env[key];else process.env[key]=value}}
})

test('ambiguous supplier failure disables retry and schedules admin review',async()=>{
  const before={env:process.env.APP_ENV,url:process.env.TRON_SIGNER_URL,token:process.env.TRON_SIGNER_TOKEN}
  Object.assign(process.env,{APP_ENV:'development',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789'})
  const f=fixture()
  try{
    const result=await syncAiEnergyOrders({pool:f.pool,enabled:true,batchSize:1,fetcher:async()=>{throw new Error('timeout')},logger:{error(){}}})
    assert.deepEqual(result,{skipped:false,scanned:1,succeeded:0,failed:0,manual:1})
    const failed=f.params.find(values=>values[0]===row.rid&&values[1]==='N')
    assert.ok(failed);assert.equal(failed[3],true)
    assert.equal(f.sql.some(sql=>sql.startsWith('INSERT INTO t_energy_platform_order')),false)
  }finally{for(const [key,value]of Object.entries({APP_ENV:before.env,TRON_SIGNER_URL:before.url,TRON_SIGNER_TOKEN:before.token})){if(value==null)delete process.env[key];else process.env[key]=value}}
})

test('encrypted wallet buzz credentials are decrypted only at request time',async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:2048})
  const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()
  const publicPem=pair.publicKey.export({type:'spki',format:'pem'}).toString()
  const ciphertext='v2:'+publicEncrypt({key:publicPem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from('supplier-secret')).toString('base64')
  const before=process.env.TRON_RSA_PRIVATE_KEY
  process.env.TRON_RSA_PRIVATE_KEY=privatePem
  const f=fixture(platform(2,ciphertext))
  try{
    const result=await syncAiEnergyOrders({pool:f.pool,enabled:true,batchSize:1,fetcher:async(input)=>{
      const url=new URL(String(input))
      assert.equal(url.hostname,'api.wallet.buzz');assert.equal(url.searchParams.get('apikey'),'supplier-secret')
      assert.equal(url.searchParams.get('amount'),'65000');assert.equal(url.searchParams.get('type'),'day')
      return Response.json({status:'success',txid:'buzz-order'})
    },logger:{error(){}}})
    assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0})
    assert.ok(f.sql.some(sql=>sql.startsWith('INSERT INTO t_energy_platform_order')))
  }finally{if(before==null)delete process.env.TRON_RSA_PRIVATE_KEY;else process.env.TRON_RSA_PRIVATE_KEY=before}
})
