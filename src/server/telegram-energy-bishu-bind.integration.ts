import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { handleTelegramEnergyBishuBind } from './telegram-energy-bishu-bind.server'

const connectionString = process.env.PLATFORM_TEST_DATABASE_URL
test('energy bishu Telegram binding updates only for configured platform administrators and reads back', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
  assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname))
  assert.match(url.pathname.slice(1), /^telegram_bishu_bind_test_/)
  assert.match(decodeURIComponent(url.username), /^telegram_bishu_bind_test_/)
  const pool = new Pool({ connectionString })
  const botRid = 31
  const sender = '700001'
  const wallet = 'T' + 'A'.repeat(33)
  const sent: string[] = []
  try {
    await pool.query('CREATE TABLE t_telegram_bot (rid integer primary key, bot_token text)')
    await pool.query('CREATE TABLE t_energy_platform_bot (rid serial primary key, bot_rid integer, tg_admin_uid text, status smallint)')
    await pool.query('CREATE TABLE t_energy_ai_bishu (rid serial primary key, bot_rid integer, wallet_addr text, tg_uid text, update_time timestamp)')
    await pool.query('INSERT INTO t_telegram_bot(rid,bot_token) VALUES ($1,$2)', [botRid, 'mock-token'])
    await pool.query('INSERT INTO t_energy_platform_bot(bot_rid,tg_admin_uid,status) VALUES ($1,$2,0)', [botRid, sender])
    await pool.query('INSERT INTO t_energy_ai_bishu(bot_rid,wallet_addr,tg_uid) VALUES ($1,$2,$3)', [botRid, wallet, 'old-user'])
    const update = (userId: string) => ({ message: { message_id: 7, chat: { id: userId, type: 'private' }, from: { id: userId }, text: `绑定笔数 ${wallet} 700002,700003` } })
    const unauthorized = await handleTelegramEnergyBishuBind({
      pool, botRid, update: update('700009'),
      sendMessage: async (_message, text) => { sent.push(text); return true },
    })
    assert.equal(unauthorized.kind, 'replied')
    assert.match(sent.at(-1)!, /管理员不正确/)
    assert.equal((await pool.query('SELECT tg_uid FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2', [botRid, wallet])).rows[0].tg_uid, 'old-user')
    const authorized = await handleTelegramEnergyBishuBind({
      pool, botRid, update: update(sender),
      sendMessage: async (_message, text) => { sent.push(text); return true },
    })
    assert.deepEqual(authorized, { kind: 'replied', text: `✅笔数地址：${wallet} 通知已更改！`, updated: true })
    assert.equal((await pool.query('SELECT tg_uid FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2', [botRid, wallet])).rows[0].tg_uid, '700002,700003')
  } finally {
    await pool.end()
  }
})
