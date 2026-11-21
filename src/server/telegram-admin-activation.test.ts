import assert from 'node:assert/strict'
import test from 'node:test'
import { handleTelegramAdminActivation } from './telegram-admin-activation.server'
import { telegramSupportUpdateClaimable } from './telegram-support-updates.server'

const address = 'T' + 'A'.repeat(33)
const txid = 'a'.repeat(64)

function restoreEnv(keys: string[]) {
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function fakePool(options: { reservation?: boolean; state?: 'signing' | 'succeeded' | 'manual' } = {}) {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('SELECT send_wallet')) return { rows: [{ send_wallet: 'TFromWalletAddress1111111111111111', send_wallet_privatekey: 'ciphertext-fixture', tg_notice_obj_receive: '123,456' }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_platform_telegram_address_activation')) return { rows: options.reservation === false ? [] : [{ update_rid: 90 }], rowCount: options.reservation === false ? 0 : 1 }
    if (sql.startsWith('SELECT state,tx_hash')) return { rows: options.state ? [{ state: options.state, tx_hash: options.state === 'succeeded' ? txid : null }] : [], rowCount: options.state ? 1 : 0 }
    return { rows: [], rowCount: 1 }
  } }
  return { pool, statements }
}

const baseOptions = {
  botRid: 7,
  updateRid: 90,
  message: { message_id: 10, chat: { id: 123, type: 'private' }, from: { id: 123 }, text: `激活地址${address}` },
}

test('address activation stays read-only unless its dedicated sandbox gate is enabled', async () => {
  const restore = restoreEnv(['PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS'])
  delete process.env.PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS
  const { pool } = fakePool()
  const replies: string[] = []
  try {
    const result = await handleTelegramAdminActivation({
      ...baseOptions, pool: pool as never, fetcher: async () => { throw new Error('must not call external service') },
      sendMessage: async (_message, text) => { replies.push(text); return true },
    })
    assert.equal(result, 'replied')
    assert.match(replies[0]!, /未启用地址激活转账/)
  } finally { restore() }
})

test('authorized activation uses the isolated TronGrid and signer contracts once and persists the txid', async () => {
  const keys = ['PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS','APP_ENV','TRON_SIGNER_URL','TRON_SIGNER_TOKEN','TRONGRID_API_KEY']
  const restore = restoreEnv(keys)
  Object.assign(process.env, {
    PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS: 'true', APP_ENV: 'development',
    TRON_SIGNER_URL: 'http://signer.test', TRON_SIGNER_TOKEN: 'x'.repeat(40), TRONGRID_API_KEY: 'tron-grid-fixture',
  })
  const { pool, statements } = fakePool()
  const requests: Array<{ url: string; method: string; headers: Headers; body?: Record<string, unknown> }> = []
  const replies: string[] = []
  try {
    const result = await handleTelegramAdminActivation({
      ...baseOptions, pool: pool as never,
      fetcher: async (input, init) => {
        const request = new Request(input, init)
        requests.push({ url: request.url, method: request.method, headers: request.headers, body: request.method === 'POST' ? await request.json() as Record<string, unknown> : undefined })
        if (request.url.includes('/v1/accounts/')) return Response.json({ success: true, data: [] })
        return Response.json({ code: 200, data: { txid } })
      },
      sendMessage: async (_message, text) => { replies.push(text); return true },
    })
    assert.equal(result, 'replied')
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.method, 'GET')
    assert.equal(requests[0]?.headers.get('TRON-PRO-API-KEY'), 'tron-grid-fixture')
    assert.equal(requests[1]?.body?.operation, 'transfer_trx')
    assert.equal(requests[1]?.body?.amount, '1')
    assert.equal(requests[1]?.body?.to_address, address)
    assert.equal(requests[1]?.body?.private_key_ciphertext, 'ciphertext-fixture')
    assert.equal(requests[1]?.headers.get('authorization'), `Bearer ${'x'.repeat(40)}`)
    assert.ok(statements.some(({ sql, values }) => sql.startsWith('INSERT INTO t_platform_telegram_address_activation') && values?.[0] === 90))
    assert.ok(statements.some(({ sql, values }) => sql.includes("state='succeeded'") && values?.[1] === txid))
    assert.match(replies[0]!, /激活成功/)
  } finally { restore() }
})

test('a reserved or completed address is never signed a second time', async () => {
  const restore = restoreEnv(['PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS','APP_ENV','TRON_SIGNER_URL','TRON_SIGNER_TOKEN'])
  Object.assign(process.env, { PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS: 'true', APP_ENV: 'development', TRON_SIGNER_URL: 'http://signer.test', TRON_SIGNER_TOKEN: 'x'.repeat(40) })
  const { pool } = fakePool({ reservation: false, state: 'succeeded' })
  let signerCalls = 0
  const replies: string[] = []
  try {
    const result = await handleTelegramAdminActivation({
      ...baseOptions, updateRid: 91, pool: pool as never,
      fetcher: async (input) => {
        if (String(input).includes('/v1/accounts/')) return Response.json({ success: true, data: [] })
        signerCalls++
        return Response.json({ code: 200, data: { txid } })
      },
      sendMessage: async (_message, text) => { replies.push(text); return true },
    })
    assert.equal(result, 'replied')
    assert.equal(signerCalls, 0)
    assert.match(replies[0]!, /已成功提交/)
  } finally { restore() }
})


test('only original private activation commands are claimable', async () => {
  const statements: string[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    return { rows: [{ claimable: !sql.includes('edited_message') }], rowCount: 1 }
  } }
  const update = { message: { message_id: 10, chat: { id: 123, type: 'private' }, from: { id: 123 }, text: `激活地址${address}` } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, update), true)
  assert.ok(statements.some(sql => sql.includes("trim(COALESCE(u.update_body #>> '{message,text}','')) LIKE '激活地址%'")))
  statements.length = 0
  const edited = { edited_message: { message_id: 10, chat: { id: 123, type: 'private' }, from: { id: 123 }, text: `激活地址${address}` } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, edited), false)
  const editedSql = statements.find(sql => sql.includes('edited_message')) ?? ''
  assert.ok(editedSql.includes('AND NOT ('))
  assert.ok(editedSql.includes("LIKE '激活地址%'"))
})
