import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { lookupTronApprovals } from './telegram-tron-approval-lookup.server'

const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'

test('TRON approval lookup uses the configured read-only provider, escapes labels, and splits results safely', async () => {
  const statements: string[] = [], requests: Array<{ url: URL; headers: Headers }> = []
  const pool = { query: async (sql: string) => { statements.push(sql); return { rows: [{ config_val: JSON.stringify({ keys: 'key-a,key-b' }) }], rowCount: 1 } } } as unknown as Pick<Pool, 'query'>
  const data = Array.from({ length: 20 }, (_, index) => ({
    to_address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', contract_address: address,
    operate_time: 1793232000000, tokenInfo: { tokenAbbr: 'USDT' }, project: { name: index ? 'Safe wallet' : '<script>alert(1)</script>' },
    unlimited: false, amount: '1234567',
  }))
  const result = await lookupTronApprovals({ pool, address, queriedAt: new Date('2026-10-29T00:00:00Z'), fetcher: async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
    return Response.json({ total: 22, contractMap: { 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE': true }, data })
  } })
  assert.equal(statements.length, 1)
  assert.equal(requests[0].url.origin, 'https://apilist.tronscanapi.com')
  assert.equal(requests[0].url.pathname, '/api/account/approve/list')
  assert.equal(requests[0].url.searchParams.get('address'), address)
  assert.equal(requests[0].url.searchParams.get('limit'), '50')
  assert.ok(['key-a', 'key-b'].includes(requests[0].headers.get('TRON-PRO-API-KEY')!))
  assert.match(result.messages[0], /当前地址有 <b>22<\/b> 个授权/)
  assert.match(result.messages[0], /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(result.messages.join('\n'), /1\.234567/)
  assert.ok(result.messages.length > 1)
  assert.ok(result.messages.every(message => message.length <= 3600))
  assert.equal(result.replyMarkup.inline_keyboard[0][0].url, `https://tronscan.org/#/address/${address}`)
})

test('TRON approval lookup rejects invalid address and malformed provider response', async () => {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pick<Pool, 'query'>
  await assert.rejects(lookupTronApprovals({ pool, address: 'T0' + address.slice(2), fetcher: async () => { throw new Error('must not fetch') } }), /tron_address_invalid/)
  await assert.rejects(lookupTronApprovals({ pool, address, fetcher: async () => Response.json({ total: -1 }) }), /tronscan_approval_response_invalid/)
})
