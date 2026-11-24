import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectThirdPartyRegistrations } from '@tgbotpress/plugin-sdk'

const manifest = {
  schemaVersion: 1 as const,
  id: 'example.welcome',
  name: 'Welcome',
  version: '1.0.0',
  apiVersion: 1 as const,
  hostRange: '>=1.0.0 <2.0.0',
  sdkRange: '^0.1.0',
  runtime: { node: '>=22' },
  entry: './dist/index.js',
  permissions: ['telegram.updates.read', 'telegram.messages.send'] as Array<'telegram.updates.read'|'telegram.messages.send'>,
  telegramUpdateTypes: ['message'],
}

test('fine-grained Telegram grants let a handler send through its current bot context', async () => {
  let deliveredBotId = 0
  const plugin = {
    manifest,
    activate(host: any) {
      host.onTelegramUpdate(async ({ telegram }: { telegram: { call: (method: string, payload: Record<string, unknown>) => Promise<unknown> } }) => {
        await telegram.call('sendMessage', { chat_id: '5', text: 'Welcome' })
        return true
      })
    },
  }
  const registrations = await collectThirdPartyRegistrations(plugin as never, { telegram: { call: async botId => { deliveredBotId = botId; return { ok: true } } } })
  assert.equal(await registrations.telegramHandlers[0]!({ botId: 9, update: { message: { text: 'hello' } } }), true)
  assert.equal(deliveredBotId, 9)
})

test('telegram sending fails if the plugin only requests update-read access', async () => {
  const plugin = {
    manifest: { ...manifest, permissions: ['telegram.updates.read'] },
    activate(host: any) { host.onTelegramUpdate(({ telegram }: any) => telegram.call('sendMessage', { chat_id: '5', text: 'no grant' })) },
  }
  const registrations = await collectThirdPartyRegistrations(plugin as never, { telegram: { call: async () => ({ ok: true }) } })
  assert.throws(() => registrations.telegramHandlers[0]!({ botId: 9, update: {} }), /plugin_permission_missing:telegram.messages.send/u)
})

test('Telegram event storage is bound to that event Bot ID', async () => {
  let scopedBotId = 0
  const plugin = {
    manifest: { ...manifest, permissions: ['telegram.updates.read', 'plugin.storage.write'] },
    activate(host: any) {
      host.onTelegramUpdate(async ({ storage }: { storage?: { set: (key: string, value: unknown) => Promise<void> } }) => {
        await storage!.set('last-message', 'hello')
        return true
      })
    },
  }
  const registrations = await collectThirdPartyRegistrations(plugin as never, {
    storage: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      forBot: botId => { scopedBotId = botId; return { get: async () => null, set: async () => undefined, delete: async () => undefined } },
    },
  })
  assert.equal(await registrations.telegramHandlers[0]!({ botId: 37, update: {} }), true)
  assert.equal(scopedBotId, 37)
})
