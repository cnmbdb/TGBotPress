import assert from 'node:assert/strict'
import test from 'node:test'
import { telegramWebhookApi } from './telegram-webhook.server'
import { webhookSecret } from './bot-service.server'

const rid = 7
const token = '123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG'
const secret = webhookSecret(rid, token, '01234567890123456789012345678901', '')
type TestTelegramUpdate = { update_id: number; [key: string]: unknown }
const update: TestTelegramUpdate = { update_id: 77, message: { message_id: 3, text: '/start' } }
const request = (body: unknown = update, override: { secret?: string; method?: string; contentType?: string } = {}) => new Request(
  `https://admin.example/api/telegram/webhook?rid=${rid}`,
  { method: override.method || 'POST', headers: { 'content-type': override.contentType || 'application/json', 'x-telegram-bot-api-secret-token': override.secret ?? secret }, body: override.method === 'GET' ? undefined : JSON.stringify(body) },
)
const dependencies = (persist: (rid: number, update: TestTelegramUpdate) => Promise<'inserted' | 'duplicate' | 'conflict'>, enabled = true) => ({
  enabled,
  getBotToken: async (botRid: number) => botRid === rid ? token : null,
  expectedSecret: (botRid: number, botToken: string) => webhookSecret(botRid, botToken, '01234567890123456789012345678901', ''),
  persist,
})

test('rejects updates until the complete dispatcher is enabled', async () => {
  const response = await telegramWebhookApi(request(), dependencies(async () => 'inserted', false))
  assert.equal(response.status, 503)
})

test('authenticates and durably accepts a valid Telegram update once', async () => {
  const saved: unknown[] = []
  const response = await telegramWebhookApi(request(), dependencies(async (_rid, value) => { saved.push(value); return 'inserted' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, duplicate: false })
  assert.deepEqual(saved, [update])
})

test('acknowledges exact retries and rejects conflicting update ids', async () => {
  const duplicate = await telegramWebhookApi(request(), dependencies(async () => 'duplicate'))
  assert.equal(duplicate.status, 200)
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true })
  const conflict = await telegramWebhookApi(request({ update_id: 77, message: { message_id: 4 } }), dependencies(async () => 'conflict'))
  assert.equal(conflict.status, 409)
})

test('rejects missing, invalid, duplicate and other-bot secrets before reading the body', async () => {
  const otherBotSecret = webhookSecret(rid + 1, token, '01234567890123456789012345678901', '')
  const wrongSecret = (secret[0] === 'a' ? 'b' : 'a') + secret.slice(1)
  for (const invalid of [undefined, wrongSecret, `${secret}, ${secret}`, otherBotSecret]) {
    const candidate = new Request(`https://admin.example/api/telegram/webhook?rid=${rid}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not JSON',
    })
    if (invalid !== undefined) candidate.headers.set('x-telegram-bot-api-secret-token', invalid)
    let persisted = false
    const response = await telegramWebhookApi(candidate, dependencies(async () => { persisted = true; return 'inserted' }))
    assert.equal(response.status, 403)
    assert.equal(candidate.bodyUsed, false)
    assert.equal(persisted, false)
  }
})

test('validates method, content type, rid and update id', async () => {
  const deps = dependencies(async () => 'inserted')
  assert.equal((await telegramWebhookApi(request(update, { method: 'GET' }), deps)).status, 405)
  assert.equal((await telegramWebhookApi(request(update, { contentType: 'text/plain' }), deps)).status, 415)
  assert.equal((await telegramWebhookApi(new Request('https://admin.example/api/telegram/webhook?rid=0', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: '{}' }), deps)).status, 400)
  assert.equal((await telegramWebhookApi(request({ update_id: -1 }), deps)).status, 400)
})

test('rejects oversized webhook bodies', async () => {
  const body = JSON.stringify({ update_id: 1, value: 'x'.repeat(1_048_600) })
  const response = await telegramWebhookApi(new Request(`https://admin.example/api/telegram/webhook?rid=${rid}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body }), dependencies(async () => 'inserted'))
  assert.equal(response.status, 413)
})
