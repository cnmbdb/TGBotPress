import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { refreshAiEnergyWalletResources } from './ai-energy-wallet-resource.server'
const url=process.env.PLATFORM_TEST_DATABASE_URL
test('updates trusteeship and bishu rows only in a disposable schema with fake providers',{skip:!url},async()=>{
 const admin=new pg.Pool({connectionString:url,max:2}),schema='ai_energy_resource_'+randomUUID().replaceAll('-','')
 await admin.query('CREATE SCHEMA "'+schema+'"')
 const pool=new pg.Pool({connectionString:url,max:2,options:'-c search_path='+schema})
 try{
  const ddl=[
   'CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text)',
   'CREATE TABLE t_energy_platform_bot(bot_rid integer PRIMARY KEY,is_open_ai_trusteeship char(1),trx_price_energy_32000 integer,is_open_bishu char(1),per_bishu_energy_quantity integer)',
   'CREATE TABLE telegram_bot_user(bot_rid integer,tg_uid bigint,cash_trx numeric)',
   'CREATE TABLE t_energy_ai_trusteeship(rid integer PRIMARY KEY,bot_rid integer,tg_uid bigint,status smallint,wallet_addr varchar(64),min_energy_quantity integer,is_buy char(1),max_buy_quantity integer,total_buy_quantity integer,current_bandwidth_quantity bigint,current_energy_quantity bigint)',
   'CREATE TABLE t_energy_ai_bishu(rid integer PRIMARY KEY,bot_rid integer,status smallint,wallet_addr varchar(64),is_buy char(1),max_buy_quantity integer,total_buy_quantity integer,current_bandwidth_quantity bigint,current_energy_quantity bigint)',
   "INSERT INTO t_telegram_bot VALUES(3,'fake')",
   "INSERT INTO t_energy_platform_bot VALUES(3,'Y',50,'Y',131000)",
   'INSERT INTO telegram_bot_user VALUES(3,12345,100)',
   "INSERT INTO t_energy_ai_trusteeship VALUES(7,3,12345,0,'T'||repeat('A',33),50000,'N',0,0,0,0)",
   "INSERT INTO t_energy_ai_bishu VALUES(8,3,0,'T'||repeat('B',33),'N',2,0,0,0)"
  ].join(';')
  await pool.query(ddl)
  const provider=async()=>Response.json({activated:true,bandwidth:{freeNetRemaining:40,netRemaining:60,energyRemaining:0}})
  const off=await refreshAiEnergyWalletResources({pool,enabled:true,delayMs:0,fetcher:provider})
  assert.deepEqual(off,{checked:2,updated:2,failed:0,skipped:0})
  assert.deepEqual((await pool.query('SELECT is_buy,current_bandwidth_quantity,current_energy_quantity FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0],{is_buy:'N',current_bandwidth_quantity:'100',current_energy_quantity:'0'})
  assert.deepEqual((await pool.query('SELECT is_buy,current_bandwidth_quantity,current_energy_quantity FROM t_energy_ai_bishu WHERE rid=8')).rows[0],{is_buy:'N',current_bandwidth_quantity:'100',current_energy_quantity:'0'})
  const on=await refreshAiEnergyWalletResources({pool,enabled:true,allowPurchaseTrigger:true,delayMs:0,fetcher:provider})
  assert.equal(on.updated,2)
  assert.equal((await pool.query('SELECT is_buy FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0].is_buy,'Y')
  assert.equal((await pool.query('SELECT is_buy FROM t_energy_ai_bishu WHERE rid=8')).rows[0].is_buy,'Y')
 }finally{await pool.end();await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end()}
})
