import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { syncEnergyOrder } from './energy-order-worker.server'

test('USDT credit is atomic and idempotent against PostgreSQL', async () => {
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL})
  try {
    await pool.query(`CREATE TABLE t_energy_platform_bot(rid integer PRIMARY KEY,bot_rid integer,receive_wallet text,per_bishu_usdt_price numeric,bishu_stop_day integer);
      CREATE TABLE t_energy_wallet_trade_list(rid integer PRIMARY KEY,transferfrom_address text,transferto_address text,coin_name text,amount numeric,process_status integer,process_comments text,process_time timestamp,energy_platform_bot_rid integer,tg_notice_status_send char(1));
      CREATE TABLE t_energy_ai_bishu(rid serial PRIMARY KEY,bot_rid integer,tg_uid text,wallet_addr text,status integer,total_buy_usdt numeric,max_buy_quantity integer,total_buy_quantity integer DEFAULT 0,create_by integer,create_time timestamp,is_buy char(1),bishu_stop_day integer,is_active char(1),update_time timestamp);
      INSERT INTO t_energy_platform_bot VALUES(42,7,'receiver',0.50,5);
      INSERT INTO t_energy_wallet_trade_list VALUES(51,'buyer','receiver','usdt',2.79,1,NULL,NULL,NULL,'Y')`)
    assert.deepEqual(await syncEnergyOrder({pool,enabled:true,batchSize:1}),{skipped:false,scanned:1,succeeded:1,failed:0})
    const trade=(await pool.query('SELECT process_status,process_comments,energy_platform_bot_rid,tg_notice_status_send FROM t_energy_wallet_trade_list')).rows[0]
    assert.deepEqual(trade,{process_status:9,process_comments:'成功,笔数套餐增加：5',energy_platform_bot_rid:42,tg_notice_status_send:'N'})
    const wallet=(await pool.query('SELECT max_buy_quantity,total_buy_usdt::text,is_buy FROM t_energy_ai_bishu')).rows[0]
    assert.deepEqual(wallet,{max_buy_quantity:5,total_buy_usdt:'2.79',is_buy:'Y'})
    assert.equal((await syncEnergyOrder({pool,enabled:true,batchSize:1})).scanned,0)
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM t_energy_ai_bishu')).rows[0].n),1)
  } finally { await pool.end() }
})
