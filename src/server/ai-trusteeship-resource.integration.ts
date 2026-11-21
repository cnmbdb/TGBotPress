import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { refreshAiTrusteeshipResources } from './ai-trusteeship-resource.server'

const url = process.env.PLATFORM_TEST_DATABASE_URL

test('refreshes wallet resources with a disposable PostgreSQL schema and keeps order trigger gated', { skip: !url }, async () => {
  const admin = new pg.Pool({ connectionString: url, max: 2 })
  const schema = 'ai_resource_' + randomUUID().replaceAll('-', '')
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` })
  try {
    await pool.query(`
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY);
      CREATE TABLE t_energy_platform_bot(bot_rid integer,is_open_ai_trusteeship char(1));
      CREATE TABLE t_energy_ai_trusteeship(rid integer PRIMARY KEY,bot_rid integer,status smallint,wallet_addr varchar(64),is_buy char(1),min_energy_quantity integer,current_bandwidth_quantity integer,current_energy_quantity integer);
      INSERT INTO t_telegram_bot VALUES(3);
      INSERT INTO t_energy_platform_bot VALUES(3,'Y');
      INSERT INTO t_energy_ai_trusteeship VALUES(7,3,0,'T123456789012345678901234567890123','N',100,0,0);
    `)
    const off = await refreshAiTrusteeshipResources({ pool, enabled: true, delayMs: 0, allowPurchaseTrigger: false, fetcher: async () => Response.json({ activated: true, bandwidth: { freeNetRemaining: 40, netRemaining: 60, energyRemaining: 80 } }) })
    assert.deepEqual(off, { checked: 1, updated: 1, failed: 0, skipped: 0 })
    assert.deepEqual((await pool.query('SELECT is_buy,current_bandwidth_quantity,current_energy_quantity FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0], { is_buy: 'N', current_bandwidth_quantity: 100, current_energy_quantity: 80 })

    const on = await refreshAiTrusteeshipResources({ pool, enabled: true, delayMs: 0, allowPurchaseTrigger: true, fetcher: async () => Response.json({ activated: true, bandwidth: { freeNetRemaining: 20, netRemaining: 30, energyRemaining: 70 } }) })
    assert.equal(on.updated, 1)
    assert.deepEqual((await pool.query('SELECT is_buy,current_bandwidth_quantity,current_energy_quantity FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0], { is_buy: 'Y', current_bandwidth_quantity: 50, current_energy_quantity: 70 })

    const before = (await pool.query('SELECT * FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0]
    const failed = await refreshAiTrusteeshipResources({ pool, enabled: true, delayMs: 0, allowPurchaseTrigger: true, fetcher: async () => new Response(null, { status: 429 }) })
    assert.equal(failed.failed, 1)
    assert.deepEqual((await pool.query('SELECT * FROM t_energy_ai_trusteeship WHERE rid=7')).rows[0], before)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  }
})
