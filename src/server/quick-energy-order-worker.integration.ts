import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { syncQuickEnergyOrders } from './quick-energy-order-worker.server'

const connectionString=process.env.PLATFORM_TEST_DATABASE_URL

test('quick-energy supplier success is claimed and committed to the real PostgreSQL ledger exactly once',{skip:!connectionString},async()=>{
  const url=new URL(connectionString!)
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'integration DB must be loopback-only')
  const schema='quick_energy_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString,max:2}),pool=new Pool({connectionString,options:'-c search_path='+schema,max:3})
  const previous={app:process.env.APP_ENV,url:process.env.TRON_SIGNER_URL,token:process.env.TRON_SIGNER_TOKEN}
  try{
    await admin.query('CREATE SCHEMA '+schema)
    for(const table of ['t_energy_quick_order','t_energy_platform_bot','t_energy_platform','t_energy_platform_order'])await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
    await pool.query("INSERT INTO t_energy_platform_bot(rid,bot_rid,poll_group,status,is_open_bishu,create_time) VALUES(52001,52001,'A',0,'Y',now())")
    await pool.query("INSERT INTO t_energy_platform(rid,poll_group,platform_name,status,platform_uid,platform_balance,platform_apikey,seq_sn,create_time) VALUES(52101,'A',3,0,'stake-account',90000,'signer-cipher',1,now())")
    await pool.query("INSERT INTO t_energy_quick_order(rid,bot_rid,tg_uid,wallet_addr,status,is_notice,energy_amount,energy_day,create_time) VALUES(52201,52001,'5201','Tquick-recipient',1,'N',65000,0,now())")
    Object.assign(process.env,{APP_ENV:'development',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'test-token-012345678901234567890123456789'})
    const result=await syncQuickEnergyOrders({pool,enabled:true,batchSize:2,fetcher:async(input,init)=>{assert.equal(String(input),'http://signer.test/api/internal/tron/sign');assert.equal(JSON.parse(String(init?.body)).operation,'delegate_resource');return Response.json({code:200,data:{txid:'quick-tx',use_trx:'0.750000'}})},logger:{error(){}}})
    assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0,manual:0})
    assert.deepEqual((await pool.query('SELECT status,is_notice,comments FROM t_energy_quick_order WHERE rid=52201')).rows[0],{status:9,is_notice:'Y',comments:'SUCCESS'})
    assert.deepEqual((await pool.query('SELECT platform_order_id,source_type,recovery_status,use_trx::text FROM t_energy_platform_order')).rows[0],{platform_order_id:'quick-tx',source_type:2,recovery_status:2,use_trx:'0.750000'})
    const retry=await syncQuickEnergyOrders({pool,enabled:true,batchSize:1,fetcher:async()=>{throw new Error('completed quick order must not be submitted twice')},logger:{error(){}}})
    assert.deepEqual(retry,{skipped:false,scanned:0,succeeded:0,failed:0,manual:0})
  }finally{
    for(const [key,value] of Object.entries({APP_ENV:previous.app,TRON_SIGNER_URL:previous.url,TRON_SIGNER_TOKEN:previous.token})){if(value==null)delete process.env[key];else process.env[key]=value}
    await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>undefined);await admin.end()
  }
})
