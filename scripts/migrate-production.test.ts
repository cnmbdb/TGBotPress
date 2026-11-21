import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForLegacySchema } from './migration-readiness.mjs'

test('legacy schema readiness waits until all required Admin tables exist', async () => {
 const pending = new Set(['t_admin_device_session', 't_collection_wallet'])
 let checks = 0
 await waitForLegacySchema({
  async query(_sql: string, [tables]: [string[]]) {
   checks += 1
   if (checks === 2) pending.clear()
   return { rows: tables.map(name => ({ name, present: !pending.has(name) })) }
  },
 }, { timeoutMs: 100, pollMs: 1, sleep: async () => undefined })
 assert.equal(checks, 2)
})

test('legacy schema timeout fails before any platform migration is executed', async () => {
 const queries: string[] = []
 let now = 0
 await assert.rejects(
  waitForLegacySchema({
   async query(sql: string) {
    queries.push(sql)
    return { rows: [{ name: 't_admin', present: false }, { name: 't_admin_device_session', present: true }, { name: 't_telegram_bot_user', present: true }, { name: 't_collection_wallet', present: true }] }
   },
  }, { timeoutMs: 1_000, pollMs: 250, now: () => now, sleep: async () => { now = 1_000 } }),
  /Start the Admin container to initialize the legacy schema.*No TanStack migrations were applied/,
 )
 assert.equal(queries.length, 1)
})
