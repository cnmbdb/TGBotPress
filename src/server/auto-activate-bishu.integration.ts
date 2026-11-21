import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { autoActivateBishu } from './auto-activate-bishu.server'

const connectionString = process.env.PLATFORM_TEST_DATABASE_URL
const url = connectionString ? new URL(connectionString) : null

test('auto activation and idle deactivation persist safely under concurrent workers', { skip: !connectionString }, async () => {
  assert.ok(url)
  assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname), 'integration DB must be local to the sandbox')
  const role = decodeURIComponent(url.username)
  const database = decodeURIComponent(url.pathname.slice(1))
  assert.ok(role.startsWith('auto_bishu_test_') && database.startsWith('auto_bishu_test_'), 'integration requires its dedicated disposable PostgreSQL role and database')

  const admin = new pg.Pool({ connectionString, max: 2 })
  const schema = 'auto_bishu_' + randomUUID().replaceAll('-', '')
  const pool = new pg.Pool({ connectionString, max: 6, options: '-c search_path=' + schema })
  const notices: Array<{ token: string; chatId: string; wallet: string }> = []
  const logger = { error() {} }

  try {
    await admin.query('CREATE SCHEMA "' + schema + '"')
    await pool.query([
      'CREATE TABLE t_sys_config (rid serial PRIMARY KEY, config_key text NOT NULL, config_val jsonb)',
      'CREATE TABLE t_telegram_bot (rid integer PRIMARY KEY, bot_token text NOT NULL)',
      'CREATE TABLE t_energy_platform_bot (bot_rid integer PRIMARY KEY, is_open_bishu char(1), status integer, bishu_daili_type integer, per_bishu_energy_quantity integer)',
      'CREATE TABLE t_energy_ai_bishu (rid integer PRIMARY KEY, bot_rid integer NOT NULL, tg_uid text, wallet_addr text NOT NULL, per_bishu_energy_quantity integer, is_active char(1) NOT NULL, status integer NOT NULL, is_buy char(1) NOT NULL, max_buy_quantity integer NOT NULL, total_buy_quantity integer NOT NULL, update_time timestamptz, last_energy_time timestamptz, comments text)',
      "INSERT INTO t_telegram_bot VALUES (1, 'fake-active-token'), (2, 'fake-idle-token'), (3, 'fake-unavailable-token')",
      "INSERT INTO t_energy_platform_bot VALUES (1, 'Y', 0, 4, 65000), (2, 'Y', 0, 4, 65000), (3, 'Y', 0, 4, 65000)",
      "INSERT INTO t_energy_ai_bishu (rid,bot_rid,tg_uid,wallet_addr,per_bishu_energy_quantity,is_active,status,is_buy,max_buy_quantity,total_buy_quantity,update_time) VALUES (11,1,'101','T-low-energy',65000,'Y',0,'N',2,0,now()), (12,2,'201,202','T-unused-energy',65000,'Y',0,'N',2,0,now()-interval '2 hours'), (13,3,'301','T-provider-error',65000,'Y',0,'N',2,0,now()-interval '2 hours')",
    ].join(';'))

    const fetcher = (async (input: RequestInfo | URL) => {
      const requested = new URL(String(input))
      const wallet = requested.searchParams.get('address')
      if (wallet === 'T-provider-error') return new Response('unavailable', { status: 503 })
      const energyUsed = wallet === 'T-low-energy' ? 64_000 : 0
      return Response.json({ data: { energy: { energy_limit: 100_000, energy_used: energyUsed } } })
    }) as typeof fetch
    const notifier = async (token: string, chatId: string, wallet: string) => {
      notices.push({ token, chatId, wallet })
      return true
    }

    const options = { pool, fetcher, notifier, logger }
    const [first, second] = await Promise.all([
      autoActivateBishu(options),
      autoActivateBishu(options),
    ])

    assert.equal(first.dispatchRequested + second.dispatchRequested, 1)
    assert.equal(first.deactivated + second.deactivated, 1)
    assert.equal(first.noticesSent + second.noticesSent, 2)
    assert.deepEqual((await pool.query("SELECT is_buy,last_energy_time IS NOT NULL AS timestamped FROM t_energy_ai_bishu WHERE rid=11")).rows[0], { is_buy: 'Y', timestamped: true })
    assert.deepEqual((await pool.query("SELECT is_active FROM t_energy_ai_bishu WHERE rid=12")).rows[0], { is_active: 'N' })
    assert.deepEqual((await pool.query("SELECT is_active,is_buy FROM t_energy_ai_bishu WHERE rid=13")).rows[0], { is_active: 'Y', is_buy: 'N' })
    assert.deepEqual(notices.sort((a, b) => a.chatId.localeCompare(b.chatId)), [
      { token: 'fake-idle-token', chatId: '201', wallet: 'T-unused-energy' },
      { token: 'fake-idle-token', chatId: '202', wallet: 'T-unused-energy' },
    ])

    const repeat = await autoActivateBishu(options)
    assert.equal(repeat.dispatchRequested, 0)
    assert.equal(repeat.deactivated, 0)
    assert.equal(repeat.noticesSent, 0)
    assert.equal(notices.length, 2)
  } finally {
    await pool.end()
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE').catch(() => undefined)
    await admin.end()
  }
})
