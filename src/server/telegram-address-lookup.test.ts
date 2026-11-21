import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { isTronAddress, lookupTronAddress, lookupTronTransfers, parseTronHistoryCallback } from './telegram-address-lookup.server'

const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
function pool(values: Record<string, unknown> = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  return {
    calls,
    db: { query: async (sql: string, parameters?: unknown[]) => {
      calls.push({ sql, values: parameters })
      return { rows: [{ config_val: values[String(parameters?.[0])] ?? null }], rowCount: values[String(parameters?.[0])] == null ? 0 : 1 }
    } } as unknown as Pick<Pool, 'query'>,
  }
}

test('accepts only 34-character TRON base58 addresses and exact callback payloads', () => {
  assert.equal(isTronAddress(address), true)
  assert.equal(isTronAddress('T0' + address.slice(2)), false)
  assert.equal(isTronAddress(address + 'x'), false)
  assert.deepEqual(parseTronHistoryCallback('searchusdtlistout' + address), { kind: 'searchusdtlistout', address })
  assert.equal(parseTronHistoryCallback('searchusdtlistout' + address + 'x'), null)
  assert.equal(parseTronHistoryCallback('searchusdtlistout' + 'T00000000000000000000000000000000'), null)
})

test('TRON address balance uses read-only TronScan calls and creates compatible follow-up buttons', async () => {
  const fixture = pool({ tronscan_api_keys: JSON.stringify({ keys: 'tron-test-key' }) })
  const requests: Array<{ url: URL; method?: string; headers: Headers }> = []
  const result = await lookupTronAddress({ pool: fixture.db, address, botUsername: '@sample_bot', queriedAt: new Date('2026-10-29T00:00:00Z'), fetcher: async (input, init) => {
    requests.push({ url: new URL(String(input)), method: init?.method, headers: new Headers(init?.headers) })
    const url = new URL(String(input))
    if (url.pathname === '/api/accountv2') return Response.json({ balance: '123456789', activated: true, withPriceTokens: [{ tokenId: '_', amount: '123.456789' }, { tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', balance: '9876543', tokenDecimal: 6 }], transactions: 8, transactions_in: 4, transactions_out: 4, totalTransactionCount: 9, bandwidth: { freeNetRemaining: 1, netRemaining: 2, freeNetLimit: 3, netLimit: 4, energyRemaining: 5, energyLimit: 6 }, date_created: 0, latest_operation_time: 0, ownerPermission: { threshold: 1, keys: [{ address, weight: 1 }] }, activePermissions: [] })
    throw new Error('unexpected query')
  } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url.origin, 'https://apilist.tronscanapi.com')
  assert.equal(requests[0].url.pathname, '/api/accountv2')
  assert.equal(requests[0].method ?? 'GET', 'GET')
  assert.equal(requests[0].headers.get('TRON-PRO-API-KEY'), 'tron-test-key')
  assert.match(result.text, /TRX余额：<code>123\.456789<\/code>/)
  assert.match(result.text, /USDT余额：<code>9\.876543<\/code>/)
  assert.match(result.text, /所有权限/)
  assert.equal(result.replyMarkup.inline_keyboard[0][2].url, 'https://t.me/sample_bot')
  assert.equal(result.replyMarkup.inline_keyboard[1][1].callback_data, `searchusdtlistall${address}`)
})

test('TRON address lookup falls back to TronGrid when the account endpoint fails', async () => {
  const fixture = pool({ trongrid_api_keys: JSON.stringify({ keys: 'grid-test-key' }) })
  const requests: URL[] = []
  const result = await lookupTronAddress({ pool: fixture.db, address, fetcher: async (input, init) => {
    const url = new URL(String(input)); requests.push(url)
    assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'grid-test-key')
    if (url.hostname === 'apilist.tronscanapi.com') return new Response('unavailable', { status: 503 })
    return Response.json({ data: [{ balance: '5000000', trc20: [{ 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': '2500000' }], create_time: 0, latest_opration_time: 0 }] })
  } })
  assert.deepEqual(requests.map(url => url.hostname), ['apilist.tronscanapi.com', 'api.trongrid.io'])
  assert.match(result.text, /TRX余额：<code>5<\/code>/)
  assert.match(result.text, /USDT余额：<code>2\.5<\/code>/)
})

test('TRON frozen balance adds large SUN integer fields without floating point loss', async () => {
  const fixture = pool()
  const result = await lookupTronAddress({ pool: fixture.db, address, fetcher: async () => Response.json({
    balance: '0', activated: true, totalFrozen: '9007199254740993', totalFrozenV2: '1',
    withPriceTokens: [], bandwidth: {},
  }) })
  assert.match(result.text, /本人 9007199254\.740994 TRX/)
})

test('USDT/TRX history buttons return the selected ten-item filter and reject malformed provider addresses', async () => {
  const fixture = pool()
  const calls: URL[] = []
  const result = await lookupTronTransfers({ pool: fixture.db, address, kind: 'searchusdtlistain', queriedAt: new Date('2026-10-29T00:00:00Z'), fetcher: async input => {
    const url = new URL(String(input)); calls.push(url)
    return Response.json({ token_transfers: [
      { from_address: '<script>', to_address: address, quant: '9000000', block_ts: 1793232000000 },
      { from_address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', to_address: address, quant: '1234567', block_ts: 1793232000000 },
    ] })
  } })
  assert.equal(calls[0].pathname, '/api/new/filter/trc20/transfers')
  assert.equal(calls[0].searchParams.get('toAddress'), address)
  assert.equal(calls[0].searchParams.get('relatedAddress'), address)
  assert.match(result.text, /\+1\.234567 USDT/)
  assert.doesNotMatch(result.text, /<script>/)
  assert.equal(result.replyMarkup.inline_keyboard[1][0].callback_data, `searchusdtlistain${address}`)

  const trx = await lookupTronTransfers({ pool: fixture.db, address, kind: 'searchtrxalistout', fetcher: async input => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('fromAddress'), address)
    return Response.json({ data: [{ transferFromAddress: address, transferToAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', amount: '3000000', timestamp: 1793232000000 }] })
  } })
  assert.match(trx.text, /-3 TRX/)
})

