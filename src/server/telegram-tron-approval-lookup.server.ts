import type { Pool } from 'pg'
import { isTronAddress } from './telegram-address-lookup.server'

type Database = Pick<Pool, 'query'>
type Fetcher = typeof fetch
type Json = Record<string, any>

const TRONSCAN = 'https://apilist.tronscanapi.com'

function escapeHtml(value: unknown, max = 80) {
  return String(value ?? '').slice(0, max).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function apiKeys(raw: unknown) {
  try {
    let value: unknown = raw
    if (typeof value === 'string') value = JSON.parse(value)
    if (typeof value === 'string') value = JSON.parse(value)
    const keys = value && typeof value === 'object' ? (value as Json).keys : ''
    return String(keys ?? '').split(/[,，\r\n]+/u).map(key => key.trim()).filter(Boolean).slice(0, 20)
  } catch { return [] }
}

function amount(raw: unknown) {
  const value = String(raw ?? '')
  if (!/^\d{1,80}$/u.test(value)) return '0'
  const digits = value.padStart(7, '0')
  const whole = digits.slice(0, -6) || '0'
  const fraction = digits.slice(-6).replace(/0+$/u, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function dateText(raw: unknown) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).format(date).replace('T', ' ')
}

function chunks(header: string, entries: string[]) {
  const result: string[] = []
  let current = header
  for (const entry of entries) {
    if (current.length + entry.length + 2 > 3600 && current !== header) {
      result.push(current)
      current = header + '\n（续）'
    }
    current += `\n\n${entry}`
  }
  result.push(current)
  return result
}

export async function lookupTronApprovals(options: { pool: Database; fetcher?: Fetcher; address: string; queriedAt?: Date }) {
  const { pool, address } = options
  if (!isTronAddress(address)) throw new Error('tron_address_invalid')
  const configured = await pool.query<{ config_val: unknown }>("SELECT config_val FROM t_sys_config WHERE config_key='tronscan_api_keys' ORDER BY rid DESC LIMIT 1")
  const keys = apiKeys(configured.rows[0]?.config_val)
  const url = new URL('/api/account/approve/list', TRONSCAN)
  for (const [key, value] of Object.entries({ address, limit: '50', start: '0', type: 'project' })) url.searchParams.set(key, value)
  const apiKey = keys.length ? keys[Math.floor(Math.random() * keys.length)] : undefined
  const response = await (options.fetcher ?? fetch)(url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', ...(apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}) },
  })
  if (!response.ok) throw new Error('tronscan_approval_http_error')
  const body = await response.json() as Json
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isFinite(Number(body.total)) || Number(body.total) < 0) throw new Error('tronscan_approval_response_invalid')
  const total = Math.floor(Number(body.total))
  const approvals = Array.isArray(body.data) ? body.data.slice(0, 20) as Json[] : []
  const contracts = body.contractMap && typeof body.contractMap === 'object' ? body.contractMap as Record<string, unknown> : {}
  const entries = approvals.map((item, index) => {
    const toAddress = isTronAddress(String(item?.to_address ?? '')) ? String(item.to_address) : '-'
    const contractAddress = isTronAddress(String(item?.contract_address ?? '')) ? String(item.contract_address) : '-'
    const project = escapeHtml(item?.project?.name || '无')
    const token = escapeHtml(item?.tokenInfo?.tokenAbbr || '未知', 24)
    const approved = item?.unlimited === true ? '无限授权' : amount(item?.amount)
    const addressType = contracts[String(item?.to_address ?? '')] ? '合约地址' : '个人地址'
    return `授权 ${index + 1} · ${addressType}\n项目：<b>${project}</b>\n授权地址：<code>${toAddress}</code>\n合约：<code>${contractAddress}</code> · ${token}\n额度：<code>${approved}</code> · ${dateText(item?.operate_time)}`
  })
  const queriedAt = options.queriedAt ?? new Date()
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).format(queriedAt).replace('T', ' ')
  const header = `查询地址：<code>${address}</code>\n查询时间：${time}\n查询结果：${total > 0 ? `当前地址有 <b>${total}</b> 个授权` : '恭喜，地址没有授权！'}${total > approvals.length ? `（仅展示前${Math.min(total, 20)}个）` : ''}`
  const messages = chunks(header, entries)
  return {
    messages,
    replyMarkup: { inline_keyboard: [[{ text: '波场链上查询', url: `https://tronscan.org/#/address/${address}` }]] },
  }
}
