import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { pauseStaleBishuWallets } from './bishu-wallet-stop.server'

const connectionString = process.env.TG_TEST_DB_URL
if (!connectionString || new URL(connectionString).hostname !== 'tg-native-test-pg') throw new Error('Integration tests require disposable tg-native-test-pg')
const schema = 'bishu_stop_' + randomUUID().replaceAll('-', '')
const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema, max: 3 })
await pool.query('CREATE SCHEMA ' + schema)
await pool.query('CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_token text NOT NULL)')
await pool.query('CREATE TABLE t_energy_ai_bishu(rid int PRIMARY KEY,bot_rid int NOT NULL,tg_uid text NOT NULL,wallet_addr text NOT NULL,status smallint NOT NULL,bishu_stop_day int NOT NULL,max_buy_quantity int NOT NULL,total_buy_quantity int NOT NULL,back_comments text,update_time timestamp)')
await pool.query('CREATE TABLE t_energy_platform_order(rid int PRIMARY KEY,receive_address text NOT NULL,energy_time timestamp NOT NULL,recovery_time timestamp)')
await pool.query("INSERT INTO t_telegram_bot VALUES(1,'fixture-token')")
const wallet1 = 'T' + '1'.repeat(33)
const wallet2 = 'T' + '2'.repeat(33)
const wallet3 = 'T' + '3'.repeat(33)
const wallet4 = 'T' + '4'.repeat(33)
await pool.query("INSERT INTO t_energy_ai_bishu(rid,bot_rid,tg_uid,wallet_addr,status,bishu_stop_day,max_buy_quantity,total_buy_quantity,back_comments) VALUES(1,1,'111,222',$1,0,2,10,3,'before'),(2,1,'333',$2,0,2,10,3,'before'),(3,1,'444',$3,1,2,10,3,'already paused'),(4,1,'555',$4,0,2,3,3,'complete')", [wallet1,wallet2,wallet3,wallet4])
await pool.query("INSERT INTO t_energy_platform_order(rid,receive_address,energy_time,recovery_time) VALUES(101,$1,now()-interval '3 days',now()-interval '3 days'+interval '25 hours'),(102,$1,now()-interval '2 days',now()-interval '2 days'+interval '26 hours'),(103,$1,now(),NULL),(201,$2,now()-interval '2 days',now()-interval '2 days'+interval '25 hours'),(202,$2,now(),NULL)", [wallet1,wallet2])

try {
  await test('pauses only addresses whose previous configured orders were idle for a full day and notifies each user once', async () => {
    const notices: Array<[string,string,string]> = []
    const notify = async (token:string, chatId:string, message:string) => { notices.push([token,chatId,message]); return true }
    const result = await pauseStaleBishuWallets(pool, notify, { error() {} })
    assert.deepEqual(result, { scanned: 2, paused: 1, notified: 2 })
    assert.deepEqual(notices.map(([token,chat]) => [token,chat]), [['fixture-token','111'],['fixture-token','222']])
    assert.match(notices[0][2], new RegExp(wallet1))
    const rows = await pool.query('SELECT rid,status,back_comments FROM t_energy_ai_bishu ORDER BY rid')
    assert.equal(Number(rows.rows[0].status), 1)
    assert.match(rows.rows[0].back_comments, /^滞留2天，自动暂停：/)
    assert.equal(rows.rows[1].back_comments, 'before')
    assert.equal(Number(rows.rows[2].status), 1)
    assert.equal(rows.rows[3].back_comments, 'complete')
    assert.deepEqual(await pauseStaleBishuWallets(pool, notify, { error() {} }), { scanned: 1, paused: 0, notified: 0 })
    assert.equal(notices.length, 2)
  })
} finally {
  await pool.query('DROP SCHEMA ' + schema + ' CASCADE')
  await pool.end()
}
