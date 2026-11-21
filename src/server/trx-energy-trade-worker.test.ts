import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncTrxEnergyTrades } from './trx-energy-trade-worker.server'

test('TRX-paid energy trade worker is disabled unless explicitly enabled', async () => {
  const result = await syncTrxEnergyTrades({ enabled: false, pool: {
    query: async () => { throw new Error('disabled query') },
    connect: async () => { throw new Error('disabled connection') },
  } as never })
  assert.deepEqual(result, { skipped: true, scanned: 0, succeeded: 0, failed: 0, manual: 0 })
})
