import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { refreshEnergyPlatformBalances } from './energy-platform-balance.server'

const connectionString = process.env.TG_ENERGY_PLATFORM_BALANCE_TEST_DB_URL

test('energy platform balance refresh persists valid provider results, sends simulated alerts, and preserves values on provider failure', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^energy_balance_test_/.test(decodeURIComponent(url.pathname.slice(1))), 'database name must use the dedicated test prefix')
  assert.ok(/^energy_balance_test_/.test(decodeURIComponent(url.username)), 'database role must use the dedicated test prefix')
  assert.equal(url.hostname, 'energy-balance-pg', 'integration must use the dedicated isolated test network')

  const schema = 'energy_balance_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, max: 1 })
  const previousTelegramGate = process.env.PLATFORM_TELEGRAM_ACTIONS
  const notices: Array<{ chat_id: string; text: string; parse_mode: string }> = []
  const errors: string[] = []
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)
    await pool.query(`
      CREATE TABLE t_sys_config(rid serial PRIMARY KEY, config_key varchar(100), config_val text);
      CREATE TABLE t_telegram_bot(rid serial PRIMARY KEY, bot_token varchar(255));
      CREATE TABLE t_energy_platform(
        rid serial PRIMARY KEY, platform_name smallint NOT NULL, platform_uid text,
        platform_apikey text, platform_balance numeric(20,6) NOT NULL,
        alert_platform_balance numeric(20,6) NOT NULL, last_alert_time timestamptz,
        tg_notice_obj text, tg_notice_bot_rid integer, comments text,
        status smallint NOT NULL DEFAULT 0, update_time timestamptz
      );
    `)
    await pool.query("INSERT INTO t_telegram_bot(rid,bot_token) VALUES(1,'fixture-token')")
    await pool.query(`
      INSERT INTO t_energy_platform(rid,platform_name,platform_uid,platform_balance,alert_platform_balance,tg_notice_obj,tg_notice_bot_rid,status)
      VALUES (1,4,'uid<one>&',11.25,100,'-1001, -1002',1,0), (2,4,'provider-failure',77.25,0,'',1,0)
    `)

    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const current = new URL(String(input))
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)
      if (current.hostname === 'trongas.io') {
        assert.equal(current.pathname, '/api/userInfo')
        assert.equal(init?.method, 'POST')
        const body = JSON.parse(String(init?.body))
        if (body.username === 'provider-failure') return new Response('upstream unavailable', { status: 502 })
        assert.deepEqual(body, { username: 'uid<one>&' })
        return Response.json({ code: 10000, data: { balance: 42.5 } })
      }
      if (current.hostname === 'api.telegram.org') {
        assert.match(current.pathname, /^\/botfixture-token\/sendMessage$/)
        const body = JSON.parse(String(init?.body))
        notices.push(body)
        return Response.json({ ok: true })
      }
      throw new Error('Unexpected external request: ' + current.hostname + current.pathname)
    }

    const result = await refreshEnergyPlatformBalances({
      pool,
      fetcher: request as typeof fetch,
      now: () => Date.now(),
      logger: { info() {}, error(message: string) { errors.push(message) } },
    })

    assert.deepEqual(result, { scanned: 2, updated: 1, alertsDue: 1, notified: 2, failed: 1 })
    assert.deepEqual(notices.map(item => item.chat_id), ['-1001', '-1002'])
    assert.ok(notices.every(item => item.parse_mode === 'HTML' && item.text.includes('uid&lt;one&gt;&amp;')))
    assert.equal(errors.length, 1)
    const saved = await pool.query('SELECT rid,platform_balance::text,last_alert_time FROM t_energy_platform ORDER BY rid')
    assert.equal(saved.rows[0].platform_balance, '42.500000')
    assert.ok(saved.rows[0].last_alert_time)
    assert.equal(saved.rows[1].platform_balance, '77.250000', 'failed provider response must not overwrite the stored balance')
    assert.equal(saved.rows[1].last_alert_time, null)
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString, max: 1 })
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } catch {} finally { await cleanup.end() }
    if (previousTelegramGate === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previousTelegramGate
  }
})
