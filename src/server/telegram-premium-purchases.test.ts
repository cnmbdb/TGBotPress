import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import {
  handleTelegramPremiumPackageCallback,
  handleTelegramPremiumUsernameReply,
} from './telegram-premium-purchases.server'

const token = '12345:Abcdefghijklmnopqrstuvwxyz_123'
const packageRid = 71
const botRid = 7
const buyerId = '55'
const username = '@target_user'
const session = { packageRid, sessionId: 'premium-session-1' }

type PgResult = { rows: any[]; rowCount: number }
type Responder = (sql: string, params: any[]) => Promise<PgResult> | PgResult

class FakePool {
  readonly statements: Array<{ sql: string; params: any[] }> = []
  constructor(private readonly respond: Responder, private readonly respondClient: Responder = respond) {}
  async query(sql: string, params: any[] = []) {
    this.statements.push({ sql, params })
    return this.respond(sql, params)
  }
  async connect() {
    return {
      query: async (sql: string, params: any[] = []) => {
        this.statements.push({ sql, params })
        return this.respondClient(sql, params)
      },
      release() {},
    }
  }
}

function rows<T>(...items: T[]): PgResult { return { rows: items, rowCount: items.length } }

function envScope(values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function packageRow(cookie = 'v2:fixture') {
  return {
    rid: packageRid, premium_platform_rid: 4, package_name: 'Premium 12 months', package_month: 12,
    usdt_price: '10.00', show_notes: '<script>unsafe</script>', package_pic: null,
    receive_wallet: 'TReceiveWalletFixture', platform_hash: 'fragment-hash', platform_cookie: cookie,
  }
}

function telegramUpdate(data: string) {
  return {
    callback_query: {
      id: 'callback-1', data, from: { id: 55, username: 'buyer', is_bot: false },
      message: { message_id: 30, chat: { id: 55, type: 'private' } },
    },
  }
}

function telegramFetcher(requests: Array<{ url: string; payload: any }>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === 'string' ? init.body : ''
    requests.push({ url, payload: url.startsWith('https://api.telegram.org') ? JSON.parse(body) : body })
    if (url.startsWith('https://fragment.com/api')) {
      return Response.json({ ok: true, found: { name: 'Alice & Bob', recipient: 'fragment-recipient-1' } })
    }
    return Response.json({ ok: true, result: { message_id: 900 } })
  }) as typeof fetch
}

test('premium package callback stores a short-lived username prompt and sends active packages', async () => {
  const restore = envScope({ PLATFORM_TELEGRAM_ACTIONS: 'true' })
  const requests: Array<{ url: string; payload: any }> = []
  let stateContext: unknown
  const pool = new FakePool((sql, params) => {
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return rows({ bot_token: token })
    if (sql.startsWith('SELECT p.rid,p.premium_platform_rid')) return rows(packageRow())
    if (sql.startsWith('SELECT p.package_name,p.callback_data')) return rows({ package_name: 'Premium 12 months', callback_data: 'premium_' + 'a'.repeat(32) })
    if (sql.startsWith('INSERT INTO t_platform_telegram_conversation_state')) { stateContext = JSON.parse(params[3]); return rows() }
    return rows()
  })
  try {
    const handled = await handleTelegramPremiumPackageCallback(pool as never, telegramFetcher(requests), botRid, telegramUpdate('premium_' + 'a'.repeat(32)))
    assert.equal(handled, true)
    assert.equal((stateContext as typeof session).packageRid, packageRid)
    assert.match(String((stateContext as typeof session).sessionId), /^[a-f0-9]{36}$/u)
    assert.ok(pool.statements.some(x => x.sql.startsWith('UPDATE t_platform_telegram_conversation_state SET prompt_message_id=')))
    const sent = requests.find(x => x.url.endsWith('/sendMessage'))
    assert.ok(sent)
    assert.match(sent.payload.text, /请直接发送需要开通\/续费会员的 Telegram 用户名/u)
    assert.match(sent.payload.text, /&lt;script&gt;unsafe&lt;\/script&gt;/u)
    assert.equal(sent.payload.reply_markup.inline_keyboard[1][0].callback_data, 'premium_' + 'a'.repeat(32))
  } finally { restore() }
})

test('premium username reply validates Fragment recipient, persists a 15 minute order once, and replies with payment details', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const encryptedCookie = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from('fragment-session=fixture')).toString('base64url')
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const restore = envScope({ PLATFORM_TELEGRAM_ACTIONS: 'true', TRON_RSA_PRIVATE_KEY: privatePem, TRON_RSA_PRIVATE_KEY_PATH: undefined })
  const requests: Array<{ url: string; payload: any }> = []
  const savedPurchase = {
    update_rid: 444, bot_rid: botRid, chat_id: buyerId, premium_tg_username: username, premium_name: 'Alice & Bob',
    order_rid: 812, package_name: 'Premium 12 months', premium_package_month: 12, need_pay_usdt: '10.0100',
    receive_wallet: 'TReceiveWalletFixture', created_at: '2030-01-01 12:00:00', expire_time: '2030-01-01 12:15:00', notification_sent: false,
  }
  let createdPurchase = savedPurchase
  let purchaseInserted = false
  const dbRespond: Responder = (sql, params) => {
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return rows({ bot_token: token })
    if (sql.includes('FROM t_platform_telegram_premium_purchase') && sql.endsWith('LIMIT 1')) return rows()
    if (sql.includes("state='premium_purchase_username'") && !sql.includes('FOR UPDATE')) return rows({ context: session })
    if (sql.startsWith('SELECT rid FROM t_premium_platform_order')) return rows()
    if (sql.startsWith('SELECT p.rid,p.premium_platform_rid')) return rows(packageRow('v2:' + encryptedCookie))
    if (sql.startsWith('INSERT INTO t_platform_telegram_premium_purchase')) {
      createdPurchase = { ...savedPurchase, order_rid: Number(params[5]), need_pay_usdt: String(params[8]) }
      purchaseInserted = true
      return rows(createdPurchase)
    }
    return rows()
  }
  const clientRespond: Responder = (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return rows()
    if (sql.includes("state='premium_purchase_username'") && sql.includes('FOR UPDATE')) return rows({ context: session })
    if (sql.startsWith('SELECT rid FROM t_premium_platform_order')) return rows()
    if (sql.startsWith('SELECT 1 FROM t_premium_platform_order')) return rows()
    if (sql.startsWith('INSERT INTO t_premium_platform_order')) return rows({ rid: 812, expire_time: '2030-01-01 12:15:00' })
    if (sql.startsWith('INSERT INTO t_platform_telegram_premium_purchase')) {
      createdPurchase = { ...savedPurchase, order_rid: Number(params[5]), need_pay_usdt: String(params[8]) }
      purchaseInserted = true
      return rows(createdPurchase)
    }
    if (sql.includes('FROM t_platform_telegram_premium_purchase') && sql.includes('FOR UPDATE')) return purchaseInserted ? rows(createdPurchase) : rows()
    return rows()
  }
  const pool = new FakePool(dbRespond, clientRespond)
  const fetcher = telegramFetcher(requests)
  const message = { message_id: 123, chat: { id: 55, type: 'private' }, from: { id: 55, username: 'buyer' }, text: username }
  try {
    const handled = await handleTelegramPremiumUsernameReply(pool as never, fetcher, botRid, 444, message)
    assert.equal(handled, true)
    const fragmentCall = requests.find(x => x.url.startsWith('https://fragment.com/api'))
    assert.ok(fragmentCall)
    assert.match(fragmentCall.payload, /query=%40target_user/u)
    assert.match(fragmentCall.payload, /months=12/u)
    assert.match(fragmentCall.payload, /method=searchPremiumGiftRecipient/u)
    const orderInsert = pool.statements.find(x => x.sql.startsWith('INSERT INTO t_premium_platform_order'))
    assert.ok(orderInsert, pool.statements.map(x => x.sql).join('\\n'))
    assert.equal(orderInsert.params[0], botRid)
    assert.equal(orderInsert.params[1], 4)
    assert.equal(orderInsert.params[2], buyerId)
    assert.equal(orderInsert.params[4], username)
    assert.ok(/^10\.(?:01\d{2}|0200)$/u.test(String(orderInsert.params[5])))
    assert.equal(orderInsert.params[8], 'fragment-recipient-1')
    assert.equal(pool.statements.filter(x => x.sql.startsWith('INSERT INTO t_premium_platform_order')).length, 1)
    assert.ok(pool.statements.some(x => x.sql.startsWith("DELETE FROM t_platform_telegram_conversation_state")))
    assert.ok(pool.statements.some(x => x.sql.startsWith('UPDATE t_platform_telegram_premium_purchase SET notification_sent_at=')))
    const receipt = requests.find(x => x.url.endsWith('/sendMessage') && x.payload.text.includes('下单成功'))
    assert.ok(receipt)
    assert.match(receipt.payload.text, /TReceiveWalletFixture/u)
    assert.equal(receipt.payload.text.includes(String(orderInsert.params[5])), true)
    assert.equal(receipt.payload.reply_markup.inline_keyboard[0][0].callback_data, 'tgpremiumwalletpay_812')
  } finally { restore() }
})

test('premium purchase replay does not call Fragment or create another order after notification', async () => {
  const restore = envScope({ PLATFORM_TELEGRAM_ACTIONS: 'true' })
  const requests: Array<{ url: string; payload: any }> = []
  const existing = { ...{
    update_rid: 444, bot_rid: botRid, chat_id: buyerId, premium_tg_username: username, premium_name: 'Alice',
    order_rid: 812, package_name: 'Premium 12 months', premium_package_month: 12, need_pay_usdt: '10.0100',
    receive_wallet: 'TReceiveWalletFixture', created_at: '2030-01-01 12:00:00', expire_time: '2030-01-01 12:15:00', notification_sent: true,
  } }
  const pool = new FakePool((sql) => {
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return rows({ bot_token: token })
    if (sql.includes('FROM t_platform_telegram_premium_purchase') && sql.endsWith('LIMIT 1')) return rows(existing)
    if (sql.includes('FROM t_platform_telegram_premium_purchase') && sql.includes('FOR UPDATE')) return rows(existing)
    return rows()
  })
  const message = { message_id: 123, chat: { id: 55, type: 'private' }, from: { id: 55, username: 'buyer' }, text: username }
  try {
    assert.equal(await handleTelegramPremiumUsernameReply(pool as never, telegramFetcher(requests), botRid, 444, message), true)
    assert.equal(requests.length, 0)
    assert.equal(pool.statements.filter(x => x.sql.startsWith('INSERT INTO t_premium_platform_order')).length, 0)
  } finally { restore() }
})
