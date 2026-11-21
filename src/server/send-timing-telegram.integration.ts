import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { sendTimingTelegramAds } from './send-timing-telegram.server'

const connectionString = process.env.TG_TIMING_AD_TEST_DB_URL
test('PostgreSQL integration claims scheduled ads once and sends messages/photos to direct and active recipients', { skip: !connectionString }, async () => {
  const admin = new pg.Pool({ connectionString })
  const schema = 'timing_ad_' + randomUUID().replaceAll('-', '')
  let pool: pg.Pool | undefined
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema + ' -c timezone=Asia/Shanghai' })
    await pool.query('CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text NOT NULL,bot_username text,bot_admin_username text)')
    await pool.query('CREATE TABLE t_telegram_bot_ad(rid integer PRIMARY KEY,bot_rid integer NOT NULL,notice_cycle smallint NOT NULL,notice_obj varchar(200) NOT NULL,notice_photo varchar(500),notice_ad varchar(2000) NOT NULL,status smallint NOT NULL,last_notice_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_bot_keyboard(rid integer PRIMARY KEY,keyboard_type smallint NOT NULL,keyboard_name varchar(20) NOT NULL,keyboard_icon_custom_emoji_id varchar(64),inline_type smallint NOT NULL,keyboard_value varchar(500) NOT NULL,status smallint NOT NULL,seq_sn integer NOT NULL)')
    await pool.query('CREATE TABLE t_telegram_bot_ad_keyboard(rid integer PRIMARY KEY,bot_rid integer NOT NULL,ad_rid integer NOT NULL,keyboard_rid integer NOT NULL)')
    await pool.query('CREATE TABLE t_telegram_bot_user(rid integer PRIMARY KEY,bot_rid integer NOT NULL,tg_uid bigint NOT NULL,status smallint NOT NULL)')
    await pool.query('CREATE TABLE t_transit_wallet(rid integer PRIMARY KEY,bot_rid integer NOT NULL,receive_wallet text NOT NULL,show_notes text)')
    await pool.query('CREATE TABLE t_transit_wallet_coin(rid integer PRIMARY KEY,transit_wallet_id integer NOT NULL,in_coin_name text NOT NULL,out_coin_name text NOT NULL,exchange_rate numeric(8,2) NOT NULL)')
    await pool.query("INSERT INTO t_telegram_bot VALUES(4,'fixture-token','fixture_bot','support')")
    await pool.query("INSERT INTO t_telegram_bot_ad VALUES(9,4,1,'-1001,888',NULL,'10=' || chr(36) || '{trx10usdtrate} ' || chr(36) || '{tgbotname}',0,NULL)")
    await pool.query("INSERT INTO t_telegram_bot_keyboard VALUES(1,2,'Open','emoji-id=12345',1,'https://example.test',0,10),(2,2,'Help',NULL,2,'help',0,9)")
    await pool.query('INSERT INTO t_telegram_bot_ad_keyboard VALUES(1,4,9,1),(2,4,9,2)')
    await pool.query("INSERT INTO t_telegram_bot_user VALUES(1,4,555,1),(2,4,666,1),(3,4,777,0)")
    await pool.query("INSERT INTO t_transit_wallet VALUES(5,4,'TWallet','Notes')")
    await pool.query("INSERT INTO t_transit_wallet_coin VALUES(6,5,'usdt','trx',2.50)")
    process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
    const sent: { url: string; body: any }[] = []
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true })
    }
    const first = await sendTimingTelegramAds({ pool, fetcher, now: Date.now, logger: { info() {}, error() {} } })
    assert.deepEqual(first, { skipped: false, scanned: 1, claimed: 1, sent: 3, failed: 0 })
    assert.deepEqual(sent.map(item => item.body.chat_id), ['-1001', '555', '666'])
    assert.equal(sent[0].body.text, '10=25 @fixture_bot')
    assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].icon_custom_emoji_id, '12345')
    const nextAt = (await pool.query('SELECT last_notice_time FROM t_telegram_bot_ad WHERE rid=9')).rows[0].last_notice_time
    assert.ok(nextAt)
    const second = await sendTimingTelegramAds({ pool, fetcher, now: Date.now, logger: { info() {}, error() {} } })
    assert.equal(second.claimed, 0)
    assert.equal(sent.length, 3)
    await pool.query("UPDATE t_telegram_bot_ad SET last_notice_time=now()-interval '2 days',notice_photo='https://example.test/photo.jpg' WHERE rid=9")
    const photo = await sendTimingTelegramAds({ pool, fetcher, now: Date.now, logger: { info() {}, error() {} } })
    assert.deepEqual(photo, { skipped: false, scanned: 1, claimed: 1, sent: 3, failed: 0 })
    assert.ok(sent.slice(3).every(item => item.url.endsWith('/sendPhoto') && item.body.caption === '10=25 @fixture_bot'))
  } finally {
    process.env.PLATFORM_TELEGRAM_ACTIONS = previous ?? 'false'
    await pool?.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
    await admin.end()
  }
})

