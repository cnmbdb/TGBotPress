import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyTelegramMemberUpdate, syncTelegramMemberUpdates } from './telegram-member-updates.server'

function change(botRid: number, update: never) {
  const result = classifyTelegramMemberUpdate(botRid, update)
  assert.ok(result && result !== 'ignored')
  return result
}
test('maps private member activation to legacy user fields', () => {
  const update = { my_chat_member: { from: { is_bot: false }, chat: { id: 123, type: 'private', username: 'alice', first_name: 'Alice', last_name: 'Example' }, new_chat_member: { status: 'member' } } }
  assert.equal(change(7, update as never).status, 'active')
  assert.equal(change(7, update as never).entity, 'user')
})
test('maps group administrator and removal states', () => {
  const event = (status: string) => ({ my_chat_member: { from: { is_bot: false }, chat: { id: -321, type: 'supergroup', title: 'Test group' }, new_chat_member: { status } } })
  assert.equal(change(4, event('administrator') as never).status, 'active')
  assert.equal(change(4, event('administrator') as never).entity, 'group')
  assert.equal(change(4, event('left') as never).status, 'inactive')
})
test('ignores bot actors and leaves other update types for later', () => {
  assert.equal(classifyTelegramMemberUpdate(4, { my_chat_member: { from: { is_bot: true }, chat: { id: 4, type: 'group' }, new_chat_member: { status: 'member' } } }), 'ignored')
  assert.equal(classifyTelegramMemberUpdate(4, { message: { text: '/start' } } as never), null)
})
test('disabled consumer does not touch the database', async () => {
  let connected = false
  const pool = { query: async () => { throw new Error('unexpected query') }, connect: async () => { connected = true; throw new Error('unexpected connect') } } as never
  assert.deepEqual(await syncTelegramMemberUpdates({ pool, enabled: false }), { skipped: true, processed: 0 })
  assert.equal(connected, false)
})

