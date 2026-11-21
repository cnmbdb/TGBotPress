import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'

const raw = process.env.TG_TELEGRAM_WEBHOOK_TEST_DB_URL
const url = raw ? new URL(raw) : null
if (!raw || !url || url.hostname !== 'postgres' ||
  !url.username.startsWith('tg_telegram_webhook_test_') ||
  !url.pathname.slice(1).startsWith('tg_telegram_webhook_test_')) {
  throw new Error('Telegram activation integration requires a disposable tg_telegram_webhook_test_ database and role')
}
process.env.DB_HOST = url.hostname
process.env.DB_PORT = url.port || '5432'
process.env.DB_DATABASE = url.pathname.slice(1)
process.env.DB_USERNAME = url.username
process.env.DB_PASSWORD = decodeURIComponent(url.password)
process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
process.env.PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS = 'true'
process.env.APP_ENV = 'development'
process.env.TRON_SIGNER_URL = 'http://signer.test'
process.env.TRON_SIGNER_TOKEN = 'x'.repeat(40)
process.env.TRONGRID_API_KEY = 'isolated-test-key'

const setup = new pg.Pool({ connectionString: raw, options: '-c timezone=Asia/Shanghai', max: 3 })
const address = 'T' + 'A'.repeat(33)
const txid = 'b'.repeat(64)

try {
  await test('Telegram address activation is authorized, durable, idempotent and uses mocked chain services', async () => {
    const files = await import('node:fs/promises')
    const legacySchema = await files.readFile(new URL('../../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
    const empty = await setup.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'")
    if (empty.rows[0]?.count !== '0') throw new Error('Telegram activation integration requires a fresh disposable database')
    await setup.query(legacySchema)
    const migrationsPath = new URL('../../migrations/', import.meta.url)
    const migrations = (await files.readdir(migrationsPath)).filter(file => file.endsWith('.sql')).sort()
    for (const migration of migrations) await setup.query(await files.readFile(new URL(migration, migrationsPath), 'utf8'))
    await setup.query('INSERT INTO t_telegram_bot(rid,bot_token,bot_username) VALUES(1,$1,$2)', ['123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_fixture', 'fixturebot'])
    await setup.query(`INSERT INTO t_transit_wallet(rid,chain_type,receive_wallet,send_wallet,send_wallet_privatekey,status,tg_notice_obj_receive,bot_rid)
      VALUES(11,'TRON','TReceiveWallet111111111111111111','TSendWallet1111111111111111111111','ciphertext-fixture',0,'501',1)`)

    const { telegramSupportUpdateClaimable } = await import('./telegram-support-updates.server')
    const command = { message: { message_id: 10, chat: { id: 501, type: 'private' }, from: { id: 501 }, text: `激活地址${address}` } }
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, command), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, { edited_message: command.message }), false)

    const { handleTelegramAdminActivation } = await import('./telegram-admin-activation.server')
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
    const replies: string[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push({ url: request.url, body: request.method === 'POST' ? await request.json() as Record<string, unknown> : undefined })
      if (request.url.includes('/v1/accounts/')) return Response.json({ success: true, data: [] })
      return Response.json({ code: 200, data: { txid } })
    }
    const sendMessage = async (_message: unknown, text: string) => { replies.push(text); return true }
    const authorized = await handleTelegramAdminActivation({
      pool: setup, fetcher, botRid: 1, updateRid: 9001,
      message: { ...command.message, text: `激活地址${address}` }, sendMessage,
    })
    assert.equal(authorized, 'replied')
    assert.equal(requests.filter(request => request.body?.operation === 'transfer_trx').length, 1)
    assert.equal(requests.find(request => request.body?.operation === 'transfer_trx')?.body?.amount, '1')
    assert.deepEqual((await setup.query('SELECT state,tx_hash FROM t_platform_telegram_address_activation WHERE update_rid=9001')).rows, [{ state: 'succeeded', tx_hash: txid }])

    const duplicate = await handleTelegramAdminActivation({
      pool: setup, fetcher, botRid: 1, updateRid: 9002,
      message: { ...command.message, text: `激活地址${address}` }, sendMessage,
    })
    assert.equal(duplicate, 'replied')
    assert.equal(requests.filter(request => request.body?.operation === 'transfer_trx').length, 1)

    const denied = await handleTelegramAdminActivation({
      pool: setup, fetcher, botRid: 1, updateRid: 9003,
      message: { ...command.message, chat: { id: 502, type: 'private' }, text: `激活地址${'T' + 'B'.repeat(33)}` }, sendMessage,
    })
    assert.equal(denied, 'replied')
    assert.equal(requests.filter(request => request.body?.operation === 'transfer_trx').length, 1)
    assert.match(replies[0]!, /激活成功/)
    assert.ok(replies.some(text => /管理员不正确/.test(text)))

    const uncertainAddress = 'T' + 'C'.repeat(33)
    let ambiguousSignerCalls = 0
    const ambiguousFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url.includes('/v1/accounts/')) return Response.json({ success: true, data: [] })
      ambiguousSignerCalls++
      return new Response('', { status: 502 })
    }
    await handleTelegramAdminActivation({
      pool: setup, fetcher: ambiguousFetcher, botRid: 1, updateRid: 9010,
      message: { ...command.message, text: `激活地址${uncertainAddress}` }, sendMessage,
    })
    assert.deepEqual((await setup.query('SELECT state,error_code FROM t_platform_telegram_address_activation WHERE update_rid=9010')).rows,
      [{ state: 'manual', error_code: 'signer_result_ambiguous' }])
    await handleTelegramAdminActivation({
      pool: setup, fetcher: ambiguousFetcher, botRid: 1, updateRid: 9011,
      message: { ...command.message, text: `激活地址${uncertainAddress}` }, sendMessage,
    })
    assert.equal(ambiguousSignerCalls, 1)
  })
} finally {
  await setup.end()
}
