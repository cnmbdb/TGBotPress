import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRechargeAmount, syncRechargeOrders } from './recharge-order-worker.server'
import { platformScheduledTasks } from './platform-worker.server'

test('normalizes only plain decimal recharge amounts without losing precision', () => {
  assert.equal(normalizeRechargeAmount('00012.3400'), '12.34')
  assert.equal(normalizeRechargeAmount('1.000000'), '1')
  assert.equal(normalizeRechargeAmount('0.000001'), '0.000001')
  assert.equal(normalizeRechargeAmount('1e-6'), null)
  assert.equal(normalizeRechargeAmount('-1'), null)
  assert.equal(normalizeRechargeAmount(''), null)
})

test('recharge settlement is disabled by default and registers the legacy four-second task', async () => {
  const old = process.env.PLATFORM_RECHARGE_ORDER_ACTIONS
  delete process.env.PLATFORM_RECHARGE_ORDER_ACTIONS
  let touched = false
  const pool = {
    query: async () => { touched = true; throw new Error('database should remain untouched') },
    connect: async () => { touched = true; throw new Error('database should remain untouched') },
  } as never
  try {
    assert.deepEqual(await syncRechargeOrders({ pool }), {
      skipped: true, scanned: 0, paid: 0, unmatched: 0, userMissing: 0, failed: 0, notificationsSent: 0,
    })
    const task = platformScheduledTasks(pool).find(item => item.name === 'handlerechargeorder')
    assert.equal(task?.intervalMs, 4_000)
    assert.deepEqual(await task?.run(() => true), {
      skipped: true, scanned: 0, paid: 0, unmatched: 0, userMissing: 0, failed: 0, notificationsSent: 0,
    })
    assert.equal(touched, false)
  } finally {
    if (old === undefined) delete process.env.PLATFORM_RECHARGE_ORDER_ACTIONS
    else process.env.PLATFORM_RECHARGE_ORDER_ACTIONS = old
  }
})
