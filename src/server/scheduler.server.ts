import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { acquireTaskLease, releaseTaskLease, renewTaskLease } from './task-lease.server'

export type SchedulerDatabase = Pick<Pool, 'query' | 'connect'>
export type SchedulerLogger = Pick<Console, 'info' | 'error'>
export type ScheduledTask = {
  name: string
  intervalMs: number
  run: (shouldContinue: () => boolean) => Promise<unknown>
}

export const PLATFORM_SCHEDULER_LEASE = 'platform-job-scheduler'

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

export async function runScheduledTasks(options: {
  pool: SchedulerDatabase
  tasks: ScheduledTask[]
  logger?: SchedulerLogger
  isStopping?: () => boolean
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  leaseSeconds?: number
  now?: () => number
}) {
  const { pool } = options
  const logger = options.logger ?? console
  const isStopping = options.isStopping ?? (() => false)
  const now = options.now ?? Date.now
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000
  const leaseSeconds = options.leaseSeconds ?? 45
  if (options.tasks.length === 0) throw new Error('The platform scheduler requires at least one registered task.')
  if (new Set(options.tasks.map(task => task.name)).size !== options.tasks.length) {
    throw new Error('Scheduled task names must be unique.')
  }
  if (options.tasks.some(task => !task.name.trim() || !Number.isSafeInteger(task.intervalMs) || task.intervalMs <= 0)) {
    throw new Error('Scheduled task names and intervals must be valid.')
  }

  const owner = randomUUID()
  let leader = false
  let leadershipEpoch = 0
  let heartbeatRunning = false
  let heartbeatPromise: Promise<void> | undefined
  const runs = new Map<string, Promise<void>>()
  const lastSlots = new Map(options.tasks.map(task => [task.name, Math.floor(now() / task.intervalMs)]))

  const heartbeat = () => {
    if (heartbeatRunning || (isStopping() && !leader)) return heartbeatPromise ?? Promise.resolve()
    heartbeatRunning = true
    heartbeatPromise = (async () => {
      try {
        const retained = leader
          ? await renewTaskLease(pool, PLATFORM_SCHEDULER_LEASE, owner, leaseSeconds)
          : await acquireTaskLease(pool, PLATFORM_SCHEDULER_LEASE, owner, leaseSeconds)
        if (leader && !retained) logger.error('platform scheduler lost its leader lease')
        if (leader !== retained) leadershipEpoch++
        leader = retained
      } catch {
        if (leader) {
          leadershipEpoch++
          logger.error('platform scheduler could not renew its leader lease')
        }
        leader = false
      } finally {
        heartbeatRunning = false
        heartbeatPromise = undefined
      }
    })()
    return heartbeatPromise
  }

  await heartbeat()
  const heartbeatTimer = setInterval(() => { void heartbeat() }, heartbeatIntervalMs)
  heartbeatTimer.unref?.()

  try {
    while (!isStopping()) {
      await delay(pollIntervalMs)
      if (isStopping() || !leader) continue

      const currentTime = now()
      for (const task of options.tasks) {
        const slot = Math.floor(currentTime / task.intervalMs)
        const previousSlot = lastSlots.get(task.name) ?? slot
        if (slot <= previousSlot) continue
        lastSlots.set(task.name, slot)
        if (runs.has(task.name)) continue

        const runEpoch = leadershipEpoch
        const shouldContinue = () => leader && leadershipEpoch === runEpoch && !isStopping()
        const run: Promise<void> = Promise.resolve()
          .then(async () => { await task.run(shouldContinue) })
          .catch(() => { logger.error('platform scheduler task failed: ' + task.name) })
          .finally(() => { runs.delete(task.name) })
        runs.set(task.name, run)
      }
    }
  } finally {
    while (runs.size > 0) await Promise.allSettled([...runs.values()])
    clearInterval(heartbeatTimer)
    if (heartbeatPromise) await heartbeatPromise
    if (leader) {
      try {
        await releaseTaskLease(pool, PLATFORM_SCHEDULER_LEASE, owner)
      } catch {
        logger.error('platform scheduler could not release its leader lease')
      }
    }
  }
}
