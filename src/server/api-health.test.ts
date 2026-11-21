import assert from 'node:assert/strict'
import test from 'node:test'
import { health } from './api.server'

function pool(workerReady: boolean) {
  return {
    query: async (sql: string) => ({ rows: [], rowCount: sql === 'SELECT 1' || workerReady ? 1 : 0 }),
  } as never
}

test('health reports database readiness in web-only mode', async () => {
  const response = await health(pool(false), 'web')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', runtime: 'typescript', database: 'connected' })
})

test('all mode remains not ready until the scheduler lease is active', async () => {
  const response = await health(pool(false), 'all')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'not_ready', runtime: 'typescript', database: 'connected', worker: 'not_ready' })
})

test('all mode reports ready only when a current scheduler lease exists', async () => {
  const response = await health(pool(true), 'all')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', runtime: 'typescript', database: 'connected', worker: 'ready' })
})
