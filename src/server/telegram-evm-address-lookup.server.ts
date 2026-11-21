import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type Fetcher = typeof fetch
type Config = { url?: unknown }
type BalanceResponse = {
  code?: number
  data?: { ethbalance?: unknown; ethusdtbalance?: unknown; bnbbalance?: unknown; bnbusdtbalance?: unknown; okxbalance?: unknown; okxusdtbalance?: unknown }
}

const localHosts = new Set(['api-web', 'localhost', '127.0.0.1', '::1', 'host.docker.internal'])

export function isEvmAddress(value: string) {
  return /^0[xX][0-9a-fA-F]{40}$/u.test(value)
}

function configObject(raw: unknown): Config {
  try {
    let value: unknown = raw
    if (typeof value === 'string') value = JSON.parse(value)
    if (typeof value === 'string') value = JSON.parse(value)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Config : {}
  } catch { return {} }
}

function serviceOrigin(raw: string) {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('api_web_url_invalid') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('api_web_url_invalid')
  if (url.protocol !== 'https:' && !localHosts.has(url.hostname.toLowerCase())) throw new Error('api_web_url_must_use_https')
  return url.origin
}

function amount(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,40}(?:\.\d{1,24})?$/u.test(text)) return '0'
  const [whole, fraction = ''] = text.split('.')
  const cleanFraction = fraction.replace(/0+$/u, '')
  return cleanFraction ? `${whole}.${cleanFraction}` : whole
}

export async function lookupEvmAddress(options: { pool: Database; fetcher?: Fetcher; address: string; queriedAt?: Date }) {
  if (!isEvmAddress(options.address)) throw new Error('evm_address_invalid')
  const { pool, address } = options
  const configured = String(process.env.API_WEB_URL || '').trim()
  let rawBase = configured
  if (!rawBase) {
    const result = await pool.query<{ config_val: unknown }>("SELECT config_val FROM t_sys_config WHERE config_key='api_web_url' ORDER BY rid DESC LIMIT 1")
    rawBase = String(configObject(result.rows[0]?.config_val).url || '').trim()
  }
  if (!rawBase) throw new Error('api_web_url_missing')
  const endpoint = new URL('/api/erc/addressgetbalance', serviceOrigin(rawBase))
  const response = await (options.fetcher ?? fetch)(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!response.ok) throw new Error('evm_balance_provider_http_error')
  const body = await response.json() as BalanceResponse
  if (!body || body.code !== 200 || !body.data || typeof body.data !== 'object') throw new Error('evm_balance_provider_response_invalid')

  const data = body.data
  const text = [
    `查询：<code>${address}</code>`,
    `查询时间：${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).format(options.queriedAt ?? new Date()).replace('T', ' ')}`,
    '',
    '✅ 查询结果',
    `以太 ETH 余额：<b>${amount(data.ethbalance)}</b>`,
    `以太 USDT 余额：<b>${amount(data.ethusdtbalance)}</b>`,
    '',
    `币安 BNB 余额：<b>${amount(data.bnbbalance)}</b>`,
    `币安 USDT 余额：<b>${amount(data.bnbusdtbalance)}</b>`,
    '',
    `欧易 OKT 余额：<b>${amount(data.okxbalance)}</b>`,
    `欧易 USDT 余额：<b>${amount(data.okxusdtbalance)}</b>`,
  ].join('\n')
  return {
    text,
    replyMarkup: { inline_keyboard: [
      [{ text: '以太链上查询', url: `https://etherscan.io/address/${address}` }],
      [{ text: '币安链上查询', url: `https://bscscan.com/address/${address}` }],
      [{ text: '欧易链上查询', url: `https://www.oklink.com/cn/okc/address/${address}` }],
    ] },
  }
}
