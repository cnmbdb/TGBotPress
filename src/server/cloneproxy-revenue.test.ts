import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloneProxyRevenueCommission, syncCloneProxyRevenue } from './cloneproxy-revenue.server'
import type { SchedulerLogger } from './scheduler.server'

test('clone proxy commissions use exact six-decimal rounding and cap the configured ratio', () => {
  assert.deepEqual(cloneProxyRevenueCommission('10.000000', '12.34'), {
    gross: '10.000000', commission: '1.234000', ratioHundredths: 1234n,
  })
  assert.deepEqual(cloneProxyRevenueCommission('1.000000', '999.00'), {
    gross: '1.000000', commission: '1.500000', ratioHundredths: 99900n,
  })
  assert.deepEqual(cloneProxyRevenueCommission('0.000001', '50.00'), {
    gross: '0.000001', commission: '0.000001', ratioHundredths: 5000n,
  })
  assert.equal(cloneProxyRevenueCommission('0.000001', '0.01'), null)
})

test('clone proxy revenue rejects malformed or non-positive source amounts', () => {
  assert.equal(cloneProxyRevenueCommission('not-a-number', '10.00'), null)
  assert.equal(cloneProxyRevenueCommission('-1.00', '10.00'), null)
  assert.equal(cloneProxyRevenueCommission('1.00', '-1.00'), null)
})

test('a stopped worker does not query or connect to the revenue database', async () => {
  let calls = 0
  const pool = {
    query: async () => { calls++; throw new Error('query must not run') },
    connect: async () => { calls++; throw new Error('connect must not run') },
  }
  const logger: SchedulerLogger = { info() {}, error() {} }
  const result = await syncCloneProxyRevenue(pool as never, logger, () => false)
  assert.equal(result.stopped, true)
  assert.equal(result.scanned, 0)
  assert.equal(calls, 0)
})
