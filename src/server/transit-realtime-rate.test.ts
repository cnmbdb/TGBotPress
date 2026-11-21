import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateRealtimeExchangeRate, realtimeRateFromIndexPrice, refreshRealtimeTrxRates } from './transit-realtime-rate.server'

test('OKX index price is inverted and rounded to two decimals using decimal arithmetic', () => {
  assert.equal(realtimeRateFromIndexPrice('0.80'), '1.25')
  assert.equal(realtimeRateFromIndexPrice('3'), '0.33')
  assert.equal(realtimeRateFromIndexPrice('0.3456'), '2.89')
  assert.equal(realtimeRateFromIndexPrice('0'), null)
  assert.equal(realtimeRateFromIndexPrice('-0.1'), null)
  assert.equal(realtimeRateFromIndexPrice('1e-8'), null)
})

test('real-time direct and percentage margins preserve the PHP rate semantics', () => {
  assert.equal(calculateRealtimeExchangeRate('1.25', '0.10', 1), '1.15')
  assert.equal(calculateRealtimeExchangeRate('1.25', '0.15', 3), '1.06')
  assert.equal(calculateRealtimeExchangeRate('1.25', '2.00', 1), '1.00')
  assert.equal(calculateRealtimeExchangeRate('1.25', '0.00', 2), null)
  assert.equal(calculateRealtimeExchangeRate('1.25', '0.001', 1), null)
})


test('stopped scheduler does not contact OKX or write rates', async () => {
  let requested = false
  const result = await refreshRealtimeTrxRates(
    undefined,
    async () => { requested = true; throw new Error('request should not run') },
    { warn() {} },
    () => false,
  )
  assert.deepEqual(result, { updated: 0, reason: 'stopped' })
  assert.equal(requested, false)
})
