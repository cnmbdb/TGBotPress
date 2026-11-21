import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queryWalletEnergy } from './auto-activate-bishu.server'

test('uses TronScan available energy when the response is complete', async () => {
  const energy = await queryWalletEnergy('Twallet', { trongrid: ['unused-key'] }, async () =>
    new Response(JSON.stringify({ data: { energy: { energy_limit: 90_000, energy_used: 22_000 } } }), { status: 200 }),
  )
  assert.equal(energy, 68_000)
})

test('falls back to TronGrid when TronScan does not return a complete energy balance', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const energy = await queryWalletEnergy('Twallet', { trongrid: ['fixture-key'] }, async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('tronscanapi')) return new Response(JSON.stringify({ data: {} }), { status: 200 })
    return new Response(JSON.stringify({ EnergyLimit: 80_000, EnergyUsed: 7_500 }), { status: 200 })
  })
  assert.equal(energy, 72_500)
  assert.equal(requests.length, 2)
  assert.equal((requests[1].init?.headers as Record<string, string>)['TRON-PRO-API-KEY'], 'fixture-key')
})

test('does not convert an unavailable balance into zero energy', async () => {
  const energy = await queryWalletEnergy('Twallet', { trongrid: [] }, async () =>
    new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }),
  )
  assert.equal(energy, null)
})


test('registers the auto-activation migration in the shared worker scheduler', async () => {
  const statements: string[] = []
  const pool = {
    query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 0 } },
    connect: async () => { throw new Error('no rows should require a transaction') },
  } as never
  const { platformScheduledTasks } = await import('./platform-worker.server')
  const task = platformScheduledTasks(pool).find(item => item.name === 'autoactivatebishu')
  assert.ok(task)
  assert.equal(task.intervalMs, 60_000)
  assert.deepEqual(await task.run(() => true), {
    activeScanned: 0, dispatchRequested: 0, deactivationScanned: 0, deactivated: 0, noticesSent: 0,
  })
  assert.equal(statements.length, 3)
})
