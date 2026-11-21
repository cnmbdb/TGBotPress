import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { BotService, BotServiceError, webhookSecret } from './bot-service.server'

test('webhook uses configured origin and refuses an inactive local receiver', async t => {
  const keys = ['TELEGRAM_WEBHOOK_ORIGIN', 'WEBHOOK_PUBLIC_ORIGIN', 'WEB_URL', 'PLATFORM_ORIGIN', 'PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY', 'TELEGRAM_WEBHOOK_SECRET_KEY'] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const calls: Array<{ method: string; data?: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => sql.startsWith('SELECT rid,bot_token')
    ? { rowCount: 1, rows: [{ rid: 1, bot_token: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG' }] }
    : { rowCount: 1, rows: [] } } as unknown as Pool
  const service = new BotService(pool, { invalidate: async () => {}, telegram: async (_token, method, data) => { calls.push({ method, data }); return {} }, templateRid: 1, autoClone: false })
  process.env.TELEGRAM_WEBHOOK_SECRET_KEY = '01234567890123456789012345678901'
  try {
    await t.test('defaults to PLATFORM_ORIGIN when the receiver is ready', async () => {
      delete process.env.TELEGRAM_WEBHOOK_ORIGIN
      delete process.env.WEBHOOK_PUBLIC_ORIGIN
      delete process.env.WEB_URL
      process.env.PLATFORM_ORIGIN = 'https://admin.example.test'
      process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
      await service.webhook(1, '1')
      assert.equal(calls.at(-1)?.data?.url, 'https://admin.example.test/api/telegram/getdata?rid=1')
    })
    await t.test('rejects an inactive local receiver before contacting Telegram', async () => {
      process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'false'
      const before = calls.length
      await assert.rejects(service.webhook(1, '1'), (error: unknown) => error instanceof BotServiceError && error.status === 503 && error.message.includes('更新接收尚未启用'))
      assert.equal(calls.length, before)
    })
    await t.test('keeps a separately configured legacy WEB_URL', async () => {
      process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
      delete process.env.TELEGRAM_WEBHOOK_ORIGIN
      delete process.env.WEBHOOK_PUBLIC_ORIGIN
      process.env.WEB_URL = 'https://legacy.example.test'
      await service.webhook(1, '1')
      assert.equal(calls.at(-1)?.data?.url, 'https://legacy.example.test/api/telegram/getdata?rid=1')
    })
    await t.test('prefers the dedicated Telegram webhook origin over the admin origin', async () => {
      process.env.TELEGRAM_WEBHOOK_ORIGIN = 'https://bot.example.test'
      process.env.PLATFORM_ORIGIN = 'https://admin.example.test'
      process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
      await service.webhook(1, '1')
      assert.equal(calls.at(-1)?.data?.url, 'https://bot.example.test/api/telegram/getdata?rid=1')
      assert.equal(calls.at(-1)?.method, 'setWebhook')
      assert.equal(calls.at(-1)?.data?.secret_token, webhookSecret(1, '123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG', '01234567890123456789012345678901', ''))
    })
    await t.test('requires a configured HTTPS address', async () => {
      process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
      delete process.env.TELEGRAM_WEBHOOK_ORIGIN
      delete process.env.WEBHOOK_PUBLIC_ORIGIN
      delete process.env.WEB_URL
      delete process.env.PLATFORM_ORIGIN
      await assert.rejects(service.webhook(1, '1'), /请配置 WEB_URL/)
      process.env.PLATFORM_ORIGIN = 'http://admin.example.test'
      await assert.rejects(service.webhook(1, '1'), /HTTPS/)
    })
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})
