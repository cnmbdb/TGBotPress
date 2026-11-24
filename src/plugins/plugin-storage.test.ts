import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pluginStorage } from './plugin-storage.server'

test('plugin storage scopes keys by both plugin and bot ID', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const storage = pluginStorage(({ query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    return { rows: sql.startsWith('SELECT') ? [{ value_json: { greeting: 'hi' } }] : [], rowCount: 1 }
  } }) as never, 'example.welcome')
  const botStorage = storage.forBot(123)
  await botStorage.set('greeting', { greeting: 'hi' })
  const storageCalls=()=>calls.filter(call=>call.sql.includes('t_platform_plugin_storage'))
  assert.deepEqual(storageCalls()[0]?.values, ['example.welcome', 123, 'greeting', JSON.stringify({ greeting: 'hi' })])
  assert.deepEqual(await botStorage.get('greeting'), { greeting: 'hi' })
  assert.deepEqual(storageCalls()[1]?.values, ['example.welcome', 123, 'greeting'])
  await botStorage.delete('greeting')
  assert.deepEqual(storageCalls()[2]?.values, ['example.welcome', 123, 'greeting'])
})

test('plugin storage rejects invalid bot scopes and oversized values', async () => {
  const storage = pluginStorage(({ query: async () => ({ rows: [], rowCount: 0 }) }) as never, 'example.welcome')
  assert.throws(() => storage.forBot(-1), /plugin_storage_bot_id_invalid/u)
  await assert.rejects(storage.set('too-large', 'x'.repeat(1_000_001)), /plugin_storage_value_invalid/u)
})

test('Bot-scoped plugin storage refuses access when that Bot instance is disabled', async () => {
  const storage=pluginStorage({query:async()=>({rows:[],rowCount:0})} as never,'example.welcome').forBot(23)
  await assert.rejects(storage.get('private'),/plugin_storage_bot_disabled/u)
  await assert.rejects(storage.set('private','value'),/plugin_storage_bot_disabled/u)
})
