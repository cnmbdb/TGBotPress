import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { syncAiBishuOrders } from './ai-bishu-order-worker.server'

const connectionString=process.env.PLATFORM_TEST_DATABASE_URL

test('AI count-package modes claim real PostgreSQL rows and persist orders, notices and exact agent accounting', {skip:!connectionString}, async()=>{
  const url=new URL(connectionString!)
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'integration DB must be loopback-only')
  const schema='ai_bishu_'+randomUUID().replaceAll('-','')
  const admin=new Pool({connectionString,max:2}),pool=new Pool({connectionString,options:'-c search_path='+schema,max:3})
  const previous={app:process.env.APP_ENV,url:process.env.TRON_SIGNER_URL,token:process.env.TRON_SIGNER_TOKEN,key:process.env.TRON_RSA_PRIVATE_KEY}
  const pair=generateKeyPairSync('rsa',{modulusLength:2048})
  const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()
  const publicPem=pair.publicKey.export({type:'spki',format:'pem'}).toString()
  const ciphertext='v2:'+publicEncrypt({key:publicPem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from('supplier-secret')).toString('base64')
  const requests:Array<{url:string;body:Record<string,unknown>}>=[]
  try{
    await admin.query('CREATE SCHEMA '+schema)
    for(const table of ['t_energy_ai_bishu','t_energy_platform_bot','t_energy_platform','t_energy_platform_order','t_telegram_bot_user'])await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
    await pool.query("INSERT INTO t_energy_platform_bot(rid,bot_rid,poll_group,status,is_open_bishu,per_bishu_energy_quantity,per_energy_day_bishu,bishu_daili_type,create_time) VALUES(50001,50001,'A',0,'Y',65000,1,1,now()),(50002,50002,'A',0,'Y',65000,1,3,now())")
    await pool.query("INSERT INTO t_energy_platform(rid,poll_group,platform_name,status,platform_uid,platform_balance,platform_apikey,seq_sn,create_time) VALUES(50101,'A',3,0,'stake-account',90000,'signer-cipher',1,now()),(50102,'A',6,0,'sohu-account',90000,$1,1,now())",[ciphertext])
    await pool.query("INSERT INTO t_energy_ai_bishu(rid,bot_rid,tg_uid,wallet_addr,status,is_buy,is_notice,is_notice_admin,max_buy_quantity,total_buy_quantity,total_buy_energy_quantity,create_by,create_time,is_active) VALUES(50201,50001,'5101','Trecipient-one',0,'Y','N','N',5,0,0,1,now(),'Y'),(50202,50002,'5102','Trecipient-two',0,'Y','N','N',9,3,0,1,now(),'Y')")
    await pool.query("INSERT INTO t_telegram_bot_user(rid,bot_rid,tg_uid,cash_trx) VALUES(50301,50002,777,10)")
    await pool.query("UPDATE t_energy_platform_bot SET agent_tg_uid=777,agent_per_price=0.2 WHERE rid=50002")
    Object.assign(process.env,{APP_ENV:'development',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789',TRON_RSA_PRIVATE_KEY:privatePem})
    const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;requests.push({url:String(input),body});return String(input).includes('signer.test')?Response.json({code:200,data:{txid:'stake-tx',use_trx:'2.125000'}}):Response.json({code:1,data:{amount:'0'}})}) as typeof fetch
    const first=await syncAiBishuOrders({pool,enabled:true,batchSize:1,fetcher,logger:{error(){}}})
    assert.deepEqual(first,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0})
    const standard=await pool.query("SELECT is_buy,is_notice,total_buy_quantity,total_buy_energy_quantity FROM t_energy_ai_bishu WHERE rid=50201")
    assert.deepEqual(standard.rows[0],{is_buy:'N',is_notice:'Y',total_buy_quantity:1,total_buy_energy_quantity:'65000'})
    const ledger=await pool.query("SELECT platform_order_id,source_type,recovery_status,use_trx::text FROM t_energy_platform_order WHERE energy_platform_bot_rid=50001")
    assert.deepEqual(ledger.rows[0],{platform_order_id:'stake-tx',source_type:4,recovery_status:2,use_trx:'2.125000'})
    const second=await syncAiBishuOrders({pool,enabled:true,batchSize:1,fetcher,logger:{error(){}}})
    assert.deepEqual(second,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0})
    assert.deepEqual(requests.find(request=>request.url==='https://admin.weidubot.cc/api/trc_api/delegate_energy_times'),{url:'https://admin.weidubot.cc/api/trc_api/delegate_energy_times',body:{token:'supplier-secret',times:6,address:'Trecipient-two'}})
    const bulk=await pool.query("SELECT is_buy,total_buy_quantity,total_buy_energy_quantity,energy_platform_rid FROM t_energy_ai_bishu WHERE rid=50202")
    assert.deepEqual(bulk.rows[0],{is_buy:'N',total_buy_quantity:9,total_buy_energy_quantity:'0',energy_platform_rid:50102})
    const agent=await pool.query('SELECT cash_trx::text FROM t_telegram_bot_user WHERE rid=50301')
    assert.equal(Number(agent.rows[0].cash_trx),8.8)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM t_energy_platform_order WHERE energy_platform_bot_rid=50002')).rows[0].n,0)
  }finally{
    for(const [key,value] of Object.entries({APP_ENV:previous.app,TRON_SIGNER_URL:previous.url,TRON_SIGNER_TOKEN:previous.token,TRON_RSA_PRIVATE_KEY:previous.key})){if(value==null)delete process.env[key];else process.env[key]=value}
    await pool.end()
    await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>undefined)
    await admin.end()
  }
})
