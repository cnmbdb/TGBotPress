import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { platformScheduledTasks } from './platform-worker.server'
import { pluginCatalog } from '../plugins/catalog'

test('shared group replies and plugin-owned group moderation remain separate scheduled jobs', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const tasks = platformScheduledTasks(pool)
  const replies = tasks.find(item => item.name === 'moderationgroupmessages')
  const management = tasks.find(item => item.name === 'groupspluginmessages')
  assert.ok(replies)
  assert.ok(management)
  assert.equal(replies.intervalMs, 1_000)
  assert.equal(management.intervalMs, 1_000)
})

test('every registered plugin scheduled task is present in the shared worker or dedicated monitor worker', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const names = new Set(platformScheduledTasks(pool).map(task => task.name))
  for (const plugin of pluginCatalog) for (const task of plugin.tasks) {
    if (task === 'monitorwalletworker') continue
    assert.ok(names.has(task), `${plugin.id} task ${task} is registered`)
  }
})

test('Bishu wallet stop runs at 03:01 Asia/Shanghai and skips the old UTC slot', async () => {
  const statements: string[] = []
  const pool = {
    connect: async () => ({
      query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 0 } },
      release() {},
    }),
    query: async () => ({ rows: [], rowCount: 0 }),
  } as never
  const logger = { info() {}, error() {} }
  const taskAt = (instant: number) => platformScheduledTasks(pool, logger, () => instant).find(item => item.name === 'bishuwalletstop')!
  const task = taskAt(Date.UTC(2026, 0, 1, 19, 0))
  assert.equal(task.intervalMs, 60_000)
  assert.deepEqual(await task.run(() => true), { skipped: true })
  assert.equal(statements.length, 0)

  const utcSlot = await taskAt(Date.UTC(2026, 0, 1, 3, 1)).run(() => true)
  assert.deepEqual(utcSlot, { skipped: true })
  assert.equal(statements.length, 0)

  const atSlot = await taskAt(Date.UTC(2026, 0, 1, 19, 1)).run(() => true)
  assert.deepEqual(atSlot, { scanned: 0, paused: 0, notified: 0 })
  assert.equal(statements.length, 1)
})

test('energy platform balance refresh is registered at the legacy five-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'getenergyplatformbalance')
  assert.ok(task)
  assert.equal(task.intervalMs, 5_000)
})

test('scheduled Telegram ads are registered every minute without activating the worker', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'sendtimingtgmessage')
  assert.ok(task)
  assert.equal(task.intervalMs, 60_000)
})

test('development Telegram polling is registered at 500 ms and remains explicitly gated', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'telegrampolling')
  assert.ok(task)
  assert.equal(task.intervalMs, 500)
})

test('transit Telegram notifications retain the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'sendtransittgmessage')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('energy Telegram notifications retain the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'sendenergytgmessage')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('premium Telegram notifications retain the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'sendpremiumtgmessage')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('transit USDT polling retains the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'transitwalletusdttrade')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('premium wallet USDT polling retains the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'premiumwalletusdttrade')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('energy wallet TRX and USDT polling retains the legacy two-second interval', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'energywalletinlisttrxusdt')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
})

test('energy block scanning and lost-block recovery retain their legacy two-second schedules', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  for (const name of ['monitorenergywallettrade', 'monitorenergywallettradelost']) {
    const task = platformScheduledTasks(pool).find(item => item.name === name)
    assert.ok(task)
    assert.equal(task.intervalMs, 2_000)
  }
})

test('premium fulfillment retains the legacy three-second interval and stays disabled by default', async () => {
  const previous = process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS
  delete process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS
  let touched = false
  const pool = { connect: async () => { touched = true; throw new Error('unexpected database access') }, query: async () => { touched = true; throw new Error('unexpected database access') } } as never
  try {
    const task = platformScheduledTasks(pool).find(item => item.name === 'tgpremium')
    assert.ok(task)
    assert.equal(task.intervalMs, 3_000)
    assert.deepEqual(await task.run(() => true), { skipped: true, scanned: 0, matched: 0, succeeded: 0, failed: 0, manual: 0 })
    assert.equal(touched, false)
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS
    else process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS = previous
  }
})


test('energyOrder runs every two seconds and stays disabled by default', async () => {
  const previous = process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  let touched = false
  const pool = { connect: async () => { touched = true; throw new Error('unexpected database access') }, query: async () => { touched = true; throw new Error('unexpected query') } } as never
  try {
    const task = platformScheduledTasks(pool).find(item => item.name === 'energyOrder')
    assert.ok(task)
    assert.equal(task.intervalMs, 2_000)
    assert.deepEqual(await task.run(() => true), { skipped: true, scanned: 0, succeeded: 0, failed: 0 })
    assert.equal(touched, false)
  } finally {
    if (previous != null) process.env.PLATFORM_ENERGY_ORDER_ACTIONS = previous
  }
})


test('AI count-package energy purchases run every three seconds and stay disabled by default',async()=>{
  const task=platformScheduledTasks({query:async()=>{throw new Error('disabled task must not query')},connect:async()=>{throw new Error('disabled task must not connect')}} as never).find(item=>item.name==='handleaienergybishu')
  assert.ok(task);assert.equal(task.intervalMs,3_000)
  assert.deepEqual(await task.run(()=>true),{skipped:true,scanned:0,succeeded:0,failed:0,manual:0})
})

test('registers every legacy cron job across the shared scheduler and dedicated monitor worker', () => {
  const legacyNames = [
    'transitwalletusdttrade', 'shanduiBonus', 'getoktrealtimerate', 'sendtimingtgmessage',
    'sendtransittgmessage', 'monitorWalletBlockv2', 'monitorWalletBlockLostv2',
    'getenergyplatformbalance', 'energywalletinlisttrxusdt', 'monitorenergywallettrade',
    'monitorenergywallettradelost', 'handleenergyspecial', 'sendenergytgmessage',
    'recoveryenergy', 'energyOrder', 'tgpremium', 'cancelunpaidorder',
    'sendpremiumtgmessage', 'premiumwalletusdttrade', 'getgmswallettrxusdttrade',
    'getaienergywalletresource', 'getaitrusteeshipwalletresource', 'handleaienergyorder',
    'handlerechargeorder', 'synctelegramcloneproxyrevenue', 'handlecollectionwallet',
    'bishuwalletstop', 'autoactivatebishu', 'bindasendnusdt',
  ]
  const parity = JSON.parse(readFileSync(new URL('../../../docs/migrations/job-parity.json', import.meta.url), 'utf8')) as {
    scheduledTasks: Array<{ name: string }>
  }
  assert.deepEqual(parity.scheduledTasks.map(task => task.name).sort(), legacyNames.slice().sort())

  const delegatedNames = new Set(['monitorWalletBlockv2', 'monitorWalletBlockLostv2'])
  const pool = {
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }),
    query: async () => ({ rows: [], rowCount: 0 }),
  } as never
  const scheduledTasks = platformScheduledTasks(pool)
  const scheduledNames = scheduledTasks.map(task => task.name)
  const okxRateTask = scheduledTasks.find(task => task.name === 'getoktrealtimerate')
  assert.ok(okxRateTask)
  assert.equal(okxRateTask.intervalMs, 5_000)
  assert.equal(legacyNames.length, 29)
  assert.equal(new Set(scheduledNames).size, scheduledNames.length)
  assert.deepEqual(legacyNames.filter(name => !delegatedNames.has(name) && !scheduledNames.includes(name)), [])

  const start = readFileSync(new URL('../../scripts/start.mjs', import.meta.url), 'utf8')
  const devAll = readFileSync(new URL('../../scripts/dev-all.mjs', import.meta.url), 'utf8')
  const worker = readFileSync(new URL('../worker/monitor-wallet-worker.ts', import.meta.url), 'utf8')
  assert.match(start, /monitor-wallet-worker/u)
  assert.match(start, /PLATFORM_MONITOR_WALLET_ENABLED === 'true'/u)
  assert.match(devAll, /monitor-wallet-worker/u)
  assert.match(devAll, /PLATFORM_MONITOR_WALLET_ENABLED === 'true'/u)
  assert.match(worker, /intervalMs = 2_000/u)
  assert.match(worker, /syncMonitorWalletCurrentBlock/u)
  assert.match(worker, /syncMonitorWalletMissedBlock/u)
  assert.match(worker, /deliverMonitorWalletNotifications/u)
})

test('every legacy cron manifest cadence matches its TanStack poll interval', () => {
  const parity = JSON.parse(readFileSync(new URL('../../../docs/migrations/job-parity.json', import.meta.url), 'utf8')) as {
    scheduledTasks: Array<{ name: string; rule: string }>
  }
  const pool = {
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }),
    query: async () => ({ rows: [], rowCount: 0 }),
  } as never
  const tasks = new Map(platformScheduledTasks(pool).map(task => [task.name, task]))
  const delegated = new Set(['monitorWalletBlockv2', 'monitorWalletBlockLostv2'])

  const expectedInterval = (rule: string) => {
    const fields = rule.trim().split(/\s+/u)
    assert.ok(fields.length === 5 || fields.length === 6, `unsupported legacy cron rule: ${rule}`)
    const step = fields[0]?.match(/^\*\/(\d+)$/u)
    if (fields.length === 6) return step ? Number(step[1]) * 1_000 : 1_000
    return step ? Number(step[1]) * 60_000 : 60_000
  }

  for (const item of parity.scheduledTasks) {
    const intervalMs = expectedInterval(item.rule)
    if (delegated.has(item.name)) continue
    assert.equal(tasks.get(item.name)?.intervalMs, intervalMs, `${item.name} should poll at ${item.rule}`)
  }

  const worker = readFileSync(new URL('../worker/monitor-wallet-worker.ts', import.meta.url), 'utf8')
  const workerInterval = worker.match(/intervalMs\s*=\s*([\d_]+)/u)?.[1]
  assert.ok(workerInterval, 'dedicated monitor worker must declare its poll interval')
  for (const name of delegated) {
    const item = parity.scheduledTasks.find(task => task.name === name)
    assert.ok(item, `${name} must exist in the legacy schedule manifest`)
    assert.equal(Number(workerInterval.replaceAll('_', '')), expectedInterval(item.rule), `${name} should poll at ${item.rule}`)
  }
})


test('TanStack image polling is scheduled by the shared worker once per minute with a three-day due gate', () => {
  const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'tanstackimagecheck')
  assert.ok(task)
  assert.equal(task.intervalMs, 60_000)
})
