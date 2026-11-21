import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { handleTelegramExchangeRate } from './telegram-exchange-rate.server'

const connectionString = process.env.PLATFORM_TEST_DATABASE_URL
test('private Telegram exchange-rate command reads only the bot active USDT/TRX wallet', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
  assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname))
  assert.match(url.pathname.slice(1), /^telegram_exchange_rate_test_/)
  assert.match(decodeURIComponent(url.username), /^telegram_exchange_rate_test_/)
  const pool = new Pool({ connectionString })
  try {
    await pool.query('CREATE TABLE t_transit_wallet (rid integer primary key, bot_rid integer, receive_wallet text, status smallint)')
    await pool.query('CREATE TABLE t_transit_wallet_coin (rid serial primary key, transit_wallet_id integer, in_coin_name text, out_coin_name text, exchange_rate numeric(8,2))')
    await pool.query("INSERT INTO t_transit_wallet VALUES (1,41,'TReceive',0),(2,41,'TDisabled',1),(3,42,'TOther',0)")
    await pool.query("INSERT INTO t_transit_wallet_coin(transit_wallet_id,in_coin_name,out_coin_name,exchange_rate) VALUES (1,'usdt','trx',2.50),(2,'usdt','trx',4.00),(3,'usdt','trx',5.00)")
    const messages: string[] = []
    const result = await handleTelegramExchangeRate({
      pool, botRid: 41,
      update: { message: { message_id: 20, chat: { id: 800, type: 'private' }, from: { id: 800 }, text: '3 usdt' } },
      sendMessage: async (_message, text) => { messages.push(text); return true },
    })
    if (result.kind === 'not-command') throw new Error('expected exchange-rate command')
    assert.equal(result.configured, true)
    assert.match(messages[0], /3 USDT = 7.5 TRX/)
    assert.match(messages[0], /TReceive/)
    assert.doesNotMatch(messages[0], /TDisabled|TOther/)
    const groupResult = await handleTelegramExchangeRate({
      pool, botRid: 41,
      update: { message: { message_id: 21, chat: { id: -100800, type: 'supergroup' }, from: { id: 801 }, text: '4U' } },
      allowGroups: true,
      sendMessage: async (_message, text) => { messages.push(text); return true },
    })
    assert.equal(groupResult.kind, 'replied')
    assert.equal(groupResult.configured, true)
    assert.match(messages[1], /4 USDT = 10 TRX/)
    assert.match(messages[1], /TReceive/)
  } finally {
    await pool.end()
  }
})
