import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { sendEnergyTelegramNotifications } from './send-energy-telegram.server'

const databaseUrl = process.env.ENERGY_TEST_DATABASE_URL
test('energy Telegram worker drains all four legacy queues against isolated PostgreSQL', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'fixture database must be loopback-only')
  assert.equal(url.pathname, '/energy_test', 'fixture database name must be energy_test')
  const pool = new Pool({ connectionString: databaseUrl, max: 4 })
  const original = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  const calls: Array<{ chatId: string; text: string }> = []
  try {
    await pool.query(`
      DROP VIEW IF EXISTS energy_platform_package;
      DROP TABLE IF EXISTS t_energy_wallet_trade_list,t_energy_quick_order,t_energy_ai_trusteeship,
        t_energy_ai_bishu,t_telegram_bot_user,t_energy_platform_package,t_energy_platform_bot,t_telegram_bot CASCADE;
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text,bot_admin_username text,bot_username text);
      CREATE TABLE t_energy_platform_bot(
        rid integer PRIMARY KEY,bot_rid integer,tg_notice_obj_receive text,tg_notice_obj_send text,tg_admin_uid text,
        receive_wallet text,per_bishu_energy_quantity integer,trx_price_energy_32000 integer,trx_price_energy_65000 integer
      );
      CREATE TABLE t_energy_platform_package(rid integer PRIMARY KEY,energy_amount integer,package_name text);
      CREATE VIEW energy_platform_package AS SELECT * FROM t_energy_platform_package;
      CREATE TABLE t_energy_wallet_trade_list(
        rid integer PRIMARY KEY,tx_hash text,transferfrom_address text,transferto_address text,coin_name text,amount text,
        process_status smallint,process_comments text,tg_notice_status_receive char(1),tg_notice_status_send char(1),
        energy_platform_bot_rid integer,energy_package_rid integer
      );
      CREATE TABLE t_energy_quick_order(rid integer PRIMARY KEY,bot_rid integer,tg_uid text,wallet_addr text,
        energy_amount integer,is_notice char(1),comments text);
      CREATE TABLE t_energy_ai_trusteeship(rid integer PRIMARY KEY,bot_rid integer,tg_uid bigint,wallet_addr text,
        per_buy_energy_quantity integer,is_notice char(1),is_notice_admin char(1),comments text,max_buy_quantity integer,
        total_buy_quantity integer);
      CREATE TABLE t_energy_ai_bishu(rid integer PRIMARY KEY,bot_rid integer,tg_uid text,wallet_addr text,
        is_notice char(1),is_notice_admin char(1),comments text,max_buy_quantity integer,total_buy_quantity integer);
      CREATE TABLE t_telegram_bot_user(bot_rid integer,tg_uid bigint,cash_trx numeric(20,6));
      INSERT INTO t_telegram_bot VALUES(7,'fixture-token','@support','@energy_bot');
      INSERT INTO t_energy_platform_bot VALUES(70,7,'-101,102','-103','-104','Tenergy',65000,2,5);
      INSERT INTO t_energy_platform_package VALUES(9,65000,'65K Energy');
      INSERT INTO t_energy_wallet_trade_list VALUES(1,'energy-hash','Tsender','Tenergy','TRX','5',9,NULL,'N','N',70,9);
      INSERT INTO t_energy_quick_order VALUES(2,7,'201','Tquick',32000,'Y','paid');
      INSERT INTO t_energy_ai_trusteeship VALUES(3,7,301,'Ttrust',32000,'Y','Y','provider failed',0,0);
      INSERT INTO t_energy_ai_bishu VALUES(4,7,'401,402','Tbishu','Y','Y','package failed',10,3);
      INSERT INTO t_telegram_bot_user VALUES(7,301,12.5);
    `)
    const previousFetch = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: string | number; text: string }
      calls.push({ chatId: String(body.chat_id), text: body.text })
      return Response.json({ ok: true })
    }) as typeof fetch
    try {
      const result = await sendEnergyTelegramNotifications({ pool, logger: { info() {}, error() {} } })
      assert.deepEqual(result, { skipped: false, scanned: 4, sent: 12, failed: 0 })
      assert.deepEqual(calls.map(call => call.chatId), ['-101','102','-103','201','-103','301','-103','-104','401','402','-103','-104'])
      assert.match(calls.find(call => call.chatId === '301')!.text, /剩余：<\/u>2 次/)
      const flags = await pool.query('SELECT tg_notice_status_receive,tg_notice_status_send FROM t_energy_wallet_trade_list WHERE rid=1')
      assert.deepEqual(flags.rows[0], { tg_notice_status_receive: 'Y', tg_notice_status_send: 'Y' })
      const queued = await pool.query('SELECT is_notice FROM t_energy_quick_order WHERE rid=2')
      assert.equal(queued.rows[0].is_notice, 'N')
      const aiFlags = await pool.query('SELECT is_notice,is_notice_admin FROM t_energy_ai_trusteeship WHERE rid=3')
      assert.deepEqual(aiFlags.rows[0], { is_notice: 'N', is_notice_admin: 'N' })
      const bishuFlags = await pool.query('SELECT is_notice,is_notice_admin FROM t_energy_ai_bishu WHERE rid=4')
      assert.deepEqual(bishuFlags.rows[0], { is_notice: 'N', is_notice_admin: 'N' })
    } finally {
      globalThis.fetch = previousFetch
    }
  } finally {
    if (original == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = original
    await pool.end()
  }
})
