import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type Fetcher = typeof fetch
type Json = Record<string, any>

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TRONSCAN = 'https://apilist.tronscanapi.com'
const TRONGRID = 'https://api.trongrid.io'
const historyKinds = new Set(['searchusdtlistall', 'searchusdtlistain', 'searchusdtlistout', 'searchtrxalistall', 'searchtrxalistain', 'searchtrxalistout'])

export function isTronAddress(value: string) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(value)
}

export function parseTronHistoryCallback(value: string) {
  const kind = value.slice(0, 17)
  const address = value.slice(17)
  return value.length === 51 && historyKinds.has(kind) && isTronAddress(address) ? { kind, address } : null
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function formatUnits(raw: unknown, decimals: number) {
  const value = String(raw ?? '')
  if (!/^\d{1,80}$/u.test(value)) return '0'
  const digits = value.padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals) || '0'
  const fraction = digits.slice(-decimals).replace(/0+$/u, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function sumIntegerUnits(left: unknown, right: unknown) {
  const integer = (value: unknown) => {
    const normalized = String(value ?? '0')
    return /^\d{1,80}$/u.test(normalized) ? BigInt(normalized) : 0n
  }
  return (integer(left) + integer(right)).toString()
}

function formatDecimal(raw: unknown) {
  const value = String(raw ?? '').trim()
  if (!/^\d{1,40}(?:\.\d{1,24})?$/u.test(value)) return '0'
  const [whole, fraction = ''] = value.split('.')
  const normalizedFraction = fraction.replace(/0+$/u, '')
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole
}

function dateText(value: unknown, milliseconds = true) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '-'
  const date = new Date(milliseconds ? number : number * 1000)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).format(date).replace('T', ' ')
}

function storedKeys(raw: unknown) {
  try {
    let parsed: unknown = raw
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    const keys = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).keys : ''
    return String(keys ?? '').split(/[,，\r\n]+/u).map(item => item.trim()).filter(Boolean).slice(0, 20)
  } catch { return [] }
}

async function apiKeys(pool: Database, key: 'tronscan_api_keys' | 'trongrid_api_keys') {
  const result = await pool.query<{ config_val: unknown }>('SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid DESC LIMIT 1', [key])
  return storedKeys(result.rows[0]?.config_val)
}

async function requestJson(fetcher: Fetcher, url: URL, keys: string[]) {
  const key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : undefined
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) } })
  if (!response.ok) throw new Error('tron_provider_http_error')
  const body = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('tron_provider_invalid_json')
  return body as Json
}

function accountTokens(tokens: unknown[]) {
  let trx = '0', usdt = '0'
  for (const item of tokens) {
    if (!item || typeof item !== 'object') continue
    const token = item as Json
    if (token.tokenId === '_') trx = token.amount != null ? formatDecimal(token.amount) : formatUnits(token.balance, Number(token.tokenDecimal ?? 6))
    if (token.tokenId === USDT) usdt = token.balance != null ? formatUnits(token.balance, Number(token.tokenDecimal ?? 6)) : formatDecimal(token.amount)
  }
  return { trx, usdt }
}

function renderPermissions(text: string[], title: string, permission: Json | undefined, address: string) {
  if (!permission || typeof permission !== 'object') return
  const keys = Array.isArray(permission.keys) ? permission.keys : []
  text.push(`\n${title}（阈值 ${escapeHtml(permission.threshold)}）`)
  for (const item of keys.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Json
    text.push(`${String(entry.address) === address ? '本地址' : '其他地址'}：<code>${escapeHtml(entry.address)}</code>（权重 ${escapeHtml(entry.weight)}）`)
  }
}

function accountText(address: string, body: Json, source: 'tronscan' | 'trongrid', queriedAt: Date) {
  const lines = [`查询地址：<code>${address}</code>`, `查询时间：${dateText(queriedAt.getTime())}`]
  let trx = '0', usdt = '0', activated = false
  if (source === 'tronscan') {
    activated = body.activated === true
    if (Array.isArray(body.withPriceTokens)) ({ trx, usdt } = accountTokens(body.withPriceTokens))
    else trx = formatUnits(body.balance, 6)
    lines.push(`\n查询结果：<b>${activated ? '地址已激活' : '地址未激活'}</b>`, `TRX余额：<code>${trx}</code>`, `USDT余额：<code>${usdt}</code>`)
    lines.push(`转账次数：<b>${escapeHtml(body.transactions ?? 0)}（收 ${escapeHtml(body.transactions_in ?? 0)} / 付 ${escapeHtml(body.transactions_out ?? 0)}）</b>`, `交易次数：${escapeHtml(body.totalTransactionCount ?? 0)}`)
    lines.push(`质押冻结：本人 ${formatUnits(sumIntegerUnits(body.totalFrozen, body.totalFrozenV2), 6)} TRX · 他人 ${formatUnits(body.acquiredDelegatedFrozenV2BalanceForEnergy, 6)} TRX`)
    const bandwidth = body.bandwidth && typeof body.bandwidth === 'object' ? body.bandwidth as Json : {}
    lines.push(`剩余带宽：剩 ${escapeHtml((Number(bandwidth.freeNetRemaining) || 0) + (Number(bandwidth.netRemaining) || 0))} / 总 ${escapeHtml((Number(bandwidth.freeNetLimit) || 0) + (Number(bandwidth.netLimit) || 0))}`, `剩余能量：剩 ${escapeHtml(bandwidth.energyRemaining ?? 0)} / 总 ${escapeHtml(bandwidth.energyLimit ?? 0)}`)
    lines.push(`创建时间：${dateText(body.date_created)}`, `最后活跃：${dateText(body.latest_operation_time)}`)
    renderPermissions(lines, '🟠 所有权限', body.ownerPermission, address)
    for (const [index, permission] of (Array.isArray(body.activePermissions) ? body.activePermissions : []).slice(0, 20).entries()) {
      lines.push(`\n🔴 活跃权限 ${index + 1}：${escapeHtml(permission.permission_name ?? permission.type)} · ID ${escapeHtml(permission.id)} · 阈值 ${escapeHtml(permission.threshold)}`)
      renderPermissions(lines, '权限成员', permission, address)
    }
  } else {
    const account = Array.isArray(body.data) ? body.data[0] as Json | undefined : undefined
    activated = !!account
    const tokens = account?.trc20
    if (account) trx = formatUnits(account.balance, 6)
    if (Array.isArray(tokens)) {
      for (const item of tokens) if (item && typeof item === 'object' && USDT in item) { usdt = formatUnits((item as Json)[USDT], 6); break }
    }
    lines.push(`\n查询结果：<b>${activated ? '地址已激活' : '地址未激活'}</b>`, `TRX余额：<code>${trx}</code>`, `USDT余额：<code>${usdt}</code>`, `创建时间：${dateText(account?.create_time)}`, `最后活跃：${dateText(account?.latest_opration_time)}`)
    renderPermissions(lines, '🟠 所有权限', account?.owner_permission, address)
    for (const [index, permission] of (Array.isArray(account?.active_permission) ? account.active_permission : []).slice(0, 20).entries()) {
      lines.push(`\n🔴 活跃权限 ${index + 1}：${escapeHtml(permission.permission_name)} · ID ${escapeHtml(permission.id)} · 阈值 ${escapeHtml(permission.threshold)}`)
      renderPermissions(lines, '权限成员', permission, address)
    }
  }
  return lines.join('\n')
}

export async function lookupTronAddress(options: { pool: Database; fetcher?: Fetcher; address: string; botUsername?: string | null; queriedAt?: Date }) {
  const { pool, address } = options
  if (!isTronAddress(address)) throw new Error('tron_address_invalid')
  const fetcher = options.fetcher ?? fetch, queriedAt = options.queriedAt ?? new Date()
  const tronscanKeys = await apiKeys(pool, 'tronscan_api_keys')
  let body: Json, source: 'tronscan' | 'trongrid' = 'tronscan'
  try {
    const url = new URL('/api/accountv2', TRONSCAN); url.searchParams.set('address', address)
    body = await requestJson(fetcher, url, tronscanKeys)
    if (!Object.hasOwn(body, 'balance')) throw new Error('tron_account_not_available')
    if (Array.isArray(body.withPriceTokens) && !body.withPriceTokens.some((item: Json) => item?.tokenId === USDT)) {
      const tokenUrl = new URL('/api/account/tokens', TRONSCAN)
      for (const [key, value] of Object.entries({ address, start: '0', limit: '20', hidden: '0', show: '0', sortType: '0', sortBy: '0', token: 'USDT' })) tokenUrl.searchParams.set(key, value)
      try {
        const tokenBody = await requestJson(fetcher, tokenUrl, tronscanKeys)
        const tokens = Array.isArray(tokenBody.data) ? tokenBody.data : []
        if (tokens.some((item: Json) => item?.tokenId === USDT)) body.withPriceTokens.push(...tokens)
      } catch { /* token balance can safely display as zero if this optional query fails */ }
    }
  } catch {
    source = 'trongrid'
    const keys = await apiKeys(pool, 'trongrid_api_keys')
    const url = new URL('/v1/accounts/' + encodeURIComponent(address), TRONGRID)
    body = await requestJson(fetcher, url, keys)
  }
  const username = String(options.botUsername ?? '').replace(/^@/u, '')
  const keyboard = [
    [{ text: '链上查询', url: `https://tronscan.org/#/address/${address}` }, { text: '查授权', callback_data: `查授权${address}` }, ...(username ? [{ text: '关于机器人', url: `https://t.me/${encodeURIComponent(username)}` }] : [])],
    [{ text: '兑换TRX', callback_data: '兑换' }, { text: 'USDT记录', callback_data: `searchusdtlistall${address}` }, { text: 'TRX记录', callback_data: `searchtrxalistall${address}` }],
  ]
  return { text: accountText(address, body, source, queriedAt), replyMarkup: { inline_keyboard: keyboard }, source }
}

function direction(kind: string) { return kind.endsWith('ain') ? 'in' : kind.endsWith('out') ? 'out' : 'all' }

export async function lookupTronTransfers(options: { pool: Database; fetcher?: Fetcher; address: string; kind: string; queriedAt?: Date }) {
  const { pool, address, kind } = options
  const selected = parseTronHistoryCallback(kind + address)
  if (!selected) throw new Error('tron_history_filter_invalid')
  const fetcher = options.fetcher ?? fetch, keys = await apiKeys(pool, 'tronscan_api_keys'), filter = direction(kind)
  const isUsdt = kind.startsWith('searchusdt')
  const url = new URL(isUsdt ? '/api/new/filter/trc20/transfers' : '/api/new/trx/transfer', TRONSCAN)
  const common: Record<string, string> = { limit: '10', start: '0', sort: '-timestamp', count: 'true', filterTokenValue: '1' }
  if (isUsdt) common.contract_address = USDT
  else common.address = address
  if (filter === 'in') common.toAddress = address
  if (filter === 'out') common.fromAddress = address
  if (isUsdt) common.relatedAddress = address
  for (const [key, value] of Object.entries(common)) url.searchParams.set(key, value)
  let body: Json
  try { body = await requestJson(fetcher, url, keys) } catch { return { text: `查询地址：<code>${address}</code>\n查询时间：${dateText((options.queriedAt ?? new Date()).getTime())}\n查询结果：查询失败`, replyMarkup: { inline_keyboard: [] } } }
  const rows = isUsdt ? body.token_transfers : body.data
  const heading = `查询地址：<code>${address}</code>\n查询时间：${dateText((options.queriedAt ?? new Date()).getTime())}（仅查最近10笔，隐藏小额）`
  if (!Array.isArray(rows)) return { text: `${heading}\n查询结果：查询失败`, replyMarkup: { inline_keyboard: [] } }
  const entries = rows.slice(0, 10).flatMap((row: Json) => {
    const to = String(isUsdt ? row.to_address ?? '' : row.transferToAddress ?? '')
    const from = String(isUsdt ? row.from_address ?? '' : row.transferFromAddress ?? '')
    if (!isTronAddress(to) || !isTronAddress(from)) return []
    const raw = isUsdt ? row.quant : row.amount
    const amount = formatUnits(raw, 6)
    const timestamp = isUsdt ? row.block_ts : row.timestamp
    return [`—————————————\n${to === address ? '转出地址：' : '转入地址：'}<code>${to === address ? from : to}</code>\n交易金额：<b>${to === address ? '+' : '-'}${amount} ${isUsdt ? 'USDT' : 'TRX'}</b>\n交易时间：${dateText(timestamp)}`]
  })
  const text = entries.length ? `${heading}\n\n${entries.join('\n')}` : `${heading}\n查询结果：地址无交易记录`
  const usdt = isUsdt
  return { text, replyMarkup: { inline_keyboard: [[{ text: '链上查询', url: `https://tronscan.org/#/address/${address}` }, { text: usdt ? 'TRX记录' : 'USDT记录', callback_data: `${usdt ? 'searchtrxalistall' : 'searchusdtlistall'}${address}` }], [{ text: `仅看${usdt ? 'USDT' : 'TRX'}收入`, callback_data: `${usdt ? 'searchusdtlistain' : 'searchtrxalistain'}${address}` }, { text: `仅看${usdt ? 'USDT' : 'TRX'}支出`, callback_data: `${usdt ? 'searchusdtlistout' : 'searchtrxalistout'}${address}` }]] } }
}

