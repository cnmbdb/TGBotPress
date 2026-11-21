import { createHash } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'
import { decodeTronAddress, parseMonitorBlock } from '@tgbotpress/plugin-monitor/block.js'

type Json = Record<string, unknown>
type Database = Pick<Pool, 'query' | 'connect'>
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
export type Monitor = {
  rid: number; bot_rid: number; bot_token: string; monitor_wallet: string; tg_notice_obj: string
  comments: string; monitor_trx_transaction: string; monitor_approve_transaction: string
  monitor_multi_transaction: string; monitor_pledge_transaction: string; monitor_usdt_transaction: string
}
type Block = { number: number; id: string; timestamp: number; transactions: Json[] }
type Notice = { wallet: Monitor; tx: string; type: number; html: string; keyboard: Json }
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const USDT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const validHex = (value: unknown, length: number) => typeof value === 'string' && new RegExp('^[a-fA-F0-9]{' + length + '}$').test(value)
const asDecimal = (raw: bigint, decimals = 6) => {
  const unit = 10n ** BigInt(decimals), whole = (raw / unit).toString()
  const fraction = (raw % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? whole + '.' + fraction : whole
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dateText = (milliseconds: number) => new Date(milliseconds).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })

export { decodeTronAddress } from '@tgbotpress/plugin-monitor/block.js'

function decodeAbiAddress(value: unknown) {
  if (typeof value !== 'string' || !validHex(value, 40)) return null
  return decodeTronAddress('41' + value)
}
export { parseMonitorBlock } from '@tgbotpress/plugin-monitor/block.js'

function flags(value: unknown, fallback = 'NN') { return typeof value === 'string' ? value.trimEnd().padEnd(2, 'N').slice(0, 2) : fallback }
function rawData(transaction: Json) {
  const raw = isObject(transaction.raw_data) ? transaction.raw_data : null
  const contracts = raw?.contract
  const contract = Array.isArray(contracts) ? contracts[0] : null
  return isObject(contract) && isObject(contract.parameter) && isObject(contract.parameter.value)
    ? { type: contract.type, value: contract.parameter.value }
    : null
}
async function requestJson(request: Fetcher, url: string, init: RequestInit = {}): Promise<Json> {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json', ...(init.headers ?? {}) } })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const payload = await response.json()
  if (!isObject(payload) || payload.Error || payload.error) throw new Error('invalid external JSON response')
  return payload
}
async function keysFromConfig(pool: Database, name: string, fallback: string) {
  try {
    const rows = await pool.query<{ config_val: unknown }>('SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid', [name])
    const values: string[] = []
    for (const row of rows.rows) {
      let parsed: unknown = row.config_val
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { /* use string value */ } }
      const raw = isObject(parsed) ? parsed.keys : parsed
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : []
      for (const value of list) if (String(value).trim()) values.push(String(value).trim())
    }
    if (values.length) return values
  } catch { /* local environment fallback */ }
  return fallback.split(/[\s,]+/).map(value => value.trim()).filter(Boolean)
}
function pickKey(keys: string[]) { return keys.length ? keys[Math.floor(Math.random() * keys.length)] : '' }
async function fetchBlock(request: Fetcher, key: string, number?: number) {
  const endpoint = number === undefined ? '/wallet/getnowblock' : '/wallet/getblockbynum'
  const body = number === undefined ? {} : { num: number }
  const payload = await requestJson(request, 'https://api.trongrid.io' + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
    body: JSON.stringify(body),
  })
  return parseMonitorBlock(payload, number)
}
async function loadMonitors(pool: Database): Promise<Monitor[]> {
  const column = await pool.query<{ present: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='t_monitor_wallet' AND column_name='monitor_usdt_transaction') AS present",
  )
  const usdtFlag = column.rows[0]?.present ? 'a.monitor_usdt_transaction' : "'YY'::varchar"
  const result = await pool.query<Monitor>(
    "SELECT a.rid,a.bot_rid,b.bot_token,a.monitor_wallet,COALESCE(a.tg_notice_obj,'') AS tg_notice_obj," +
    "COALESCE(a.comments,'') AS comments,COALESCE(a.monitor_trx_transaction,'NN') AS monitor_trx_transaction," +
    "COALESCE(a.monitor_approve_transaction,'NN') AS monitor_approve_transaction," +
    "COALESCE(a.monitor_multi_transaction,'NN') AS monitor_multi_transaction," +
    "COALESCE(a.monitor_pledge_transaction,'NN') AS monitor_pledge_transaction," +
    "COALESCE(" + usdtFlag + ",'YY') AS monitor_usdt_transaction " +
    "FROM t_monitor_wallet a JOIN t_telegram_bot b ON b.rid=a.bot_rid " +
    "WHERE a.status=0 AND a.chain_type='trc' AND a.monitor_wallet IS NOT NULL AND b.bot_token IS NOT NULL AND b.bot_token<>'' ORDER BY a.rid",
  )
  return result.rows
}
async function fetchBalance(request: Fetcher, address: string, scanKey: string, gridKey: string) {
  try {
    const data = await requestJson(request, 'https://apilist.tronscanapi.com/api/accountv2?address=' + encodeURIComponent(address), {
      headers: scanKey ? { 'TRON-PRO-API-KEY': scanKey } : {},
    })
    if (Array.isArray(data.withPriceTokens)) {
      const tokens = data.withPriceTokens.filter(isObject)
      const trx = tokens.find(token => token.tokenId === '_')
      const usdt = tokens.find(token => token.tokenId === USDT_ADDRESS)
      return (trx ? String(trx.amount ?? '0') : '0') + ' TRX，' + (usdt ? String(usdt.amount ?? '0') : '0') + ' USDT'
    }
  } catch { /* fall back to TronGrid */ }
  try {
    const data = await requestJson(request, 'https://api.trongrid.io/v1/accounts/' + encodeURIComponent(address), {
      headers: gridKey ? { 'TRON-PRO-API-KEY': gridKey } : {},
    })
    const accounts = Array.isArray(data.data) ? data.data.filter(isObject) : []
    if (!accounts.length) return '地址还未激活！'
    const account = accounts[0]
    let usdt = '0'
    if (Array.isArray(account.trc20)) {
      for (const entry of account.trc20.filter(isObject)) {
        if (typeof entry[USDT_ADDRESS] === 'string' || typeof entry[USDT_ADDRESS] === 'number') { usdt = asDecimal(BigInt(String(entry[USDT_ADDRESS]))); break }
      }
    }
    const trxRaw = typeof account.balance === 'string' || typeof account.balance === 'number' ? BigInt(String(account.balance)) : 0n
    return asDecimal(trxRaw) + ' TRX，' + usdt + ' USDT'
  } catch { return '未知' }
}
const keyboardFor = (tx: string): Json => ({ inline_keyboard: [[{ text: '查看交易', url: 'https://tronscan.io/#/transaction/' + tx }]] })
function statusText(transaction: Json) {
  const ret = Array.isArray(transaction.ret) && isObject(transaction.ret[0]) ? transaction.ret[0].contractRet : ''
  return ret === 'SUCCESS' ? '成功' : '失败' + (ret ? String(ret) : '（未知）')
}
function recipients(wallet: Monitor) { return wallet.tg_notice_obj.split(',').map(value => value.trim()).filter(Boolean) }
function commonHeader(wallet: Monitor, tx: string, block: Block) {
  return '监控钱包：<code>' + escapeHtml(wallet.monitor_wallet) + '</code>\n' +
    '监控钱包备注：' + escapeHtml(wallet.comments || '无') + '\n' +
    '交易时间：<code>' + dateText(block.timestamp) + '</code>\n' +
    '当前区块号：<code>' + block.number + '</code>\n当前交易哈希：<code>' + tx + '</code>'
}
function transactionType(type: number) {
  const labels: Record<number, string> = {
    1: '正常转账 ↓', 2: '正常转账 ↑', 3: '授权转账 ↓', 4: '授权转账 ↑',
    11: '给监控地址取消授权', 21: '监控地址给其他地址取消授权', 12: '给监控地址授权 ↓', 22: '监控地址给其他地址授权 ↑',
    5: '监控地址变更多签账户', 51: '其他地址变更监控地址为多签',
    6: '给监控地址代理质押 ↓', 61: '给监控地址回收质押 ↑', 7: '监控地址给其他地址代理质押 ↑', 71: '监控地址给其他地址回收质押 ↓',
  }
  return labels[type] ?? '其他'
}
async function makeNotice(request: Fetcher, wallet: Monitor, tx: string, type: number, from: string, to: string, contract: string, amount: string, block: Block, result: string, balanceCache: Map<string, Promise<string>>, scanKey: string, gridKey: string, extra = ''): Promise<Notice> {
  const common = commonHeader(wallet, tx, block)
  let html: string
  if (type === 5 || type === 51) {
    html = '监控钱包：<code>' + escapeHtml(wallet.monitor_wallet) + '</code>\n监控钱包备注：' + escapeHtml(wallet.comments || '无') +
      '\n变更钱包：<code>' + escapeHtml(from) + '</code>\n---------------------------------------\n交易类型：<b>' + transactionType(type) +
      '</b>\n交易结果：' + escapeHtml(result) + '\n' + extra + '\n---------------------------------------\n交易时间：<code>' + dateText(block.timestamp) +
      '</code>\n当前区块号：<code>' + block.number + '</code>\n当前交易哈希：<code>' + tx + '</code>'
  } else if ([6, 61, 7, 71].includes(type)) {
    html = common + '\n---------------------------------------\n交易类型：<b>' + transactionType(type) +
      '</b>\n交易结果：' + escapeHtml(result) + '\n代理资源：' + escapeHtml(contract) + '\n代理数量：' + escapeHtml(amount)
  } else if ([1, 2, 3, 4].includes(type)) {
    if (!balanceCache.has(wallet.monitor_wallet)) balanceCache.set(wallet.monitor_wallet, fetchBalance(request, wallet.monitor_wallet, scanKey, gridKey))
    const balance = await balanceCache.get(wallet.monitor_wallet) ?? Promise.resolve('未知')
    const incoming = type === 1 || type === 3, asset = contract === 'TRX' ? 'TRX' : 'USDT', sign = incoming ? '+' : '-'
    html = '监控钱包：<code>' + escapeHtml(wallet.monitor_wallet) + '</code>\n监控钱包备注：' + escapeHtml(wallet.comments || '无') +
      '\n---------------------------------------\n<b>' + (incoming ? '🟢收入' : '🔴支出') + asset + '提醒 ' + sign + amount + ' ' + asset +
      '</b>\n\n付款地址：<code>' + escapeHtml(from) + '</code>\n收款地址：<code>' + escapeHtml(to) + '</code>\n交易时间：<code>' + dateText(block.timestamp) +
      '</code>\n交易金额：<b>' + sign + amount + ' ' + asset + '</b>\n---------------------------------------\n账户余额：' + escapeHtml(await balance) +
      '\n交易结果：' + escapeHtml(result) + ' 类型：' + transactionType(type)
  } else {
    html = common + '\n---------------------------------------\n转出地址：<code>' + escapeHtml(from) + '</code>\n接收地址：<code>' + escapeHtml(to) +
      '</code>\n交易类型：<b>' + transactionType(type) + '</b>\n交易金额：<b>' + escapeHtml(amount) + '</b>\n交易结果：' + escapeHtml(result) +
      '\n---------------------------------------\n合约地址：<code>' + escapeHtml(contract) + '</code>'
  }
  return { wallet, tx, type, html, keyboard: keyboardFor(tx) }
}
function enabled(flag: unknown, index: 0 | 1) { return flags(flag)[index] === 'Y' }
function makeAliases(monitors: Monitor[]) {
  const map = new Map<string, Monitor>()
  for (const wallet of monitors) if (!map.has(wallet.monitor_wallet)) map.set(wallet.monitor_wallet, wallet)
  return map
}
export async function transactionNotices(request: Fetcher, block: Block, monitors: Monitor[], scanKey: string, gridKey: string): Promise<Notice[]> {
  const wallets = makeAliases(monitors), cache = new Map<string, Promise<string>>(), result: Notice[] = []
  for (const transaction of block.transactions) {
    const tx = transaction.txID
    if (typeof tx !== 'string' || !validHex(tx, 64)) continue
    const parsed = rawData(transaction)
    if (!parsed) continue
    const value = parsed.value, contractType = String(parsed.type ?? ''), contractResult = statusText(transaction)
    const emit = async (wallet: Monitor | undefined, type: number, from: string, to: string, contract: string, amount: string, extra = '') => {
      if (wallet) result.push(await makeNotice(request, wallet, tx, type, from, to, contract, amount, block, contractResult, cache, scanKey, gridKey, extra))
    }
    if (contractType === 'TransferContract') {
      const to = decodeTronAddress(value.to_address), from = decodeTronAddress(value.owner_address)
      const raw = value.amount
      if (!to || !from || !/^\d{1,100}$/.test(String(raw ?? ''))) continue
      const amount = asDecimal(BigInt(String(raw)))
      if (BigInt(String(raw)) < 10_000n) continue
      const recipient = wallets.get(to), sender = wallets.get(from)
      if (recipient && enabled(recipient.monitor_trx_transaction, 0)) await emit(recipient, 1, from, to, 'TRX', amount)
      if (sender && enabled(sender.monitor_trx_transaction, 1)) await emit(sender, 2, from, to, 'TRX', amount)
      continue
    }
    if (contractType === 'DelegateResourceContract' || contractType === 'UnDelegateResourceContract') {
      const to = decodeTronAddress(value.receiver_address), from = decodeTronAddress(value.owner_address)
      const raw = value.balance, resource = String(value.resource ?? ' ')
      if (!to || !from || !/^\d{1,100}$/.test(String(raw ?? '')) || BigInt(String(raw)) <= 0n) continue
      const amount = asDecimal(BigInt(String(raw))), delegate = contractType === 'DelegateResourceContract'
      const recipient = wallets.get(to), sender = wallets.get(from)
      if (recipient && enabled(recipient.monitor_pledge_transaction, delegate ? 0 : 1)) await emit(recipient, delegate ? 6 : 61, from, to, resource, amount)
      if (sender && enabled(sender.monitor_pledge_transaction, delegate ? 0 : 1)) await emit(sender, delegate ? 7 : 71, from, to, resource, amount)
      continue
    }
    if (contractType === 'AccountPermissionUpdateContract') {
      const from = decodeTronAddress(value.owner_address)
      if (!from) continue
      const touched = new Map<number, { wallet: Monitor; direct: boolean; text: string[] }>()
      const direct = wallets.get(from)
      if (direct) touched.set(direct.rid, { wallet: direct, direct: true, text: [] })
      const scan = (permission: unknown, title: string) => {
        if (!isObject(permission) || !Array.isArray(permission.keys)) return
        const lines = ['\n' + title + '-阈值：' + escapeHtml(permission.threshold ?? '')]
        for (const key of permission.keys.filter(isObject)) {
          const address = decodeTronAddress(key.address)
          const monitor = address ? wallets.get(address) : undefined
          lines.push('地址：<code>' + escapeHtml(address ?? String(key.address ?? '')) + '</code> (权重：' + escapeHtml(key.weight ?? '') + ')')
          if (monitor) {
            const entry = touched.get(monitor.rid) ?? { wallet: monitor, direct: false, text: [] }
            entry.text.push(...lines.slice(0, 1), lines[lines.length - 1])
            touched.set(monitor.rid, entry)
          }
        }
      }
      scan(value.owner, '所有权限')
      if (Array.isArray(value.actives)) value.actives.forEach((entry, index) => {
        if (isObject(entry)) scan(entry, '活跃权限-' + String(entry.permission_name ?? entry.type ?? index + 1))
      })
      for (const item of touched.values()) {
        const type = item.direct ? 5 : 51
        if (!enabled(item.wallet.monitor_multi_transaction, item.direct ? 0 : 1)) continue
        await emit(item.wallet, type, from, '', item.text.join('\n'), '0', item.text.join('\n'))
      }
      continue
    }
    if (contractType !== 'TriggerSmartContract' || value.contract_address !== USDT_HEX || typeof value.data !== 'string') continue
    const data = value.data.toLowerCase(), selector = data.slice(0, 8), owner = decodeTronAddress(value.owner_address)
    if (!owner) continue
    if (['a9059cbb', 'd73dd623', '095ea7b3'].includes(selector) && validHex(data.slice(8), 128)) {
      const to = decodeAbiAddress(data.slice(32, 72)), rawAmount = BigInt('0x' + data.slice(72, 136))
      if (!to) continue
      const amount = asDecimal(rawAmount), recipient = wallets.get(to), sender = wallets.get(owner)
      const normal = selector === 'a9059cbb'
      if (recipient && (normal ? rawAmount >= 10_000n && enabled(recipient.monitor_usdt_transaction, 0) : enabled(recipient.monitor_approve_transaction, rawAmount === 0n ? 1 : 0))) {
        await emit(recipient, normal ? 1 : rawAmount === 0n ? 11 : 12, owner, to, USDT_ADDRESS, amount)
      }
      if (sender && (normal ? rawAmount >= 10_000n && enabled(sender.monitor_usdt_transaction, 1) : enabled(sender.monitor_approve_transaction, rawAmount === 0n ? 1 : 0))) {
        await emit(sender, normal ? 2 : rawAmount === 0n ? 21 : 22, owner, to, USDT_ADDRESS, amount)
      }
      continue
    }
    if (selector === '23b872dd' && validHex(data.slice(8), 192)) {
      const from = decodeAbiAddress(data.slice(32, 72)), to = decodeAbiAddress(data.slice(96, 136)), rawAmount = BigInt('0x' + data.slice(136, 200))
      if (!from || !to || rawAmount < 10_000n) continue
      const amount = asDecimal(rawAmount), recipient = wallets.get(to), sender = wallets.get(from)
      if (recipient && enabled(recipient.monitor_usdt_transaction, 0)) await emit(recipient, 3, from, to, USDT_ADDRESS, amount)
      if (sender && enabled(sender.monitor_usdt_transaction, 1)) await emit(sender, 4, from, to, USDT_ADDRESS, amount)
    }
  }
  return result
}
async function insertNotices(client: PoolClient, notices: Notice[]) {
  let count = 0
  for (const notice of notices) {
    for (const chat of recipients(notice.wallet)) {
      const inserted = await client.query(
        "INSERT INTO t_platform_monitor_wallet_notification(monitor_wallet_rid,bot_rid,tx_hash,notification_type,chat_id,payload,reply_markup) " +
        "VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(monitor_wallet_rid,tx_hash,notification_type,chat_id) DO NOTHING",
        [notice.wallet.rid, notice.wallet.bot_rid, notice.tx.toLowerCase(), String(notice.type), chat, notice.html, JSON.stringify(notice.keyboard)],
      )
      if (inserted.rowCount) count++
    }
  }
  return count
}
function skipped(block?: number) { return { block, queued: 0, skipped: true } }

export async function syncMonitorWalletCurrentBlock(options: {
  pool?: Database; request?: Fetcher; logger?: Pick<Console, 'error'>; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const active = options.enabled ?? process.env.PLATFORM_MONITOR_WALLET_ENABLED === 'true'
  const keepGoing = options.shouldContinue ?? (() => true)
  if (!active || !keepGoing()) return skipped()
  const pool = options.pool ?? db, request = options.request ?? fetch, logger = options.logger ?? console, now = options.now ?? (() => new Date())
  try {
    const monitors = await loadMonitors(pool)
    if (!monitors.length) return skipped()
    const gridKey = pickKey(await keysFromConfig(pool, 'trongrid_api_keys', String(process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY ?? '')))
    const scanKey = pickKey(await keysFromConfig(pool, 'tronscan_api_keys', String(process.env.TRONSCAN_API_KEYS ?? process.env.TRONSCAN_API_KEY ?? '')))
    const block = await fetchBlock(request, gridKey)
    if (!keepGoing()) return skipped(block.number)
    const notices = await transactionNotices(request, block, monitors, scanKey, gridKey)
    if (!keepGoing()) return skipped(block.number)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-monitor-wallet-block-cursor'))")
      const state = await client.query<{ latest_block: string; latest_block_id: string }>(
        "SELECT latest_block::text,latest_block_id FROM t_platform_monitor_wallet_block_cursor WHERE cursor_key='monitor-wallet' FOR UPDATE",
      )
      const previous = state.rows[0]?.latest_block ? BigInt(state.rows[0].latest_block) : null
      if (previous !== null && (BigInt(block.number) < previous || (BigInt(block.number) === previous && state.rows[0].latest_block_id === block.id))) {
        await client.query('COMMIT')
        return skipped(block.number)
      }
      let missedQueued = 0
      if (previous !== null && BigInt(block.number) > previous + 1n) {
        const pending = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM t_platform_monitor_wallet_missed_block WHERE status IN ('pending','processing')",
        )
        const available = Math.max(0, 20 - Number(pending.rows[0]?.count ?? 0))
        for (let number = previous + 1n; number < BigInt(block.number) && missedQueued < available; number++, missedQueued++) {
          await client.query('INSERT INTO t_platform_monitor_wallet_missed_block(block_number) VALUES($1) ON CONFLICT(block_number) DO NOTHING', [number.toString()])
        }
      }
      if (!keepGoing()) { await client.query('ROLLBACK'); return skipped(block.number) }
      const queued = await insertNotices(client, notices)
      await client.query(
        "INSERT INTO t_platform_monitor_wallet_block_cursor(cursor_key,latest_block,latest_block_id,updated_at) VALUES('monitor-wallet',$1,$2,$3) " +
        "ON CONFLICT(cursor_key) DO UPDATE SET latest_block=EXCLUDED.latest_block,latest_block_id=EXCLUDED.latest_block_id,updated_at=EXCLUDED.updated_at",
        [block.number, block.id, now()],
      )
      await client.query('COMMIT')
      return { block: block.number, queued, missedQueued, skipped: false }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  } catch (error) {
    logger.error('Monitor wallet current block failed: ' + (error instanceof Error ? error.message : 'provider or database error'))
    throw error
  }
}

export async function syncMonitorWalletMissedBlock(options: {
  pool?: Database; request?: Fetcher; logger?: Pick<Console, 'error'>; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date
} = {}) {
  const active = options.enabled ?? process.env.PLATFORM_MONITOR_WALLET_ENABLED === 'true'
  const keepGoing = options.shouldContinue ?? (() => true)
  if (!active || !keepGoing()) return skipped()
  const pool = options.pool ?? db, request = options.request ?? fetch, logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const monitors = await loadMonitors(pool)
  if (!monitors.length) return skipped()
  const gridKey = pickKey(await keysFromConfig(pool, 'trongrid_api_keys', String(process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY ?? '')))
  const scanKey = pickKey(await keysFromConfig(pool, 'tronscan_api_keys', String(process.env.TRONSCAN_API_KEYS ?? process.env.TRONSCAN_API_KEY ?? '')))
  const client = await pool.connect()
  let number: number | undefined, attempt = 0
  try {
    await client.query('BEGIN')
    const claimed = await client.query<{ block_number: string; attempts: number }>(
      "SELECT block_number::text,attempts FROM t_platform_monitor_wallet_missed_block " +
      "WHERE (status='pending' AND next_attempt_at<=$1) OR (status='processing' AND locked_until<$1) " +
      'ORDER BY block_number LIMIT 1 FOR UPDATE SKIP LOCKED', [now()],
    )
    if (!claimed.rowCount) { await client.query('COMMIT'); return skipped() }
    number = Number(claimed.rows[0].block_number)
    attempt = Number(claimed.rows[0].attempts) + 1
    await client.query(
      "UPDATE t_platform_monitor_wallet_missed_block SET status='processing',attempts=$2,locked_until=$3,updated_at=$4 WHERE block_number=$1",
      [number, attempt, new Date(now().getTime() + 30_000), now()],
    )
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  try {
    const block = await fetchBlock(request, gridKey, number)
    if (!keepGoing()) {
      await client.query("UPDATE t_platform_monitor_wallet_missed_block SET status='pending',locked_until=NULL,next_attempt_at=$2,updated_at=$2 WHERE block_number=$1", [number, now()])
      return skipped(number)
    }
    const notices = await transactionNotices(request, block, monitors, scanKey, gridKey)
    await client.query('BEGIN')
    const queued = await insertNotices(client, notices)
    await client.query('DELETE FROM t_platform_monitor_wallet_missed_block WHERE block_number=$1', [number])
    await client.query('COMMIT')
    return { block: number, queued, skipped: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const delay = Math.min(60, Math.max(2, 2 ** Math.min(attempt, 6)))
    await client.query(
      "UPDATE t_platform_monitor_wallet_missed_block SET status='pending',locked_until=NULL,next_attempt_at=$2,last_error=$3,updated_at=$4 WHERE block_number=$1",
      [number, new Date(now().getTime() + delay * 1000), error instanceof Error ? error.message.slice(0, 500) : 'provider or database error', now()],
    ).catch(() => {})
    logger.error('Monitor wallet missed block failed: ' + (error instanceof Error ? error.message : 'provider or database error'))
    throw error
  } finally { client.release() }
}

export async function deliverMonitorWalletNotifications(options: {
  pool?: Database; request?: Fetcher; logger?: Pick<Console, 'error'>; enabled?: boolean; now?: () => Date
} = {}) {
  const active = options.enabled ?? (process.env.PLATFORM_MONITOR_WALLET_ENABLED === 'true' && process.env.PLATFORM_TELEGRAM_ACTIONS === 'true')
  if (!active) return { sent: 0, skipped: true }
  const pool = options.pool ?? db, request = options.request ?? fetch, logger = options.logger ?? console, now = options.now ?? (() => new Date())
  const client = await pool.connect()
  let rows: { rid: number; bot_token: string; chat_id: string; payload: string; reply_markup: Json; attempts: number }[] = []
  try {
    await client.query('BEGIN')
    const claim = await client.query<{ rid: number; bot_token: string; chat_id: string; payload: string; reply_markup: Json; attempts: number }>(
      "SELECT n.rid,b.bot_token,n.chat_id,n.payload,n.reply_markup,n.attempts FROM t_platform_monitor_wallet_notification n " +
      "JOIN t_telegram_bot b ON b.rid=n.bot_rid WHERE (n.status='pending' AND n.next_attempt_at<=$1) OR " +
      "(n.status='processing' AND n.locked_until<$1) ORDER BY n.rid LIMIT 20 FOR UPDATE OF n SKIP LOCKED", [now()],
    )
    rows = claim.rows
    for (const row of rows) await client.query(
      "UPDATE t_platform_monitor_wallet_notification SET status='processing',attempts=attempts+1,locked_until=$2,updated_at=$3 WHERE rid=$1",
      [row.rid, new Date(now().getTime() + 30_000), now()],
    )
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); client.release(); throw error }
  client.release()
  let sent = 0
  for (const row of rows) {
    try {
      if (!row.bot_token) throw Object.assign(new Error('Telegram bot is not configured'), { terminal: true })
      const response = await request('https://api.telegram.org/bot' + row.bot_token + '/sendMessage', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: row.chat_id, text: row.payload, parse_mode: 'HTML', reply_markup: row.reply_markup, disable_web_page_preview: true }),
      })
      let payload: unknown
      try { payload = await response.json() } catch { payload = null }
      if (!response.ok || !isObject(payload) || payload.ok !== true) {
        const error = new Error('Telegram send failed with HTTP ' + response.status) as Error & { terminal?: boolean; retryAfter?: number }
        error.terminal = response.status >= 400 && response.status < 500 && response.status !== 429
        if (isObject(payload) && isObject(payload.parameters) && typeof payload.parameters.retry_after === 'number') error.retryAfter = payload.parameters.retry_after
        throw error
      }
      await pool.query("UPDATE t_platform_monitor_wallet_notification SET status='sent',sent_at=$2,locked_until=NULL,last_error=NULL,updated_at=$2 WHERE rid=$1", [row.rid, now()])
      sent++
    } catch (error) {
      const e = error as Error & { terminal?: boolean; retryAfter?: number }
      const terminal = e.terminal === true || row.attempts + 1 >= 8
      const delay = e.retryAfter ?? Math.min(300, Math.max(2, 2 ** Math.min(row.attempts + 1, 8)))
      await pool.query(
        'UPDATE t_platform_monitor_wallet_notification SET status=$2,locked_until=NULL,next_attempt_at=$3,last_error=$4,updated_at=$5 WHERE rid=$1',
        [row.rid, terminal ? 'failed' : 'pending', new Date(now().getTime() + delay * 1000), (e.message || 'delivery error').slice(0, 500), now()],
      ).catch(() => {})
      logger.error('Monitor wallet Telegram notification failed for outbox ' + row.rid)
    }
  }
  return { sent, skipped: false, claimed: rows.length }
}

