import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createProcessSupervisor } from './process-supervisor.mjs'

class FakeChild extends EventEmitter {
  signals = []
  kill(signal) { this.signals.push(signal); return true }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('a service exit fails the group and terminates its siblings', async () => {
  const children = []
  const supervisor = createProcessSupervisor({
    signalTarget: new EventEmitter(),
    spawnImpl: () => { const child = new FakeChild(); children.push(child); return child },
  })
  try {
    const running = supervisor.runGroup([{ label: 'web', args: [] }, { label: 'worker', args: [] }])
    assert.equal(children.length, 2)
    children[0].emit('exit', 2, null)
    await tick()
    assert.deepEqual(children[1].signals, ['SIGTERM'])
    children[1].emit('exit', null, 'SIGTERM')
    assert.deepEqual(await running, { exitCode: 2, stopping: true })
  } finally { supervisor.dispose() }
})

test('SIGTERM stops all services and lets their exit handlers drain', async () => {
  const children = []
  const signalTarget = new EventEmitter()
  const supervisor = createProcessSupervisor({
    signalTarget,
    spawnImpl: () => { const child = new FakeChild(); children.push(child); return child },
  })
  try {
    const running = supervisor.runGroup([{ label: 'web', args: [] }, { label: 'worker', args: [] }])
    signalTarget.emit('SIGTERM')
    assert.deepEqual(children.map(child => child.signals), [['SIGTERM'], ['SIGTERM']])
    children.forEach(child => child.emit('exit', 0, null))
    assert.deepEqual(await running, { exitCode: 0, stopping: true })
  } finally { supervisor.dispose() }
})

test('the shutdown deadline escalates surviving children to SIGKILL', async () => {
  const children = []
  const supervisor = createProcessSupervisor({
    signalTarget: new EventEmitter(),
    killTimeoutMs: 5,
    spawnImpl: () => { const child = new FakeChild(); children.push(child); return child },
  })
  try {
    const running = supervisor.runGroup([{ label: 'failed web', args: [] }, { label: 'stuck worker', args: [] }])
    children[0].emit('exit', 1, null)
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.deepEqual(children[1].signals, ['SIGTERM', 'SIGKILL'])
    children[1].emit('exit', null, 'SIGKILL')
    assert.deepEqual(await running, { exitCode: 1, stopping: true })
  } finally { supervisor.dispose() }
})

test('a successful one-shot migration child does not mark startup as failed', async () => {
  const supervisor = createProcessSupervisor({
    signalTarget: new EventEmitter(),
    spawnImpl: () => {
      const child = new FakeChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    },
  })
  try {
    assert.deepEqual(await supervisor.runChild({ label: 'migration', args: [] }), { code: 0, signal: null })
    assert.equal(supervisor.stopping, false)
  } finally { supervisor.dispose() }
})
