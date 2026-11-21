import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acquireTaskLease, releaseTaskLease } from './task-lease.server'
import { PLATFORM_SCHEDULER_LEASE, runScheduledTasks, type SchedulerDatabase } from './scheduler.server'

type Lease = { owner: string; expiresAt: number }

function makeLeaseDatabase(): SchedulerDatabase {
  const leases = new Map<string, Lease>()
  const query = async (sql: string, parameters: unknown[] = []) => {
    const [name, owner, seconds] = parameters as [string, string, number]
    if (sql.startsWith('INSERT INTO t_platform_job_leader')) {
      const current = leases.get(name)
      if (current && current.expiresAt > Date.now() && current.owner !== owner) {
        return { rowCount: 0, rows: [] }
      }
      leases.set(name, { owner, expiresAt: Date.now() + seconds * 1000 })
      return { rowCount: 1, rows: [{ owner_id: owner }] }
    }
    if (sql.startsWith('UPDATE t_platform_job_leader')) {
      const current = leases.get(name)
      if (!current || current.owner !== owner || current.expiresAt <= Date.now()) {
        return { rowCount: 0, rows: [] }
      }
      current.expiresAt = Date.now() + seconds * 1000
      return { rowCount: 1, rows: [{ owner_id: owner }] }
    }
    if (sql.startsWith('DELETE FROM t_platform_job_leader')) {
      const current = leases.get(name)
      if (current?.owner === owner) leases.delete(name)
      return { rowCount: 1, rows: [] }
    }
    throw new Error('Unexpected scheduler query')
  }
  return { query } as unknown as SchedulerDatabase
}

const quietLogger = { info() {}, error() {} }
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

test('a single leased scheduler dispatches one task and drains it before releasing leadership', async () => {
  const pool = makeLeaseDatabase()
  let stopFirst = false
  let stopSecond = false
  let calls = 0
  let active = 0
  let peakActive = 0
  let finished = 0

  const task = {
    name: 'fixture',
    intervalMs: 10,
    run: async (shouldContinue: () => boolean) => {
      assert.equal(shouldContinue(), true)
      calls++
      active++
      peakActive = Math.max(peakActive, active)
      setTimeout(() => { stopFirst = true; stopSecond = true }, 8)
      await pause(35)
      finished++
      active--
    },
  }
  const options = (isStopping: () => boolean) => ({
    pool,
    tasks: [task],
    logger: quietLogger,
    isStopping,
    pollIntervalMs: 1,
    heartbeatIntervalMs: 4,
    leaseSeconds: 1,
  })

  await Promise.all([
    runScheduledTasks(options(() => stopFirst)),
    runScheduledTasks(options(() => stopSecond)),
  ])

  assert.equal(calls, 1)
  assert.equal(finished, 1)
  assert.equal(active, 0)
  assert.equal(peakActive, 1)
  assert.equal(await acquireTaskLease(pool, PLATFORM_SCHEDULER_LEASE, 'post-shutdown', 1), true)
  await releaseTaskLease(pool, PLATFORM_SCHEDULER_LEASE, 'post-shutdown')
})
