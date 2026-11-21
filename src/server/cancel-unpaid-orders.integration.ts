import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { expireUnpaidOrders, type TelegramOrderNotifier } from './cancel-unpaid-orders.server'
import { acquireTaskLease, renewTaskLease, releaseTaskLease } from './cancel-unpaid-orders-worker.server'

const connectionString = process.env.TG_TEST_DB_URL
if (!connectionString || new URL(connectionString).hostname !== 'tg-native-test-pg') throw new Error('Integration tests require disposable tg-native-test-pg')
const schema = 'cancel_orders_' + randomUUID().replaceAll('-', '')
const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema + ' -c timezone=Asia/Shanghai', max: 5 })
await pool.query('CREATE SCHEMA ' + schema)
await pool.query('CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_token text NOT NULL)')
await pool.query('CREATE TABLE t_premium_platform_order(rid int PRIMARY KEY,bot_rid int NOT NULL,status smallint NOT NULL,expire_time timestamp NOT NULL,update_time timestamp,buy_tg_uid text NOT NULL,premium_tg_username text NOT NULL,premium_package_month int NOT NULL,need_pay_usdt numeric(12,4) NOT NULL)')
await pool.query('CREATE TABLE t_fms_recharge_order(rid int PRIMARY KEY,bot_rid int NOT NULL,status smallint NOT NULL,expire_time timestamp NOT NULL,update_time timestamp,recharge_tg_uid text NOT NULL,need_pay_price numeric(12,4) NOT NULL,recharge_coin_name text NOT NULL,recharge_pay_price numeric(12,4) NOT NULL)')
const migration = await readFile(new URL('../../migrations/002-platform-jobs.sql', import.meta.url), 'utf8')
await pool.query(migration)
await pool.query("INSERT INTO t_telegram_bot(rid,bot_token) VALUES(1,'fixture-token')")
await pool.query("INSERT INTO t_premium_platform_order(rid,bot_rid,status,expire_time,buy_tg_uid,premium_tg_username,premium_package_month,need_pay_usdt) VALUES(11,1,0,now()-interval '1 minute','1001','<alice>',12,19.9900),(12,1,0,now()+interval '1 day','1002','bob',3,4.5000),(13,1,1,now()-interval '1 day','1003','carol',6,8.0000)")
await pool.query("INSERT INTO t_fms_recharge_order(rid,bot_rid,status,expire_time,recharge_tg_uid,need_pay_price,recharge_coin_name,recharge_pay_price) VALUES(21,1,0,now()-interval '2 minutes','2001',10.5000,'USDT','10.0000'),(22,1,0,now()+interval '1 day','2002',4.0000,'USDT','3.8000'),(23,1,2,now()-interval '1 day','2003',2.0000,'TRX','2.0000')")
const calls: Array<{ botToken: string; chatId: string; message: string }> = []
const fakeNotifier: TelegramOrderNotifier = async (botToken, chatId, message) => {
 calls.push({ botToken, chatId, message })
 return true
}
try {
 await test('expiration state and outbox are atomic; notifications retain PHP message fields safely', async () => {
  const result = await expireUnpaidOrders(pool, fakeNotifier)
  assert.deepEqual(result, { premiumExpired: 1, rechargeExpired: 1, notificationsSent: 2, notificationsFailed: 0, notificationsQueued: 2 })
  assert.deepEqual(calls.map(call => [call.botToken, call.chatId]), [['fixture-token','1001'],['fixture-token','2001']])
  assert.match(calls[0].message, /订单号：<\/b>11/)
  assert.match(calls[0].message, /&lt;alice&gt;/)
  assert.match(calls[1].message, /充值币种：<\/b>USDT/)
  const premium = await pool.query('SELECT rid,status FROM t_premium_platform_order ORDER BY rid')
  const recharge = await pool.query('SELECT rid,status FROM t_fms_recharge_order ORDER BY rid')
  assert.deepEqual(premium.rows.map(row => [Number(row.rid), Number(row.status)]), [[11,3],[12,0],[13,1]])
  assert.deepEqual(recharge.rows.map(row => [Number(row.rid), Number(row.status)]), [[21,2],[22,0],[23,2]])
  assert.deepEqual((await pool.query('SELECT status FROM t_platform_job_outbox ORDER BY id')).rows.map(row => row.status), ['sent','sent'])
  const again = await expireUnpaidOrders(pool, fakeNotifier)
  assert.equal(again.notificationsQueued, 0)
  assert.equal(calls.length, 2)
 })
 await test('stopped scheduler does not begin work and leaves committed notifications recoverable', async () => {
  await pool.query("INSERT INTO t_premium_platform_order(rid,bot_rid,status,expire_time,buy_tg_uid,premium_tg_username,premium_package_month,need_pay_usdt) VALUES(15,1,0,now()-interval '1 minute','1005','erin',1,1),(16,1,0,now()-interval '1 minute','1006','frank',1,1)")
  const noStart = await expireUnpaidOrders(pool, fakeNotifier, () => false)
  assert.deepEqual(noStart, { premiumExpired: 0, rechargeExpired: 0, notificationsSent: 0, notificationsFailed: 0, notificationsQueued: 0 })
  assert.deepEqual((await pool.query('SELECT status FROM t_premium_platform_order WHERE rid=16')).rows.map(row => Number(row.status)), [0])

  let checks = 0
  const stoppedAfterCommit = await expireUnpaidOrders(pool, fakeNotifier, () => ++checks === 1)
  assert.deepEqual(stoppedAfterCommit, { premiumExpired: 2, rechargeExpired: 0, notificationsSent: 0, notificationsFailed: 0, notificationsQueued: 0 })
  assert.equal((await pool.query("SELECT status FROM t_platform_job_outbox WHERE idempotency_key='cancelunpaidorder:premium:15'")).rows[0].status, 'pending')
  assert.equal(calls.length, 2)

  const resumed = await expireUnpaidOrders(pool, fakeNotifier)
  assert.equal(resumed.notificationsSent, 2)
  assert.equal((await pool.query("SELECT status FROM t_platform_job_outbox WHERE idempotency_key='cancelunpaidorder:premium:15'")).rows[0].status, 'sent')
 })
 await test('concurrent task runs claim each expired order and idempotency key once', async () => {
  await pool.query("INSERT INTO t_premium_platform_order(rid,bot_rid,status,expire_time,buy_tg_uid,premium_tg_username,premium_package_month,need_pay_usdt) VALUES(14,1,0,now()-interval '1 minute','1004','dave',1,1)")
  const concurrentCalls: string[] = []
  const notifier: TelegramOrderNotifier = async (_token, chatId) => { concurrentCalls.push(chatId); await new Promise(resolve => setTimeout(resolve, 30)); return true }
  const results = await Promise.all([expireUnpaidOrders(pool, notifier), expireUnpaidOrders(pool, notifier)])
  assert.equal(results.reduce((sum, result) => sum + result.premiumExpired, 0), 1)
  assert.deepEqual(concurrentCalls, ['1004'])
  assert.equal((await pool.query("SELECT count(*)::int n FROM t_platform_job_outbox WHERE idempotency_key='cancelunpaidorder:premium:14'")).rows[0].n, 1)
 })
 await test('scheduler lease allows one owner, renews, expires, and hands over safely', async () => {
  assert.equal(await acquireTaskLease(pool, 'lease-test', 'owner-a', 30), true)
  assert.equal(await acquireTaskLease(pool, 'lease-test', 'owner-b', 30), false)
  assert.equal(await renewTaskLease(pool, 'lease-test', 'owner-b', 30), false)
  assert.equal(await renewTaskLease(pool, 'lease-test', 'owner-a', 30), true)
  await pool.query("UPDATE t_platform_job_leader SET lease_expires_at=now()-interval '1 second' WHERE task_name='lease-test'")
  assert.equal(await acquireTaskLease(pool, 'lease-test', 'owner-b', 30), true)
  await releaseTaskLease(pool, 'lease-test', 'owner-a')
  assert.equal((await pool.query("SELECT owner_id FROM t_platform_job_leader WHERE task_name='lease-test'")).rows[0].owner_id, 'owner-b')
  await releaseTaskLease(pool, 'lease-test', 'owner-b')
 })
 await test('failed delivery retries from durable outbox after restart without changing expired state again', async () => {
  await pool.query("INSERT INTO t_fms_recharge_order(rid,bot_rid,status,expire_time,recharge_tg_uid,need_pay_price,recharge_coin_name,recharge_pay_price) VALUES(24,1,0,now()-interval '1 minute','2004',3,'TRX',3)")
  const failed = await expireUnpaidOrders(pool, async () => false)
  assert.deepEqual(failed, { premiumExpired: 0, rechargeExpired: 1, notificationsSent: 0, notificationsFailed: 1, notificationsQueued: 1 })
  await pool.query("UPDATE t_platform_job_outbox SET next_attempt_at=now() WHERE idempotency_key='cancelunpaidorder:recharge:24'")
  const delivered = await expireUnpaidOrders(pool, async () => true)
  assert.equal(delivered.premiumExpired, 0)
  assert.equal(delivered.rechargeExpired, 0)
  assert.equal(delivered.notificationsSent, 1)
  assert.equal((await pool.query("SELECT status,attempts FROM t_platform_job_outbox WHERE idempotency_key='cancelunpaidorder:recharge:24'")).rows[0].status, 'sent')
 })
} finally {
 await pool.query('DROP SCHEMA ' + schema + ' CASCADE')
 await pool.end()
}
