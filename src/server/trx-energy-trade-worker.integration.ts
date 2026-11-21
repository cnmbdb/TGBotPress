import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { syncTrxEnergyTrades } from './trx-energy-trade-worker.server'

const connectionString = process.env.PLATFORM_INTEGRATION_DATABASE_URL
const schema = 'trx_energy_trade_' + randomUUID().replaceAll('-', '')

test('TRX-paid rental persists provider order, charges agent atomically, and does not replay completed trades', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'integration database must be local')
  const admin = new pg.Pool({ connectionString, max: 2 })
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema, max: 2 })
  const previous = { appEnv: process.env.APP_ENV, signerUrl: process.env.TRON_SIGNER_URL, signerToken: process.env.TRON_SIGNER_TOKEN }
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    await pool.query(`
      CREATE TABLE t_energy_platform_bot(rid integer PRIMARY KEY,bot_rid integer,receive_wallet text,status integer,poll_group text,agent_tg_uid text);
      CREATE TABLE t_energy_wallet_trade_list(rid integer PRIMARY KEY,transferfrom_address text,transferto_address text,coin_name text,amount numeric,process_status integer,process_comments text,process_time timestamp,energy_platform_bot_rid integer,platform_order_rid integer,energy_platform_rid integer,energy_package_rid integer,tg_notice_status_send char(1));
      CREATE TABLE t_energy_platform_package(rid integer PRIMARY KEY,bot_rid integer,trx_price numeric,energy_amount integer,energy_day integer,agent_trx_price numeric);
      CREATE TABLE t_telegram_bot_user(rid integer PRIMARY KEY,bot_rid integer,tg_uid text,cash_trx numeric);
      CREATE TABLE t_energy_platform(rid integer PRIMARY KEY,platform_name integer,platform_uid text,platform_apikey text,permission_id integer,platform_balance numeric,seq_sn integer,poll_group text,status integer,comments text);
      CREATE TABLE t_energy_platform_order(rid serial PRIMARY KEY,energy_platform_rid integer,energy_platform_bot_rid integer,platform_name integer,platform_uid text,receive_address text,platform_order_id text,energy_amount integer,energy_day integer,energy_time timestamp,source_type integer,recovery_status integer,use_trx numeric);
      INSERT INTO t_energy_platform_bot VALUES(42,7,'receiver',0,'pool-a','agent-1');
      INSERT INTO t_energy_wallet_trade_list VALUES(51,'buyer-wallet','receiver','trx',12,1,NULL,NULL,NULL,NULL,NULL,NULL,'Y');
      INSERT INTO t_energy_platform_package VALUES(8,7,12,65000,1,3.5);
      INSERT INTO t_telegram_bot_user VALUES(9,7,'agent-1',10);
      INSERT INTO t_energy_platform VALUES(4,3,'pool-wallet','ciphertext-only-test',0,100000,1,'pool-a',0,NULL)
    `)
    process.env.APP_ENV = 'local'
    process.env.TRON_SIGNER_URL = 'https://signer.test'
    process.env.TRON_SIGNER_TOKEN = '0123456789abcdef0123456789abcdef'
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(String(input), 'https://signer.test/api/internal/tron/sign')
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer ' + process.env.TRON_SIGNER_TOKEN)
      return Response.json({ code: 200, data: { txid: 'isolated-signer-order', use_trx: '0.75' } })
    }
    const first = await syncTrxEnergyTrades({ pool, enabled: true, batchSize: 2, fetcher, logger: { error() {} } })
    assert.deepEqual(first, { skipped: false, scanned: 1, succeeded: 1, failed: 0, manual: 0 })
    assert.deepEqual((await pool.query('SELECT process_status,process_comments,platform_order_rid,energy_platform_rid,energy_package_rid,energy_platform_bot_rid,tg_notice_status_send FROM t_energy_wallet_trade_list')).rows[0], {
      process_status: 9, process_comments: 'SUCCESS', platform_order_rid: 1, energy_platform_rid: 4, energy_package_rid: 8, energy_platform_bot_rid: 42, tg_notice_status_send: 'N',
    })
    assert.equal((await pool.query('SELECT cash_trx::text FROM t_telegram_bot_user')).rows[0].cash_trx, '6.5')
    assert.deepEqual((await pool.query('SELECT platform_order_id,source_type,recovery_status,use_trx::text FROM t_energy_platform_order')).rows[0], {
      platform_order_id: 'isolated-signer-order', source_type: 2, recovery_status: 2, use_trx: '0.75',
    })
    assert.equal((await syncTrxEnergyTrades({ pool, enabled: true, fetcher, logger: { error() {} } })).scanned, 0)
  } finally {
    if (previous.appEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous.appEnv
    if (previous.signerUrl === undefined) delete process.env.TRON_SIGNER_URL; else process.env.TRON_SIGNER_URL = previous.signerUrl
    if (previous.signerToken === undefined) delete process.env.TRON_SIGNER_TOKEN; else process.env.TRON_SIGNER_TOKEN = previous.signerToken
    await pool.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
    await admin.end()
  }
})

test('ambiguous provider failure remains claimed to prevent a duplicate paid order', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'integration database must be local')
  const admin = new pg.Pool({ connectionString, max: 2 })
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema + '_uncertain', max: 2 })
  const separateSchema = schema + '_uncertain'
  const previous = { appEnv: process.env.APP_ENV, signerUrl: process.env.TRON_SIGNER_URL, signerToken: process.env.TRON_SIGNER_TOKEN }
  try {
    await admin.query('CREATE SCHEMA ' + separateSchema)
    await pool.query(`
      CREATE TABLE t_energy_platform_bot(rid integer PRIMARY KEY,bot_rid integer,receive_wallet text,status integer,poll_group text,agent_tg_uid text);
      CREATE TABLE t_energy_wallet_trade_list(rid integer PRIMARY KEY,transferfrom_address text,transferto_address text,coin_name text,amount numeric,process_status integer,process_comments text,process_time timestamp,energy_platform_bot_rid integer);
      CREATE TABLE t_energy_platform_package(rid integer PRIMARY KEY,bot_rid integer,trx_price numeric,energy_amount integer,energy_day integer,agent_trx_price numeric);
      CREATE TABLE t_energy_platform(tid integer PRIMARY KEY,rid integer,platform_name integer,platform_uid text,platform_apikey text,permission_id integer,platform_balance numeric,seq_sn integer,poll_group text,status integer,comments text);
      INSERT INTO t_energy_platform_bot VALUES(42,7,'receiver',0,'pool-a',NULL);
      INSERT INTO t_energy_wallet_trade_list VALUES(51,'buyer-wallet','receiver','trx',12,1,NULL,NULL,NULL);
      INSERT INTO t_energy_platform_package VALUES(8,7,12,65000,1,NULL);
      INSERT INTO t_energy_platform VALUES(1,4,3,'pool-wallet','ciphertext-only-test',0,100000,1,'pool-a',0,NULL)
    `)
    process.env.APP_ENV = 'local'
    process.env.TRON_SIGNER_URL = 'https://signer.test'
    process.env.TRON_SIGNER_TOKEN = '0123456789abcdef0123456789abcdef'
    const failures: string[] = []
    const fetcher: typeof fetch = async () => { throw new Error('simulated timeout after submit') }
    const options = { pool, enabled: true, fetcher, logger: { error: (message: string) => failures.push(message) } }
    assert.deepEqual(await syncTrxEnergyTrades(options), { skipped: false, scanned: 1, succeeded: 0, failed: 0, manual: 1 })
    assert.equal((await pool.query('SELECT process_status,process_comments FROM t_energy_wallet_trade_list')).rows[0].process_status, 8)
    assert.match((await pool.query('SELECT process_comments FROM t_energy_wallet_trade_list')).rows[0].process_comments, /禁止自动重试/)
    assert.equal((await syncTrxEnergyTrades(options)).scanned, 0)
    assert.equal(failures.length, 1)
  } finally {
    if (previous.appEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous.appEnv
    if (previous.signerUrl === undefined) delete process.env.TRON_SIGNER_URL; else process.env.TRON_SIGNER_URL = previous.signerUrl
    if (previous.signerToken === undefined) delete process.env.TRON_SIGNER_TOKEN; else process.env.TRON_SIGNER_TOKEN = previous.signerToken
    await pool.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + separateSchema + ' CASCADE')
    await admin.end()
  }
})
