import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { parseTronscanAccountResource, refreshAiTrusteeshipResources } from './ai-trusteeship-resource.server'
import { platformScheduledTasks } from './platform-worker.server'

const account = (activated: unknown = true, energy: unknown = 120, free: unknown = 20, net: unknown = 30) => ({ activated, bandwidth: { energyRemaining: energy, freeNetRemaining: free, netRemaining: net } })

test('parses active Tronscan resources and rejects inactive or incomplete results', () => {
  assert.deepEqual(parseTronscanAccountResource(account(true, '120', '20', 30)), { bandwidth: 50, energy: 120 })
  assert.equal(parseTronscanAccountResource(account(false)), null)
  assert.equal(parseTronscanAccountResource(account(true, 'invalid')), null)
  assert.equal(parseTronscanAccountResource({ activated: true, bandwidth: {} }), null)
})

test('refreshes only valid active accounts and keeps order triggers disabled by default', async () => {
  const sql: string[] = []
  const values: unknown[][] = []
  const pool = { query: async (query: string, args?: unknown[]) => {
    sql.push(query); values.push(args || [])
    if (query.includes('SELECT a.rid')) return { rows: [{ rid: 4, wallet_addr: 'T123456789012345678901234567890123' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } } as unknown as Pool
  const result = await refreshAiTrusteeshipResources({ pool, enabled: true, delayMs: 0, fetcher: async () => Response.json(account(true, 80, 40, 60)) })
  assert.deepEqual(result, { checked: 1, updated: 1, failed: 0, skipped: 0 })
  assert.match(sql[1], /is_buy=CASE WHEN \$4::boolean/)
  assert.deepEqual(values[1], [4, 100, 80, false])
})

test('a failed provider response leaves database rows unchanged', async () => {
  let writes = 0
  const pool = { query: async (query: string) => {
    if (query.includes('SELECT a.rid')) return { rows: [{ rid: 4, wallet_addr: 'T123456789012345678901234567890123' }], rowCount: 1 }
    writes++
    return { rows: [], rowCount: 1 }
  } } as unknown as Pool
  const result = await refreshAiTrusteeshipResources({ pool, enabled: true, delayMs: 0, fetcher: async () => new Response(null, { status: 429 }), logger: { error() {} } })
  assert.deepEqual(result, { checked: 1, updated: 0, failed: 1, skipped: 0 })
  assert.equal(writes, 0)
})


test('registers the legacy five-second resource-refresh schedule once', () => {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('unused') } } as unknown as Pool
  const tasks = platformScheduledTasks(pool)
  const matches = tasks.filter(task => task.name === 'getaitrusteeshipwalletresource')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].intervalMs, 5_000)
})
