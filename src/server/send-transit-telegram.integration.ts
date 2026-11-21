import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { sendTransitTelegramNotifications } from './send-transit-telegram.server'

const connectionString = process.env.TG_SEND_TRANSIT_TELEGRAM_TEST_DB_URL

test('transit Telegram worker claims rows once and persists notification flags in PostgreSQL', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^transit_notice_test_/.test(decodeURIComponent(url.pathname.slice(1))), 'database name must use the dedicated test prefix')
  assert.ok(/^transit_notice_test_/.test(decodeURIComponent(url.username)), 'database role must use the dedicated test prefix')
  assert.equal(url.hostname, 'transit-notice-pg', 'integration must use the dedicated isolated test network')

  const pool = new Pool({ connectionString, max: 3 })
  const previousActions = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  let releaseFirst!: () => void
  let enteredFirst!: () => void
  const firstRequestEntered = new Promise<void>(resolve => { enteredFirst = resolve })
  const firstRequestGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const calls: Array<{ url: string; body: Record<string, any> }> = []
  let firstCall = true
  let firstRun: Promise<{ skipped: boolean; scanned: number; sent: number; failed: number }> | undefined
  try {
    await pool.query(`
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text,bot_admin_username text);
      CREATE TABLE t_transit_wallet(
        receive_wallet text PRIMARY KEY,bot_rid integer,tg_notice_obj_receive text,tg_notice_obj_send text
      );
      CREATE TABLE t_transit_wallet_trade_list(
        rid integer PRIMARY KEY,tx_hash text,transferfrom_address text,transferto_address text,coin_name text,
        amount text,process_status smallint,tg_notice_status_receive char(1),tg_notice_status_send char(1),
        sendback_amount text,current_huan_yuzhi_amount numeric,sendback_time timestamp
      );
      INSERT INTO t_telegram_bot VALUES(7,'fixture-token','@admin');
      INSERT INTO t_transit_wallet VALUES('Twallet',7,'-1001,1002','-1003');
      INSERT INTO t_transit_wallet_trade_list VALUES
        (1,'tx<&','T123456789abcdefghijk','Twallet','USDT','10',9,'N','N','50',2.5,'2026-10-30 12:00:00'),
        (2,'terminal','Tterminal','Twallet','TRX','1',2,'N','N','0',0,'2026-10-30 12:01:00'),
        (3,'pending','Tpending','Twallet','USDT','3',0,'N','N','0',0,'2026-10-30 12:02:00');
    `)

    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>
      calls.push({ url: String(input), body })
      if (firstCall) {
        firstCall = false
        enteredFirst()
        await firstRequestGate
      }
      return Response.json({ ok: true })
    }
    const options = { pool, fetcher, logger: { error(message: string) { throw new Error(message) }, info() {} } }

    firstRun = sendTransitTelegramNotifications(options)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      firstRequestEntered,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('first Telegram request was not reached')), 5000) }),
    ])
    if (timer) clearTimeout(timer)

    const concurrentRun = await sendTransitTelegramNotifications(options)
    releaseFirst()
    const firstResult = await firstRun

    assert.deepEqual(firstResult, { skipped: false, scanned: 3, sent: 3, failed: 0 })
    assert.deepEqual(concurrentRun, { skipped: false, scanned: 3, sent: 0, failed: 0 })
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.url === 'https://api.telegram.org/botfixture-token/sendMessage'))
    assert.deepEqual(calls.map(call => String(call.body.chat_id)), ['-1001', '1002', '-1003'])
    assert.equal(calls[0].body.parse_mode, 'HTML')
    assert.match(calls[0].body.text, /tx&lt;&amp;/)
    assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].url, 'https://tronscan.io/#/transaction/tx%3C%26')
    assert.equal(calls[2].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/admin')

    const rows = await pool.query('SELECT rid,tg_notice_status_receive,tg_notice_status_send FROM t_transit_wallet_trade_list ORDER BY rid')
    assert.deepEqual(rows.rows, [
      { rid: 1, tg_notice_status_receive: 'Y', tg_notice_status_send: 'Y' },
      { rid: 2, tg_notice_status_receive: 'Y', tg_notice_status_send: 'Y' },
      { rid: 3, tg_notice_status_receive: 'N', tg_notice_status_send: 'N' },
    ])
  } finally {
    releaseFirst?.()
    if (firstRun) await firstRun.catch(() => {})
    if (previousActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previousActions
    await pool.query('DROP TABLE IF EXISTS t_transit_wallet_trade_list,t_transit_wallet,t_telegram_bot CASCADE').catch(() => {})
    await pool.end()
  }
})
