import { test } from 'node:test'
import assert from 'node:assert/strict'
import { energyStakeSun, syncEnergySpecial } from './energy-special.server'
import { platformScheduledTasks } from './platform-worker.server'

test('energy delegation stake conversion uses exact ceiling and one TRX minimum', () => {
  assert.equal(energyStakeSun(32_000n, 2_000_000_000n, 180_000_000_000n), 355_555_556n)
  assert.equal(energyStakeSun(1n, 1_000n, 180_000_000_000n), 1_000_000n)
  assert.throws(() => energyStakeSun(0n, 1n, 1n))
})

test('special energy chain work is disabled by default and does not touch the database', async () => {
  const old = process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS
  delete process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS
  let touched = false
  const pool = { query: async () => { touched = true; throw new Error('database should remain untouched') }, connect: async () => { touched = true; throw new Error('database should remain untouched') } } as never
  try {
    assert.deepEqual(await syncEnergySpecial({ pool }), { skipped: true, scanned: 0, delegated: 0, recovered: 0, failed: 0, noticesSent: 0 })
    const task = platformScheduledTasks(pool).find(item => item.name === 'handleenergyspecial')
    assert.equal(task?.intervalMs, 3_000)
    assert.deepEqual(await task?.run(() => true), { skipped: true, scanned: 0, delegated: 0, recovered: 0, failed: 0, noticesSent: 0 })
    assert.equal(touched, false)
  } finally {
    if (old === undefined) delete process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS
    else process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS = old
  }
})
