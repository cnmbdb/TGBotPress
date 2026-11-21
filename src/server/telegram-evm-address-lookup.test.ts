import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { isEvmAddress, lookupEvmAddress } from './telegram-evm-address-lookup.server'

const address = '0x52908400098527886E0F7030069857D2E4169EE7'

function database(url: unknown = null) {
  const calls: string[] = []
  return {
    calls,
    pool: { query: async (sql: string) => { calls.push(sql); return { rows: [{ config_val: url }], rowCount: url ? 1 : 0 } } } as unknown as Pick<Pool, 'query'>,
  }
}

test('accepts only exact EVM hexadecimal address strings', () => {
  assert.equal(isEvmAddress(address), true)
  assert.equal(isEvmAddress(address.slice(0, -1)), false)
  assert.equal(isEvmAddress(address.replace('0x', '0X')), true)
  assert.equal(isEvmAddress(address + '0'), false)
})

test('queries the configured API service with a read-only address request and renders all chain balances', async () => {
  const previous = process.env.API_WEB_URL
  delete process.env.API_WEB_URL
  const fixture = database(JSON.stringify({ url: 'https://api.example.test/base/' }))
  let requestedUrl = '', requestBody: unknown, telegramToken: string | null = null
  try {
    const result = await lookupEvmAddress({ pool: fixture.pool, address, queriedAt: new Date('2026-10-29T00:01:02Z'), fetcher: async (input, init) => {
      requestedUrl = String(input)
      assert.equal(init?.method, 'POST')
      requestBody = JSON.parse(String(init?.body))
      telegramToken = new Headers(init?.headers).get('Authorization')
      return Response.json({ code: 200, data: { ethbalance: '1.250000', ethusdtbalance: '2.00', bnbbalance: '3', bnbusdtbalance: '4', okxbalance: '5', okxusdtbalance: '6' } })
    } })
    assert.equal(requestedUrl, 'https://api.example.test/api/erc/addressgetbalance')
    assert.deepEqual(requestBody, { address })
    assert.equal(telegramToken, null)
    assert.match(result.text, /以太 ETH 余额：<b>1\.25<\/b>/)
    assert.match(result.text, /币安 BNB 余额：<b>3<\/b>/)
    assert.match(result.text, /欧易 USDT 余额：<b>6<\/b>/)
    assert.equal(result.replyMarkup.inline_keyboard[0][0].url, `https://etherscan.io/address/${address}`)
    assert.equal(fixture.calls.length, 1)
  } finally {
    if (previous === undefined) delete process.env.API_WEB_URL
    else process.env.API_WEB_URL = previous
  }
})

test('uses only safe service origins and rejects malformed provider results', async () => {
  const previous = process.env.API_WEB_URL
  try {
    process.env.API_WEB_URL = 'http://169.254.169.254'
    await assert.rejects(lookupEvmAddress({ pool: database().pool, address, fetcher: async () => { throw new Error('must not fetch') } }), /api_web_url_must_use_https/)
    process.env.API_WEB_URL = 'https://api.example.test'
    await assert.rejects(lookupEvmAddress({ pool: database().pool, address, fetcher: async () => Response.json({ code: 500 }) }), /evm_balance_provider_response_invalid/)
  } finally {
    if (previous === undefined) delete process.env.API_WEB_URL
    else process.env.API_WEB_URL = previous
  }
})
