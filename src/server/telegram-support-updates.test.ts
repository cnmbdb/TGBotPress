import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, createHash, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { syncTelegramSupportUpdates, telegramSupportUpdateClaimable } from './telegram-support-updates.server'

const token = '12345:Abcdefghijklmnopqrstuvwxyz_123'
function saveEnv() { return [process.env.PLATFORM_TELEGRAM_ACTIONS, process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY, process.env.PLATFORM_ORIGIN, process.env.API_WEB_URL, process.env.TRON_RSA_PRIVATE_KEY] }
function restoreEnv(values: (string | undefined)[]) {
  const keys = ['PLATFORM_TELEGRAM_ACTIONS','PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY','PLATFORM_ORIGIN','API_WEB_URL','TRON_RSA_PRIVATE_KEY']
  keys.forEach((key, i) => values[i] == null ? delete process.env[key] : process.env[key] = values[i]!)
}

test('support preflight shares the worker claim predicate and checks the enabled bot', async () => {
  const update = { update_id: 41, message: { message_id: 10, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '/support' } }
  let statement = '', values: unknown[] = []
  const pool = { query: async (sql: string, params?: unknown[]) => {
    statement = sql
    values = params ?? []
    return { rows: [{ claimable: true }], rowCount: 1 }
  } }
  const result = await telegramSupportUpdateClaimable(pool as never, 7, update)
  assert.equal(result, true)
  assert.match(statement, /LEFT JOIN t_telegram_bot_moderation_config c ON c\.bot_rid=b\.rid/)
  assert.match(statement, /c\.support_enabled=true/)
  assert.match(statement, /t_telegram_verification v WHERE v\.bot_rid=u\.bot_rid AND v\.token_hash=encode\(digest\(/)
  assert.match(statement, /support_chat_id::text=u\.update_body #>> '\{message,chat,id\}'/)
  assert.match(statement, /v\.verification_type='support'/)
  assert.match(statement, /lower\(trim\(COALESCE\(u\.update_body #>> '\{message,text\}',''\)\)\)='\/start'/)
  assert.ok(statement.includes("u.update_body #>> '{message,user_shared,request_id}' IN ('1','3')"))
  assert.ok(statement.includes("u.update_body #>> '{message,chat_shared,request_id}' IN ('2','4')"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' IN ('bindA','bindABind','bindAUnbind')"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='userbindaddress'"))
  assert.ok(statement.includes("s.state='wallet_address' AND s.expires_at>now()"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^search(usdt|trx)list(all|ain|out)T[1-9A-HJ-NP-Za-km-z]{33}$'"))
  assert.ok(statement.includes("COALESCE(u.update_body #>> '{message,text}','')) ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'"))
  assert.ok(statement.includes("COALESCE(u.update_body #>> '{message,text}','')) ~ '^0[xX][0-9a-fA-F]{40}$'"))
  assert.ok(statement.includes("COALESCE(u.update_body #>> '{message,text}','')) ~ '^查授权[[:space:]]*T[1-9A-HJ-NP-Za-km-z]{33}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^查授权T[1-9A-HJ-NP-Za-km-z]{33}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' IN ('z0','z1','z2','z3')"))
  assert.ok(statement.includes('kr.status=0 AND kr.opt_type=9'))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' IN ('energybishusy','energybishubind','energybishusearch','energybishubalanceadd')"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='energybishu'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeshipmyaddress'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeshipaddaddress'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeshipdeleteaddress'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeshipupdate'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='cancelaitrusteeshiprechargeunpaid'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='重新选择套餐energy'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^energy_[0-9a-f]{32}$'"))
  assert.ok(statement.includes('t_energy_platform_package p JOIN t_energy_platform_bot eb'))

  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^aitrusteeship(recharge(trx|usdt)|recharge(trx|usdt)(10|100|500|1000|2000|5000))$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeshipusdtswaptrx'"))
  assert.equal(statement.match(/kr\.status=0 AND kr\.opt_type IN \(5,8,11\)/gu)?.length, 2)
  assert.equal(statement.match(/kr\.status=0 AND kr\.opt_type IN \(5,11\)/gu)?.length, 3)
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='aitrusteeship'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' IN ('monitorddaddress','monitordeleteaddress','monitorwalletbuy','buywalletmonitor5','buywalletmonitor10','buywalletmonitor20','buywalletmonitor50','buywalletmonitor100','buywalletmonitor200')"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='重新选择套餐premium'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^premium_[0-9a-fA-F]{32}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^buygoods[1-9][0-9]{0,9}_[1-9][0-9]{0,3}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^buygoodscdkey[1-9][0-9]{0,9}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^buygoodscdkeyconfirm(trx|usdt)[1-9][0-9]{0,9}$'"))
  assert.ok(statement.includes('kr.status=0 AND kr.opt_type=7'))
  assert.ok(statement.includes('kr.status=0 AND kr.opt_type=4'))
  assert.ok(statement.includes('kr.status=0 AND kr.opt_type=6'))
  assert.ok(statement.includes("s.state IN ('monitor_add_address','monitor_delete_address','monitor_update_comment') AND s.expires_at>now()"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdate_[1-9][0-9]{0,4}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdatewallet_[1-9][0-9]{0,9}$'"))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')"))
  assert.ok(statement.includes('kr.status=0 AND kr.opt_type=10'))
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^togglebishu_[0-9]+_[YN]$'"))
  assert.ok(statement.includes('t_platform_telegram_conversation_state s'))
  assert.ok(statement.includes("s.state IN ('bishu_balance_query','bishu_bind_notice','bishu_add_address','bishu_add_count','trusteeship_add_address','trusteeship_delete_address','trusteeship_usdt_to_trx') AND s.expires_at>now()"))
  assert.deepEqual(values, [7, JSON.stringify(update)])
})

test('energy platform package callback shows the active package and native purchase controls', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const callbackData = 'energy_0123456789abcdef0123456789abcdef'
  const update = {
    rid: 9001, bot_rid: 7,
    update_body: { callback_query: {
      id: 'energy-package-selection', data: callbackData, from: { id: 55, username: 'alice<&' },
      message: { message_id: 42, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Energy package', callback_data: callbackData }]] } },
    } },
  }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT p.rid,p.package_name')) return { rows: [{
      rid: 81, package_name: '能量 <套餐>', energy_amount: 65000, trx_price: '1.25',
      show_notes: '付款说明：<b>保留格式</b>', receive_wallet: 'T<Wallet&>', package_pic: 'https://media.example.test/package.png',
    }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 43 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['sendPhoto'])
    assert.equal(requests[0].payload.chat_id, '55')
    assert.equal(requests[0].payload.photo, 'https://media.example.test/package.png')
    assert.ok(requests[0].payload.caption.includes('付款说明：<b>保留格式</b>'))
    assert.ok(requests[0].payload.caption.includes('能量 &lt;套餐&gt;'))
    assert.ok(requests[0].payload.caption.includes('T&lt;Wallet&amp;&gt;'))
    assert.ok(requests[0].payload.caption.includes('@alice&lt;&amp;'))
    assert.deepEqual(requests[0].payload.reply_markup.inline_keyboard, [
      [{ text: 'TRX 余额购买', callback_data: 'balancebuytrx81' }, { text: 'USDT 余额购买', callback_data: 'balancebuyusd81' }],
      [{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }],
    ])
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('energybishu package callback renders the active opt_type 10 response in groups', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1001, bot_rid: 7, update_body: { callback_query: { id: 'bishu-package-callback', data: 'energybishu', from: { id: 55, username: 'alice' }, message: { message_id: 42, chat: { id: -1007, type: 'supergroup' }, text: '笔数套餐', reply_markup: { inline_keyboard: [[{ text: '🖌笔数套餐', callback_data: 'energybishu' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 19, bot_token: token, bot_username: 'sample_bot', bot_admin_username: 'support_bot', opt_type: 10, monitor_word: '笔数', reply_photo: null, reply_content: '--' }], rowCount: 1 }
    if (sql.startsWith('SELECT per_bishu_usdt_price')) return { rows: [{ per_bishu_usdt_price: '0.35', receive_wallet: 'TWallet' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 43 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.deepEqual(requests[0].payload, { callback_query_id: 'bishu-package-callback' })
    assert.equal(requests[1].payload.chat_id, '-1007')
    assert.match(requests[1].payload.text, /每笔单价：0\.35 USDT/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard, [[
      { text: '👨联系客服', url: 'https://t.me/support_bot' },
      { text: '⏳剩余笔数', url: 'https://t.me/sample_bot' },
    ]])
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('aitrusteeship return callback reopens the native opt_type 11 menu', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1013, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-menu-return', data: 'aitrusteeship', from: { id: 55 }, message: { message_id: 66, chat: { id: 55, type: 'private' }, text: '托管地址设置', reply_markup: { inline_keyboard: [[{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }]] } } } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid,b.bot_token')) return { rows: [{ rid: 19, bot_token: token, bot_username: 'sample_bot', bot_admin_username: 'support_bot', opt_type: 11, monitor_word: '托管', reply_photo: null, reply_content: '--' }], rowCount: 1 }
    if (sql.startsWith('SELECT cash_trx::text,cash_usdt::text')) return { rows: [{ cash_trx: '12.500000', cash_usdt: '9.000000' }], rowCount: 1 }
    if (sql.startsWith('SELECT trx_price_energy_32000::text')) return { rows: [{ trx_price_energy_32000: '1', trx_price_energy_65000: '2' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 67 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[0].payload.callback_query_id, 'trusteeship-menu-return')
    assert.match(requests[1].payload.text, /12\.500000 TRX/u)
    assert.match(requests[1].payload.text, /9\.000000 USDT/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard[0][2], { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' })
    assert.ok(statements.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('aitrusteeshipmyaddress callback returns only the caller-owned list with legacy controls', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1002, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-list-callback', data: 'aitrusteeshipmyaddress', from: { id: 55 }, message: { message_id: 44, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '55' }], rowCount: 1 }
    if (sql.startsWith('SELECT wallet_addr FROM t_energy_ai_trusteeship')) return { rows: [{ wallet_addr: 'T<Wallet>&' }, { wallet_addr: 'TSecondWallet' }], rowCount: 2 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 45 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.deepEqual(requests[0].payload, { callback_query_id: 'trusteeship-list-callback' })
    assert.equal(requests[1].payload.chat_id, '55')
    assert.match(requests[1].payload.text, /当前已托管：2 个/u)
    assert.match(requests[1].payload.text, /T&lt;Wallet&gt;&amp;/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard, [
      [
        { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
        { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
      ],
      [
        { text: '⬅️返回上一步', callback_data: 'aitrusteeship' },
        { text: '🔄刷新', callback_data: 'aitrusteeshipmyaddress' },
      ],
      [{ text: '⚙️监控能量设置', callback_data: 'aitrusteeshipupdate' }],
    ])
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('aitrusteeshipaddaddress callback prompts only when the account has capacity', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1003, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-add-callback', data: 'aitrusteeshipaddaddress', from: { id: 55 }, message: { message_id: 46, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '55' }], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::int AS total FROM t_energy_ai_trusteeship')) return { rows: [{ total: 3 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 47 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /还可以托管：7 个/u)
    assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.values?.[3] === '47'))
  } finally { restoreEnv(env) }
})

test('replying to the trusteeship add prompt checks blacklist, ownership and ten-address limit transactionally', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb'
  const update = { rid: 1004, bot_rid: 7, update_body: { message: { message_id: 48, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address, reply_to_message: { message_id: 47 } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: string[] = [], requests: Array<{ method: string; payload: any }> = []
  let inserted = false
  const client = { query: async (sql: string) => {
    transaction.push(sql)
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 5 }], rowCount: 1 }
    if (sql.startsWith('SELECT wallet_addr FROM t_energy_ai_trusteeship')) return { rows: inserted ? [{ wallet_addr: address }] : [], rowCount: inserted ? 1 : 0 }
    if (sql.startsWith('SELECT count(*)::int AS total FROM t_energy_ai_trusteeship')) return { rows: [{ total: inserted ? 1 : 0 }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_energy_ai_trusteeship')) { inserted = true; return { rows: [], rowCount: 1 } }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'trusteeship_add_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot WHERE rid=$1')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 49 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.includes('BEGIN') && transaction.includes('COMMIT'))
    assert.ok(transaction.some(sql => sql.startsWith('INSERT INTO t_energy_ai_trusteeship')))
    assert.equal(requests.length, 1)
    assert.match(requests[0].payload.text, /智能托管地址已添加成功/u)
    assert.match(requests[0].payload.text, new RegExp(address))
    assert.ok(statements.some(row => row.sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
  } finally { restoreEnv(env) }
})

test('aitrusteeshipdeleteaddress callback lists the user-owned addresses and stores a two-minute prompt', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1005, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-delete-callback', data: 'aitrusteeshipdeleteaddress', from: { id: 55 }, message: { message_id: 50, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '55' }], rowCount: 1 }
    if (sql.startsWith('SELECT wallet_addr FROM t_energy_ai_trusteeship')) return { rows: [{ wallet_addr: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 51 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /请在2分钟内回复此消息需要删除/u)
    assert.match(requests[1].payload.text, /TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb/u)
    assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.sql.includes("'trusteeship_delete_address'")))
  } finally { restoreEnv(env) }
})

test('replying to trusteeship deletion removes only a matching bot and user address', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb'
  const update = { rid: 1006, bot_rid: 7, update_body: { message: { message_id: 52, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address, reply_to_message: { message_id: 51 } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT rid FROM t_energy_ai_trusteeship')) return { rows: [{ rid: 81 }], rowCount: 1 }
    if (sql.startsWith('DELETE FROM t_energy_ai_trusteeship')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'trusteeship_delete_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot WHERE rid=$1')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 53 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.some(row => row.sql.startsWith('DELETE FROM t_energy_ai_trusteeship WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3') && row.values?.join(',') === '81,7,55'))
    assert.match(requests[0].payload.text, /智能托管地址已删除成功/u)
    assert.ok(statements.some(row => row.sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
  } finally { restoreEnv(env) }
})

test('aitrusteeshipupdate callback lists only the caller-owned wallets and energy settings', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1007, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-settings-list', data: 'aitrusteeshipupdate', from: { id: 55 }, message: { message_id: 54, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '⚙️监控能量设置', callback_data: 'aitrusteeshipupdate' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '55' }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,wallet_addr,min_energy_quantity FROM t_energy_ai_trusteeship')) return { rows: [{ rid: 81, wallet_addr: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb', min_energy_quantity: 65000 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 55 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.inline_keyboard[0][0].callback_data, 'aitrusteeshipupdate_81')
    assert.match(requests[1].payload.text, /65,000 或 131,000/u)
  } finally { restoreEnv(env) }
})

test('aitrusteeshipupdateconfirm changes only the caller-owned wallet energy preset', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1008, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-settings-confirm', data: 'aitrusteeshipupdateconfirm_81_2', from: { id: 55 }, message: { message_id: 56, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '托管 131,000 能量', callback_data: 'aitrusteeshipupdateconfirm_81_2' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT rid FROM t_energy_ai_trusteeship')) return { rows: [{ rid: 81 }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_energy_ai_trusteeship')) return { rows: [{ wallet_addr: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot WHERE rid=$1')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '55' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 57 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_energy_ai_trusteeship SET min_energy_quantity=$4,per_buy_energy_quantity=$4,update_time=now() WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3') && row.values?.join(',') === '81,7,55,131000'))
    assert.match(requests[1].payload.text, /当前代理能量：<b>131000<\/b>/u)
  } finally { restoreEnv(env) }
})

test('cancelaitrusteeshiprechargeunpaid cancels only the caller bot pending recharge rows', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1009, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-cancel-recharge', data: 'cancelaitrusteeshiprechargeunpaid', from: { id: 55 }, message: { message_id: 58, chat: { id: 55, type: 'private' }, text: '您还有未完成的充值订单', reply_markup: { inline_keyboard: [[{ text: '取消未充值的订单', callback_data: 'cancelaitrusteeshiprechargeunpaid' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT rid FROM t_fms_recharge_order')) return { rows: [{ rid: 30 }, { rid: 31 }], rowCount: 2 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 59 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [
      { method: 'answerCallbackQuery', payload: { callback_query_id: 'trusteeship-cancel-recharge' } },
      { method: 'sendMessage', payload: { chat_id: '55', text: '您的未完成充值订单已取消，可重新发起充值！', parse_mode: 'Markdown', allow_sending_without_reply: true } },
    ])
    assert.ok(transaction.some(row => row.sql === 'BEGIN'))
    assert.ok(transaction.some(row => row.sql.includes("pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-recharge:'")))
    assert.ok(transaction.some(row => row.sql.startsWith('SELECT rid FROM t_fms_recharge_order') && row.values?.[0] === 7 && row.values?.[1] === '55'))
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_fms_recharge_order SET status=3,cancel_time=now()') && row.values?.[0] === 7 && row.values?.[1] === '55'))
    assert.ok(transaction.some(row => row.sql === 'COMMIT'))
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('cancelpremiumunpaid cancels only the caller bot and user pending premium orders', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1910, bot_rid: 7, update_body: { callback_query: { id: 'premium-cancel', data: 'cancelpremiumunpaid', from: { id: 55 }, message: { message_id: 60, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '取消未完成的订单', callback_data: 'cancelpremiumunpaid' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => { transaction.push({ sql, values }); return { rows: [], rowCount: 1 } }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 61 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(statements.some(row => row.sql.includes("#>> '{callback_query,data}'='cancelpremiumunpaid'")))
    assert.deepEqual(requests, [
      { method: 'answerCallbackQuery', payload: { callback_query_id: 'premium-cancel' } },
      { method: 'sendMessage', payload: { chat_id: '55', text: '您的未完成会员订单已取消，可重新发起购买会员！', parse_mode: 'Markdown', allow_sending_without_reply: true } },
    ])
    assert.ok(transaction.some(row => row.sql.includes("pg_advisory_xact_lock(hashtextextended('telegram-premium-cancel:'")))
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_premium_platform_order SET status=4,cancel_time=now() WHERE bot_rid=$1 AND status=0 AND buy_tg_uid=$2') && row.values?.join(',') === '7,55'))
    assert.ok(transaction.some(row => row.sql === 'COMMIT'))
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('premium package reselect button shows its payment safety alert and is claimed only from the active opt_type 4 keyboard', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1911, bot_rid: 7, update_body: { callback_query: { id: 'premium-reselect', data: '重新选择套餐premium', from: { id: 55 }, message: { message_id: 61, chat: { id: -1007, type: 'supergroup' }, reply_markup: { inline_keyboard: [[{ text: '点击重新选择套餐', callback_data: '重新选择套餐premium' }]] } } } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string) => {
    statements.push(query)
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{ method: 'answerCallbackQuery', payload: {
      callback_query_id: 'premium-reselect',
      text: '开通 Telegram 会员前，请仔细核对收款地址、支付金额和开通账号。',
      show_alert: true,
    } }])
    assert.ok(statements.some(query => query.includes("u.update_body #>> '{callback_query,data}'='重新选择套餐premium'") && query.includes('kr.status=0 AND kr.opt_type=4')))
  } finally { restoreEnv(env) }
})

test('trusteeship recharge callbacks create legacy pending orders for every supported coin and amount', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  try {
    for (const coin of ['trx', 'usdt'] as const) {
      for (const amount of [10, 100, 500, 1000, 2000, 5000]) {
        const callbackData = `aitrusteeshiprecharge${coin}${amount}`
        const callbackId = `trusteeship-recharge-${coin}-${amount}`
        const update = { rid: 1010, bot_rid: 7, update_body: { callback_query: { id: callbackId, data: callbackData, from: { id: 55, username: 'alice' }, message: { message_id: 60, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: `${amount} ${coin.toUpperCase()}`, callback_data: callbackData }]] } } } } }
        const statements: Array<{ sql: string; values?: unknown[] }> = []
        const transaction: Array<{ sql: string; values?: unknown[] }> = []
        const requests: Array<{ method: string; payload: any }> = []
        const client = { query: async (sql: string, values?: unknown[]) => {
          transaction.push({ sql, values })
          if (sql.startsWith('SELECT recharge_pay_price::text')) return { rows: [], rowCount: 0 }
          if (sql.startsWith('SELECT rid FROM t_fms_recharge_order WHERE status=0')) return { rows: [], rowCount: 0 }
          if (sql.startsWith('INSERT INTO t_fms_recharge_order')) return { rows: [{ rid: 112, need_pay_price: values?.[5], expire_time: '2026-11-06 01:15:00' }], rowCount: 1 }
          return { rows: [], rowCount: 1 }
        }, release() {} }
        const pool = { query: async (sql: string, values?: unknown[]) => {
          statements.push({ sql, values })
          if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
          if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
          if (sql.startsWith('SELECT cash_trx::text,cash_usdt::text')) return { rows: [{ cash_trx: '12.5', cash_usdt: '100' }], rowCount: 1 }
          if (sql.startsWith('SELECT recharge_wallet_addr')) return { rows: [{ recharge_wallet_addr: 'T&<Wallet>' }], rowCount: 1 }
          return { rows: [], rowCount: 1 }
        }, connect: async () => client }
        const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
          requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
          return Response.json({ ok: true, result: { message_id: 61 } })
        } })
        assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 }, `${coin} ${amount}`)
        assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'], `${coin} ${amount}`)
        assert.equal(requests[0].payload.callback_query_id, callbackId)
        assert.equal(requests[1].payload.chat_id, '55')
        assert.match(requests[1].payload.text, /支付金额/u)
        assert.match(requests[1].payload.text, /T&amp;&lt;Wallet&gt;/u)
        assert.match(requests[1].payload.text, /充值订单：112/u)
        assert.ok(requests[1].payload.text.includes(coin), `${coin} ${amount} reply currency`)
        assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard.at(-1), [{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }])
        const insert = transaction.find(row => row.sql.startsWith('INSERT INTO t_fms_recharge_order'))
        assert.ok(insert, `${coin} ${amount} insert`)
        assert.deepEqual(insert!.values?.slice(0, 5), [7, '55', 'alice', coin, `${amount}.00`])
        assert.match(String(insert!.values?.[5]), new RegExp(`^${amount}\\.(0[1-9]|[1-9]\\d)$`,'u'))
        const displayedAmount = requests[1].payload.text.match(/支付金额：<\/b><code>([\d.]+)<\/code>/u)?.[1]
        assert.equal(Number(displayedAmount), Number(insert!.values?.[5]), `${coin} ${amount} displayed amount`)
        assert.ok(transaction.some(row => row.sql.includes("pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-recharge-amounts'")))
        assert.ok(transaction.some(row => row.sql === 'COMMIT'))
        assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
      }
    }
  } finally { restoreEnv(env) }
})

test('aitrusteeshipusdtswaptrx prompts for a private reply and stores an expiring state', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1011, bot_rid: 7, update_body: { callback_query: { id: 'trusteeship-swap-start', data: 'aitrusteeshipusdtswaptrx', from: { id: 55 }, message: { message_id: 62, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid::text,cash_usdt::text')) return { rows: [{ tg_uid: '55', cash_usdt: '25.650000' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 63 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /当前USDT余额：<\/b><code>25\.650000<\/code>/u)
    assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.sql.includes("'trusteeship_usdt_to_trx'") && row.values?.[3] === '63'))
  } finally { restoreEnv(env) }
})

test('trusteeship USDT to TRX reply uses mocked OKX quote and atomically debits only the matching user', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 1012, bot_rid: 7, update_body: { message: { message_id: 64, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '3', reply_to_message: { message_id: 63, from: { is_bot: true } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ url: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'trusteeship_usdt_to_trx' }], rowCount: 1 }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 88 }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_bot_user SET cash_trx=')) return { rows: [{ cash_trx: '21.400000', cash_usdt: '7.000000' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'trusteeship_usdt_to_trx' }], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input)
      const payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url, payload })
      if (url.includes('okx.com')) return Response.json({ data: [{ idxPx: '0.25' }] })
      return Response.json({ ok: true, result: { message_id: 65 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.match(requests[0].url, /^https:\/\/www\.okx\.com\/api\/v5\/market\/index-tickers\?instId=TRX-USDT/u)
    assert.match(requests[1].payload.text, /USDT 转 TRX 成功/u)
    assert.match(requests[1].payload.text, /21\.400000 TRX/u)
    assert.match(requests[1].payload.text, /7\.000000 USDT/u)
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_telegram_bot_user SET cash_trx=') && row.sql.includes('cash_usdt >= $3::numeric') && row.values?.[0] === 88 && row.values?.[1] === 7 && row.values?.[2] === '3' && row.values?.[3] === '3.80'))
    assert.ok(transaction.some(row => row.sql.startsWith('DELETE FROM t_platform_telegram_conversation_state') && row.values?.[0] === 7 && row.values?.[1] === '55' && row.values?.[3] === '63'))
    assert.ok(transaction.some(row => row.sql === 'COMMIT'))
    assert.ok(statements.some(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('energybishusy callback stores a two-minute ForceReply prompt for private chats', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 990, bot_rid: 7, update_body: { callback_query: { id: 'bishu-callback', data: 'energybishusy', from: { id: 55 }, message: { message_id: 30, chat: { id: 55, type: 'private' }, text: '每笔单价：0.35 USDT', reply_markup: { inline_keyboard: [[{ text: '⏳剩余笔数', callback_data: 'energybishusy' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 31 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /请在2分钟内回复此消息/u)
    assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.values?.[3] === '31'))
    assert.ok(statements.some(row => row.sql.includes("now()+interval '2 minutes'")))
  } finally { restoreEnv(env) }
})

test('energybishubind callback stores its own two-minute notification binding prompt', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 993, bot_rid: 7, update_body: { callback_query: { id: 'bishu-bind-callback', data: 'energybishubind', from: { id: 55 }, message: { message_id: 36, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '绑定通知', callback_data: 'energybishubind' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 37 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /只有下单了笔数套餐的地址才能绑定/u)
    assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.sql.includes("'bishu_bind_notice'")))
  } finally { restoreEnv(env) }
})

test('replying to energybishubind assigns an unclaimed purchased address as inactive', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 994, bot_rid: 7, update_body: { message: { message_id: 38, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 37 }, text: address } } }
  const statements: string[] = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], replies: any[] = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT tg_uid,is_active')) return { rows: [{ tg_uid: null, is_active: 'N' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'bishu_bind_notice' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: token, bot_admin_username: '@support_bot' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => { replies.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, result: { message_id: 39 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.some(row => row.sql === 'BEGIN'))
    assert.ok(transaction.some(row => row.sql.includes('telegram-bishu-bind:')))
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_energy_ai_bishu SET tg_uid=$3,is_active=\'N\'')))
    assert.ok(transaction.some(row => row.sql === 'COMMIT'))
    assert.match(replies[0].text, /绑定成功/u)
    assert.match(replies[0].text, /当前状态：未激活/u)
    assert.deepEqual(replies[0].reply_markup.inline_keyboard[0].map((button: any) => button.url ?? button.callback_data), ['https://t.me/support_bot', 'energybishu'])
  } finally { restoreEnv(env) }
})

test('energybishusearch renders owned addresses and togglebishu edits only the caller-owned record', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 995, bot_rid: 7, update_body: { callback_query: { id: 'toggle-bishu', data: 'togglebishu_81_Y', from: { id: 55 }, message: { message_id: 40, chat: { id: 55, type: 'private' }, text: '已绑定的能量地址列表', reply_markup: { inline_keyboard: [[{ text: 'activate', callback_data: 'togglebishu_81_Y' }]] } } } } }
  const transaction: Array<{ sql: string; values?: unknown[] }> = [], queries: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT rid,wallet_addr,is_active')) return { rows: [{ rid: 81, wallet_addr: 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F', is_active: 'N' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::int')) return { rows: [{ total: 1 }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,wallet_addr,is_active')) return { rows: [{ rid: 81, wallet_addr: 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F', is_active: 'Y' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: '@support_bot' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.some(row => row.sql.startsWith('SELECT rid,wallet_addr,is_active') && row.sql.includes('tg_uid=$3 FOR UPDATE') && row.values?.[2] === '55'))
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_energy_ai_bishu SET is_active=$4')))
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'editMessageText'])
    assert.equal(requests[0].payload.show_alert, true)
    assert.match(requests[1].payload.text, /地址列表/u)
    assert.ok(requests[1].payload.reply_markup.inline_keyboard.some((row: any[]) => row.some(button => button.callback_data === 'togglebishu_81_N')))
    assert.ok(queries.some(sql => sql.startsWith('SELECT count(*)::int')))
  } finally { restoreEnv(env) }
})

test('togglebishu denies a record owned by another bot user without editing the list', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 996, bot_rid: 7, update_body: { callback_query: { id: 'toggle-bishu-denied', data: 'togglebishu_82_Y', from: { id: 55 }, message: { message_id: 41, chat: { id: 55, type: 'private' }, text: '已绑定的能量地址列表', reply_markup: { inline_keyboard: [[{ text: 'activate', callback_data: 'togglebishu_82_Y' }]] } } } } }
  const transaction: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string) => { transaction.push(sql); return { rows: [], rowCount: 0 } }, release() {} }
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transaction.includes('ROLLBACK'))
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery'])
    assert.equal(requests[0].payload.text, '地址不存在或无权操作')
    assert.equal(requests[0].payload.show_alert, true)
  } finally { restoreEnv(env) }
})

test('replying to the energybishusy prompt returns local remaining count with safe HTML and retry actions', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 991, bot_rid: 7, update_body: { message: { message_id: 32, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 31 }, text: address } } }
  const statements: string[] = [], replies: any[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'bishu_balance_query' }], rowCount: 1 }
    if (sql.startsWith('SELECT total_buy_usdt::text')) return { rows: [{ total_buy_usdt: '12.50', max_buy_quantity: 100, total_buy_quantity: 35, energy_platform_rid: null }], rowCount: 1 }
    if (sql.startsWith('SELECT bishu_daili_type')) return { rows: [{ bishu_daili_type: 1 }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: token, bot_admin_username: '@support_bot' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => { replies.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, result: { message_id: 33 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.match(replies[0].text, new RegExp(address))
    assert.match(replies[0].text, /总充值：12\.50 USDT/u)
    assert.match(replies[0].text, /剩余次数：65/u)
    assert.deepEqual(replies[0].reply_markup.inline_keyboard[0].map((button: any) => button.callback_data ?? button.url), ['https://t.me/support_bot', 'energybishusy'])
    assert.ok(statements.some(sql => sql.startsWith("DELETE FROM t_platform_telegram_conversation_state") && sql.includes("state='bishu_balance_query'")))
  } finally { restoreEnv(env) }
})

test('energybishusy reply combines delegated Trongas residue and local count using a fixed endpoint', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 992, bot_rid: 7, update_body: { message: { message_id: 34, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 31 }, text: address } } }
  const requests: Array<{ url: string; method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'bishu_balance_query' }], rowCount: 1 }
    if (sql.startsWith('SELECT total_buy_usdt::text')) return { rows: [{ total_buy_usdt: '12.50', max_buy_quantity: 100, total_buy_quantity: 35, energy_platform_rid: 8 }], rowCount: 1 }
    if (sql.startsWith('SELECT bishu_daili_type')) return { rows: [{ bishu_daili_type: 2 }], rowCount: 1 }
    if (sql.startsWith('SELECT platform_uid')) return { rows: [{ platform_uid: 'tenant-a' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: token, bot_admin_username: null }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input), method = String(init?.method ?? 'GET')
      requests.push({ url, method, payload: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === 'https://trongas.io/api/auto/data') return Response.json({ code: 10000, data: { data: [{ freeze: 0, residue: 17 }] } })
      return Response.json({ ok: true, result: { message_id: 35 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const external = requests.find(row => row.url === 'https://trongas.io/api/auto/data')!
    assert.equal(external.method, 'POST')
    assert.deepEqual(external.payload, { page: 1, username: 'tenant-a', search: { orderId: '', state: '', receiveAddress: address, chromeIndex: '' } })
    assert.ok(requests.some(row => JSON.stringify(row.payload).includes('剩余次数：82')))
  } finally { restoreEnv(env) }
})

test('private calculator updates are routed to native dispatch only for valid expressions', async () => {
  const statements: string[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    return { rows: [{ claimable: sql.includes('FROM t_telegram_bot_keyreply kr JOIN t_telegram_bot') ? false : true }], rowCount: 1 }
  } }
  const formula = { message: { message_id: 11, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '(2 + 3) * 4' } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, formula), true)
  assert.ok(statements.at(-1)?.includes("u.update_body #>> '{message,from,id}' ~ '^[0-9]{1,20}$'"))
  assert.ok(statements.at(-1)?.includes("~ '^[-0-9.()+*/ ]+$'"))

  const malformed = { message: { ...formula.message, text: '2 + nope' } }
  await telegramSupportUpdateClaimable(pool as never, 7, malformed)
  assert.doesNotMatch(statements.at(-1)!, /length\(trim\(COALESCE\(u\.update_body #>> '\{message,text\}'/)
})

test('plain private /start registers the follower, syncs private commands, and acknowledges when no custom reply exists', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 32, bot_rid: 7, update_body: { message: { message_id: 12, chat: { id: 55, type: 'private' }, from: { id: 55, username: 'alice', first_name: 'Alice', last_name: 'A' }, text: '/start@demo_bot' } } }
  const sql: string[] = [], transactionSql: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (q: string) => {
    transactionSql.push(q)
    if (q.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (q: string) => {
    sql.push(q)
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT bot_token,bot_username')) return { rows: [{ bot_token: token, bot_username: '@demo_bot' }], rowCount: 1 }
    if (q.startsWith('SELECT command,description,command_type')) return { rows: [{ command: 'hello', description: 'Hello', command_type: 1 }, { command: 'private', description: 'Private', command_type: 2 }, { command: 'group', description: 'Group', command_type: 3 }], rowCount: 3 }
    if (q.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transactionSql.includes('BEGIN'))
    assert.ok(transactionSql.some(q => q.includes('pg_advisory_xact_lock')))
    assert.ok(transactionSql.some(q => q.startsWith('INSERT INTO t_telegram_bot_user')))
    assert.ok(transactionSql.includes('COMMIT'))
    assert.deepEqual(requests, [
      { method: 'setMyCommands', payload: { commands: [{ command: 'hello', description: 'Hello' }, { command: 'private', description: 'Private' }], scope: { type: 'all_private_chats' } } },
      { method: 'sendMessage', payload: { chat_id: '55', text: '✅ 初始化完成，请从 Telegram 命令菜单选择要使用的功能。', reply_to_message_id: 12, allow_sending_without_reply: true } },
    ])
    assert.ok(sql.some(q => q.startsWith('UPDATE t_platform_telegram_update SET status=\'processed\'')))
  } finally { restoreEnv(env) }
})

test('private arithmetic messages receive a native Telegram calculator reply', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 901, bot_rid: 7, update_body: { message: { message_id: 18, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '2 + 3 * 4' } } }
  const requests: Array<{ method: string; payload: any }> = []
  const sql: string[] = []
  const pool = { query: async (statement: string) => {
    sql.push(statement)
    if (statement.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (statement.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 19 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{ method: 'sendMessage', payload: { chat_id: '55', text: '2 + 3 * 4 = 14', reply_to_message_id: 18, allow_sending_without_reply: true, parse_mode: 'HTML' } }])
    assert.ok(sql.some(statement => statement.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('userbindaddress callback sends a ForceReply prompt and stores its two-minute reply state', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 211, bot_rid: 7, update_body: { callback_query: { id: 'cb-1', data: 'userbindaddress', from: { id: 55 }, message: { message_id: 10, chat: { id: 55, type: 'private' } } } } }
  const statements: string[] = [], payloads: any[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 85 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(statements.some(sql => sql.includes("'wallet_address'")))
    assert.ok(statements.some(sql => sql.includes('prompt_message_id=$4')))
    assert.deepEqual(payloads, [{
      chat_id: '55',
      text: '<b>请在2分钟内回复此消息，直接回复您要绑定的波场地址</b>\n\n点击 /start 重新开始',
      parse_mode: 'HTML',
      allow_sending_without_reply: true,
      reply_markup: { force_reply: true, input_field_placeholder: '请输入需要绑定的波场地址' },
    }])
  } finally { restoreEnv(env) }
})

test('replying to the wallet bind prompt saves a unique TRON address and confirms it', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 212, bot_rid: 7, update_body: { message: { message_id: 84, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 83 }, text: address } } }
  const statements: string[] = [], transactionSql: string[] = [], payloads: any[] = []
  const client = { query: async (sql: string) => {
    transactionSql.push(sql)
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('UPDATE t_telegram_bot_user SET bind_trc_wallet_addr')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'wallet_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 85 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transactionSql.includes('BEGIN'))
    assert.ok(transactionSql.some(sql => sql.includes('pg_advisory_xact_lock')))
    assert.ok(transactionSql.some(sql => sql.startsWith('UPDATE t_telegram_bot_user SET bind_trc_wallet_addr')))
    assert.ok(transactionSql.includes('COMMIT'))
    assert.ok(statements.some(sql => sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
    assert.match(payloads[0].text, /绑定结果：绑定成功/)
    assert.match(payloads[0].text, new RegExp(address))
    assert.deepEqual(payloads[0].reply_markup.inline_keyboard[0], [
      { text: '👨联系客服', url: 'https://t.me/support_admin' },
      { text: '🕐重新开始', callback_data: '/start' },
    ])
  } finally { restoreEnv(env) }
})

test('wallet binding rejects an address already used by another Telegram user', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 213, bot_rid: 7, update_body: { message: { message_id: 84, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 83 }, text: address } } }
  const transactionSql: string[] = [], payloads: any[] = []
  const client = { query: async (sql: string) => {
    transactionSql.push(sql)
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 88 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'wallet_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: null }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 85 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transactionSql.includes('ROLLBACK'))
    assert.ok(!transactionSql.includes('COMMIT'))
    assert.match(payloads[0].text, /绑定结果：该地址已被其他用户绑定/)
    assert.match(payloads[0].text, new RegExp(address))
    assert.ok(payloads[0].reply_markup.inline_keyboard[0].some((button: any) => button.callback_data === '/start'))
  } finally { restoreEnv(env) }
})

test('plain private /start reactivates an existing follower and acknowledges when no menu commands exist', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 33, bot_rid: 7, update_body: { message: { message_id: 13, chat: { id: 55, type: 'private' }, from: { id: 55, first_name: 'Alice' }, text: '/start' } } }
  const transactionSql: string[] = [], requests: string[] = []
  const client = { query: async (q: string) => {
    transactionSql.push(q)
    if (q.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 81 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (q: string) => {
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT bot_token,bot_username')) return { rows: [{ bot_token: token, bot_username: 'demo_bot' }], rowCount: 1 }
    if (q.startsWith('SELECT command,description,command_type')) return { rows: [], rowCount: 0 }
    if (q.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input) => {
      requests.push(String(input).split('/').pop()!)
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, ['sendMessage'])
    assert.ok(transactionSql.some(q => q.startsWith('UPDATE t_telegram_bot_user SET status=1')))
    assert.ok(!transactionSql.some(q => q.startsWith('INSERT INTO t_telegram_bot_user')))
  } finally { restoreEnv(env) }
})

test('private shared user, group, bot and channel IDs are replied to natively', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const updates = [
    { rid: 201, bot_rid: 7, update_body: { message: { message_id: 1, chat: { id: 55, type: 'private' }, from: { id: 55 }, user_shared: { request_id: 1, user_id: 101 } } } },
    { rid: 202, bot_rid: 7, update_body: { message: { message_id: 2, chat: { id: 55, type: 'private' }, from: { id: 55 }, chat_shared: { request_id: 2, chat_id: -202 } } } },
    { rid: 203, bot_rid: 7, update_body: { message: { message_id: 3, chat: { id: 55, type: 'private' }, from: { id: 55 }, user_shared: { request_id: 3, user_id: 303 } } } },
    { rid: 204, bot_rid: 7, update_body: { message: { message_id: 4, chat: { id: 55, type: 'private' }, from: { id: 55 }, chat_shared: { request_id: 4, chat_id: -404 } } } },
  ]
  const updatesSql: string[] = [], replies: any[] = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: updates, rowCount: updates.length }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) updatesSql.push(sql)
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      replies.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: replies.length } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 4, failed: 0 })
    assert.deepEqual(replies, [
      { chat_id: '55', text: '用户ID：<code>101</code>', allow_sending_without_reply: true, parse_mode: 'HTML' },
      { chat_id: '55', text: '群组ID：<code>-202</code>', allow_sending_without_reply: true, parse_mode: 'HTML' },
      { chat_id: '55', text: '机器人ID：<code>303</code>', allow_sending_without_reply: true, parse_mode: 'HTML' },
      { chat_id: '55', text: '频道ID：<code>-404</code>', allow_sending_without_reply: true, parse_mode: 'HTML' },
    ])
    assert.equal(updatesSql.length, 4)
  } finally { restoreEnv(env) }
})

test('energybishubalanceadd callback and address reply create an expiring count prompt', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const updates = [
    { rid: 930, bot_rid: 7, update_body: { callback_query: { id: 'add-callback', data: 'energybishubalanceadd', from: { id: 55 }, message: { message_id: 40, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➕增加地址笔数', callback_data: 'energybishubalanceadd' }]] } } } } },
    { rid: 931, bot_rid: 7, update_body: { message: { message_id: 42, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 41 }, text: address } } },
  ]
  const statements: Array<{ sql: string; values?: unknown[] }> = [], sent: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [updates.shift()!], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'bishu_add_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT tg_uid FROM t_energy_ai_bishu')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    for (const promptId of [41, 43]) {
      const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
        const method = String(input).split('/').pop()!
        sent.push({ method, payload: JSON.parse(String(init?.body)) })
        return Response.json({ ok: true, result: { message_id: promptId } })
      } })
      assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    }
    assert.deepEqual(sent.map(item => item.method), ['answerCallbackQuery', 'sendMessage', 'sendMessage'])
    assert.equal(sent[1].payload.reply_markup.force_reply, true)
    assert.match(sent[1].payload.text, /增加笔数扣除钱包USDT余额/u)
    assert.equal(sent[2].payload.reply_markup.force_reply, true)
    assert.match(sent[2].payload.text, new RegExp(address))
    assert.ok(statements.some(row => row.sql.includes("'bishu_add_address'")))
    assert.ok(statements.some(row => row.sql.includes("'bishu_add_count'") && row.values?.[4] === JSON.stringify({ walletAddr: address })))
  } finally { restoreEnv(env) }
})

test('energybishu count top-up debits exact cents transactionally and creates an inactive wallet', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 932, bot_rid: 7, update_body: { message: { message_id: 44, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 43 }, text: '3' } } }
  const sql: string[] = [], tx: Array<{ sql: string; values?: unknown[] }> = [], replies: any[] = []
  const purchase = { update_rid: 932, wallet_addr: address, quantity: 3, unit_price: '0.35', total_price: '1.05', previous_quantity: 0, new_quantity: 3, wallet_rid: 92, is_active: 'N' }
  const client = { query: async (statement: string, values?: unknown[]) => {
    tx.push({ sql: statement, values })
    if (statement.startsWith('SELECT update_rid')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('SELECT context FROM t_platform_telegram_conversation_state')) return { rows: [{ context: { walletAddr: address } }], rowCount: 1 }
    if (statement.startsWith('SELECT per_bishu_usdt_price')) return { rows: [{ per_bishu_usdt_price: '0.35' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,cash_usdt')) return { rows: [{ rid: 82, cash_usdt: '5.000000' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,bot_rid,tg_uid,max_buy_quantity')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('UPDATE t_telegram_bot_user SET cash_usdt')) return { rows: [{ cash_usdt: '3.950000' }], rowCount: 1 }
    if (statement.startsWith('INSERT INTO t_energy_ai_bishu')) return { rows: [{ rid: 92, is_active: 'N' }], rowCount: 1 }
    if (statement.startsWith('INSERT INTO t_platform_telegram_bishu_purchase')) return { rows: [purchase], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (statement: string, values?: unknown[]) => {
    sql.push(statement)
    if (statement.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (statement.startsWith('SELECT update_rid')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('SELECT state,context')) return { rows: [{ state: 'bishu_add_count', context: { walletAddr: address } }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      replies.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 45 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(tx.some(row => row.sql.startsWith('SELECT pg_advisory_xact_lock')))
    assert.ok(tx.some(row => row.sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt') && row.values?.[1] === '1.05'))
    assert.ok(tx.some(row => row.sql.startsWith('INSERT INTO t_energy_ai_bishu') && row.values?.[3] === '1.05' && row.values?.[4] === 3))
    assert.ok(tx.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_bishu_purchase') && row.values?.[0] === 932 && row.values?.[6] === '1.05'))
    assert.ok(tx.some(row => row.sql === 'COMMIT'))
    assert.match(replies[0].text, /扣除USDT：1\.05 USDT/u)
    assert.deepEqual(replies[0].reply_markup.inline_keyboard[0][0].callback_data, 'togglebishu_92_Y')
    assert.ok(sql.some(statement => statement.startsWith('UPDATE t_platform_telegram_update SET status=\'processed\'')))
  } finally { restoreEnv(env) }
})

test('private 添加笔数 command executes the native, idempotent USDT top-up transaction', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 1932, bot_rid: 7, update_body: { message: { message_id: 144, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: `添加笔数 ${address} 3` } } }
  const sql: string[] = [], tx: Array<{ sql: string; values?: unknown[] }> = [], replies: any[] = []
  const purchase = { update_rid: 1932, wallet_addr: address, quantity: 3, unit_price: '0.35', total_price: '1.05', previous_quantity: 0, new_quantity: 3, wallet_rid: 192, is_active: 'N' }
  const client = { query: async (statement: string, values?: unknown[]) => {
    tx.push({ sql: statement, values })
    if (statement.startsWith('SELECT update_rid')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('SELECT per_bishu_usdt_price')) return { rows: [{ per_bishu_usdt_price: '0.35' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,cash_usdt')) return { rows: [{ rid: 182, cash_usdt: '5.000000' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,bot_rid,tg_uid,max_buy_quantity')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('UPDATE t_telegram_bot_user SET cash_usdt')) return { rows: [{ cash_usdt: '3.950000' }], rowCount: 1 }
    if (statement.startsWith('INSERT INTO t_energy_ai_bishu')) return { rows: [{ rid: 192, is_active: 'N' }], rowCount: 1 }
    if (statement.startsWith('INSERT INTO t_platform_telegram_bishu_purchase')) return { rows: [purchase], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (statement: string, values?: unknown[]) => {
    sql.push(statement)
    if (statement.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (statement.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: '@support_bot' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      replies.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 145 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(sql.some(statement => statement.includes('添加笔数|增加笔数')))
    assert.deepEqual(tx.find(row => row.sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt'))?.values, [182, '1.05'])
    assert.ok(tx.some(row => row.sql.startsWith("SELECT pg_advisory_xact_lock(hashtextextended('telegram-bishu-purchase:' || $1,0))")))
    assert.deepEqual(replies.map(row => row.method), ['sendMessage'])
    assert.match(replies[0].payload.text, /本次新增次数：3/u)
    assert.match(replies[0].payload.text, /扣除USDT：1\.05 USDT/u)
    assert.ok(sql.some(statement => statement.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('retrying a completed energybishu top-up update reuses its ledger without a second debit', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 933, bot_rid: 7, update_body: { message: { message_id: 46, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 43 }, text: '3' } } }
  const previous = { update_rid: 933, wallet_addr: address, quantity: 3, unit_price: '0.35', total_price: '1.05', previous_quantity: 0, new_quantity: 3, wallet_rid: 93, is_active: 'N' }
  const statements: string[] = [], replies: any[] = []
  const pool = { query: async (statement: string) => {
    statements.push(statement)
    if (statement.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (statement.startsWith('SELECT update_rid')) return { rows: [previous], rowCount: 1 }
    if (statement.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: null }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => { throw new Error('idempotent retry must not start a purchase transaction') } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      replies.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 47 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.match(replies[0].text, /扣除USDT：1\.05 USDT/u)
    assert.ok(!statements.some(statement => statement.startsWith('SELECT state,context')))
  } finally { restoreEnv(env) }
})

test('energybishu top-up does not debit an insufficient balance or another user wallet', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const updates = [
    { rid: 934, bot_rid: 7, update_body: { message: { message_id: 48, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 43 }, text: '3' } } },
    { rid: 935, bot_rid: 7, update_body: { message: { message_id: 49, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 43 }, text: '3' } } },
  ]
  const tx: string[] = [], replies: any[] = []
  let transactionNumber = -1
  const client = { query: async (statement: string) => {
    tx.push(statement)
    if (statement === 'BEGIN') { transactionNumber++; return { rows: [], rowCount: 0 } }
    if (statement.startsWith('SELECT update_rid')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('SELECT context FROM t_platform_telegram_conversation_state')) return { rows: [{ context: { walletAddr: address } }], rowCount: 1 }
    if (statement.startsWith('SELECT per_bishu_usdt_price')) return { rows: [{ per_bishu_usdt_price: '0.35' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,cash_usdt')) return { rows: [{ rid: 82, cash_usdt: '0.500000' }], rowCount: 1 }
    if (statement.startsWith('SELECT rid,bot_rid,tg_uid,max_buy_quantity')) return transactionNumber === 0 ? { rows: [], rowCount: 0 } : { rows: [{ rid: 87, bot_rid: 7, tg_uid: '88', max_buy_quantity: 5, total_buy_usdt: '2.00', is_active: 'N' }], rowCount: 1 }
    if (statement.startsWith('UPDATE t_telegram_bot_user SET cash_usdt')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (statement: string) => {
    if (statement.startsWith('WITH candidates')) { const batch = updates.splice(0); return { rows: batch, rowCount: batch.length } }
    if (statement.startsWith('SELECT update_rid')) return { rows: [], rowCount: 0 }
    if (statement.startsWith('SELECT state,context')) return { rows: [{ state: 'bishu_add_count', context: { walletAddr: address } }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (statement.startsWith('SELECT cash_usdt::text')) return { rows: [{ cash_usdt: '0.500000' }], rowCount: 1 }
    if (statement.startsWith('SELECT per_bishu_usdt_price::text')) return { rows: [{ per_bishu_usdt_price: '0.35' }], rowCount: 1 }
    if (statement.startsWith('SELECT bot_admin_username FROM t_telegram_bot')) return { rows: [{ bot_admin_username: null }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => {
      replies.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 50 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 2, failed: 0 })
    assert.match(replies[0].text, /余额不足/u)
    assert.match(replies[1].text, /已被其他用户绑定/u)
    assert.equal(tx.filter(statement => statement.startsWith('UPDATE t_telegram_bot_user SET cash_usdt')).length, 1)
    assert.ok(!tx.some(statement => statement.startsWith('INSERT INTO t_energy_ai_bishu')))
    assert.ok(!tx.some(statement => statement.startsWith('INSERT INTO t_platform_telegram_bishu_purchase')))
    assert.equal(tx.filter(statement => statement === 'COMMIT').length, 0)
  } finally { restoreEnv(env) }
})

test('bindA callback renders the existing binding state and receive wallet', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 210, bot_rid: 7, update_body: { callback_query: { id: 'q1', data: 'bindA', from: { id: 55 }, message: { message_id: 80, chat: { id: 55, type: 'private' } } } } }
  let reply: any
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT is_enable,activate_threshold')) return { rows: [{ is_enable: 1, activate_threshold: '0', energy_platform_bot_rid: 9 }], rowCount: 1 }
    if (sql.startsWith('SELECT wallet_addr,status')) return { rows: [{ wallet_addr: 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZabc', status: 0 }], rowCount: 1 }
    if (sql.startsWith('SELECT receive_wallet')) return { rows: [{ receive_wallet: 'T9z7...receive' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => { reply = JSON.parse(String(init?.body)); return Response.json({ ok: true, result: { message_id: 81 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.match(reply.text, /绑A送N/)
    assert.match(reply.text, /待激活/)
    assert.match(reply.text, /T9z7\.\.\.receive/)
    assert.deepEqual(reply.reply_markup.inline_keyboard[0].map((button: any) => button.callback_data), ['bindABind', 'bindAUnbind', 'bindA'])
  } finally { restoreEnv(env) }
})

test('bindABind callback persists a five-minute prompt reply state', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 211, bot_rid: 7, update_body: { callback_query: { id: 'q2', data: 'bindABind', from: { id: 55 }, message: { message_id: 82, chat: { id: 55, type: 'private' } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT is_enable,activate_threshold')) return { rows: [{ is_enable: 1, activate_threshold: '0', energy_platform_bot_rid: null }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async () => Response.json({ ok: true, result: { message_id: 83 } }) })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(statements.find(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state'))?.values, [7, '55', '55'])
    assert.ok(statements.some(row => row.sql.includes("now()+interval '5 minutes'")))
    assert.ok(statements.some(row => row.sql.startsWith('UPDATE t_platform_telegram_conversation_state SET prompt_message_id=$4') && row.values?.[3] === 83))
  } finally { restoreEnv(env) }
})

test('replying to the bindA prompt creates one pending binding and confirms it', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 212, bot_rid: 7, update_body: { message: { message_id: 84, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 83 }, text: address } } }
  const statements: string[] = [], transactionSql: string[] = []
  const client = { query: async (sql: string) => { transactionSql.push(sql); return { rows: [], rowCount: 0 } }, release() {} }
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.includes("state='wallet_address'")) return { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT state FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'bindA_address' }], rowCount: 1 }
    if (sql.startsWith('SELECT is_enable,activate_threshold')) return { rows: [{ is_enable: 1, activate_threshold: '0', energy_platform_bot_rid: null }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  const replies: any[] = []
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => { replies.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, result: { message_id: 85 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(transactionSql.includes('BEGIN'))
    assert.ok(transactionSql.some(sql => sql.startsWith('INSERT INTO t_bind_a_send_n_binding')))
    assert.ok(transactionSql.includes('COMMIT'))
    assert.ok(statements.some(sql => sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
    assert.equal(replies.length, 1)
    assert.match(replies[0].text, /A 地址绑定成功/)
    assert.match(replies[0].text, new RegExp(address))
  } finally { restoreEnv(env) }
})

test('private TRON address lookup replies with mocked balance data and history buttons', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 213, bot_rid: 7, update_body: { message: { message_id: 86, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address } } }
  const requests: Array<{ url: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_username FROM t_telegram_bot')) return { rows: [{ bot_username: 'demo_bot' }], rowCount: 1 }
    if (sql.startsWith('SELECT config_val FROM t_sys_config')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input)
      const payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url, payload })
      if (url.includes('/api/accountv2')) return Response.json({ balance: '5000000', activated: true, withPriceTokens: [{ tokenId: '_', amount: '5' }, { tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', balance: '1000000', tokenDecimal: 6 }] })
      return Response.json({ ok: true, result: { message_id: 87 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const sent = requests.find(item => item.payload.chat_id === '55')?.payload
    assert.match(sent.text, /TRX余额：<code>5<\/code>/)
    assert.equal(sent.reply_to_message_id, '86')
    assert.equal(sent.reply_markup.inline_keyboard[1][1].callback_data, `searchusdtlistall${address}`)
    assert.ok(requests.some(item => item.url.includes('apilist.tronscanapi.com/api/accountv2')))
  } finally { restoreEnv(env) }
})

test('private address-history callback returns a native filtered reply', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 214, bot_rid: 7, update_body: { callback_query: { id: 'history-1', data: `searchusdtlistout${address}`, from: { id: 55 }, message: { message_id: 88, chat: { id: 55, type: 'private' } } } } }
  const requests: Array<{ url: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT config_val FROM t_sys_config')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input), payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url, payload })
      if (url.includes('/api/new/filter/trc20/transfers')) return Response.json({ token_transfers: [{ from_address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', to_address: address, quant: '2000000', block_ts: 1793232000000 }] })
      return Response.json({ ok: true, result: { message_id: 89 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(requests.some(item => item.url.includes('fromAddress=' + address)))
    const reply = requests.find(item => item.payload.chat_id === '55')?.payload
    assert.match(reply.text, /\+2 USDT/)
    assert.equal(reply.reply_markup.inline_keyboard[1][1].callback_data, `searchusdtlistout${address}`)
  } finally { restoreEnv(env) }
})

test('private EVM address lookup uses the configured API web service and replies with all chain balances', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  process.env.API_WEB_URL = 'https://api.example.test'
  const address = '0x52908400098527886E0F7030069857D2E4169EE7'
  const update = { rid: 215, bot_rid: 7, update_body: { message: { message_id: 90, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address } } }
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input); requests.push({ url, init })
      if (url.endsWith('/api/erc/addressgetbalance')) {
        assert.deepEqual(JSON.parse(String(init?.body)), { address })
        return Response.json({ code: 200, data: { ethbalance: '1.2', ethusdtbalance: '2', bnbbalance: '3', bnbusdtbalance: '4', okxbalance: '5', okxusdtbalance: '6' } })
      }
      return Response.json({ ok: true, result: { message_id: 91 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[0].url, 'https://api.example.test/api/erc/addressgetbalance')
    const reply = JSON.parse(String(requests[1].init?.body))
    assert.match(reply.text, /以太 ETH 余额：<b>1\.2<\/b>/)
    assert.match(reply.text, /欧易 USDT 余额：<b>6<\/b>/)
    assert.equal(reply.reply_to_message_id, '90')
    assert.equal(reply.reply_markup.inline_keyboard[1][0].url, `https://bscscan.com/address/${address}`)
  } finally { restoreEnv(env) }
})

test('private 查授权 command performs a native TRON approval lookup', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 216, bot_rid: 7, update_body: { message: { message_id: 92, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: `查授权 ${address}` } } }
  const requests: Array<{ url: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT config_val FROM t_sys_config')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input), payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url, payload })
      if (url.includes('/api/account/approve/list')) return Response.json({ total: 1, data: [{ to_address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', contract_address: address, operate_time: 1793232000000, tokenInfo: { tokenAbbr: 'USDT' }, project: { name: 'Safe wallet' }, amount: '2500000' }] })
      return Response.json({ ok: true, result: { message_id: 93 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const provider = requests.find(item => item.url.includes('/api/account/approve/list'))
    assert.ok(provider)
    assert.equal(new URL(provider.url).searchParams.get('address'), address)
    const sent = requests.find(item => item.payload.chat_id === '55')?.payload
    assert.match(sent.text, /当前地址有 <b>1<\/b> 个授权/)
    assert.match(sent.text, /2\.5/)
    assert.equal(sent.reply_to_message_id, '92')
    assert.equal(sent.reply_markup.inline_keyboard[0][0].url, `https://tronscan.org/#/address/${address}`)
  } finally { restoreEnv(env) }
})

test('private 查授权 callback answers promptly and returns the native approval lookup', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 217, bot_rid: 7, update_body: { callback_query: { id: 'approval-1', data: `查授权${address}`, from: { id: 55 }, message: { message_id: 94, chat: { id: 55, type: 'private' } } } } }
  const requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT config_val FROM t_sys_config')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input), method = url.includes('/api/account/approve/list') ? 'approval-provider' : url.split('/').pop()!
      const payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ method, payload })
      if (url.includes('/api/account/approve/list')) return Response.json({ total: 0, data: [] })
      return Response.json({ ok: true, result: { message_id: 95 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(item => item.method), ['answerCallbackQuery', 'approval-provider', 'sendMessage'])
    assert.equal(requests[0].payload.callback_query_id, 'approval-1')
    assert.equal(requests[2].payload.chat_id, '55')
    assert.match(requests[2].payload.text, /地址没有授权/)
  } finally { restoreEnv(env) }
})

test('private OKX C2C filter callback performs native refresh and answers the callback', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 218, bot_rid: 7, update_body: { callback_query: {
    id: 'okx-1', data: 'z2', from: { id: 55, username: 'alice' },
    message: { message_id: 96, chat: { id: 55, type: 'private' }, text: '<b>[Okex商家C2C实时top10 - 所有]</b>', reply_markup: { inline_keyboard: [[
      { text: '所有', callback_data: 'z0' }, { text: '银行卡', callback_data: 'z1' },
      { text: '支付宝', callback_data: 'z2' }, { text: '微信', callback_data: 'z3' },
    ]] } },
  } } }
  const requests: Array<{ method: string; url: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 19, bot_token: token, bot_username: 'sample_bot', bot_admin_username: 'support_bot', opt_type: 9, monitor_word: 'c2c', reply_photo: null, reply_content: '' }] }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const url = String(input)
      const method = url.includes('okx.com') ? 'okx-provider' : url.split('/').pop()!
      const payload = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ method, url, payload })
      if (url.includes('okx.com')) return Response.json({ code: '0', data: { sell: [{ price: '7.12', nickName: 'merchant', paymentMethods: ['aliPay'] }] } })
      return Response.json({ ok: true, result: { message_id: 97 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(item => item.method), ['answerCallbackQuery', 'okx-provider', 'sendMessage'])
    assert.equal(requests[0].payload.callback_query_id, 'okx-1')
    assert.match(requests[1].url, /paymentMethod=aliPay/u)
    assert.equal(requests[2].payload.chat_id, '55')
    assert.equal(requests[2].payload.reply_to_message_id, undefined)
    assert.match(requests[2].payload.text, /^@alice\n<b>\[Okex商家C2C实时top10 - 支付宝\]/u)
    assert.deepEqual(requests[2].payload.reply_markup.inline_keyboard[0][2], { text: '✅支付宝', callback_data: 'z2' })
  } finally { restoreEnv(env) }
})

test('group OKX C2C filter callback refreshes the same group without replying to the prior message', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 219, bot_rid: 7, update_body: { callback_query: {
    id: 'okx-group-1', data: 'z1', from: { id: 55, username: 'alice' },
    message: { message_id: 98, chat: { id: -1007, type: 'supergroup' }, text: '[Okex商家C2C实时top10 - 所有]', reply_markup: { inline_keyboard: [[{ text: '银行卡', callback_data: 'z1' }]] } },
  } } }
  const payloads: any[] = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 19, bot_token: token, bot_username: 'sample_bot', bot_admin_username: 'support_bot', opt_type: 9, monitor_word: 'c2c', reply_photo: null, reply_content: '' }] }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      if (String(input).includes('okx.com')) return Response.json({ code: '0', data: { sell: [] } })
      payloads.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 99 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(payloads.length, 2)
    assert.equal(payloads[1].chat_id, '-1007')
    assert.equal(payloads[1].reply_to_message_id, undefined)
    assert.match(payloads[1].text, /^@alice\n/u)
    assert.equal(payloads[1].reply_markup.inline_keyboard[0][0].text, '所有')
  } finally { restoreEnv(env) }
})

test('verification /start token opens the matching Telegram Mini App challenge', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  process.env.PLATFORM_ORIGIN = 'https://platform.example.test'
  const verifyToken = 'a'.repeat(64)
  const tokenHash = createHash('sha256').update(verifyToken).digest('hex')
  const update = { rid: 31, bot_rid: 7, update_body: { message: { message_id: 71, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: `/start ${verifyToken}` } } }
  const sql: string[] = [], telegram: Array<{ method: string; payload: any }> = []
  const pool = { query: async (q: string, values?: unknown[]) => {
    sql.push(q)
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT rid,user_id::text,status,expires_at,mini_app_message_id')) {
      assert.deepEqual(values, [7, tokenHash])
      return { rows: [{ rid: 18, user_id: '55', status: 'pending', expires_at: new Date(Date.now() + 60_000), mini_app_message_id: 44 }], rowCount: 1 }
    }
    if (q.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      telegram.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 45 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(telegram.map(row => row.method), ['deleteMessage', 'sendMessage'])
    assert.equal(telegram[1].payload.reply_markup.inline_keyboard[0][0].web_app.url, `https://platform.example.test/api/moderation?verify=${verifyToken}`)
    assert.ok(sql.some(q => q.startsWith('UPDATE t_telegram_verification SET mini_app_message_id=$2')))
    assert.ok(sql.some(q => q.startsWith('UPDATE t_platform_telegram_update')))
  } finally { restoreEnv(env) }
})

test('support preflight matches edited private updates against the native handler predicates', async () => {
  const update = { edited_message: { message_id: 10, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '/start' } }
  let statement = '', values: unknown[] = []
  const pool = { query: async (sql: string, params?: unknown[]) => {
    statement = sql
    values = params ?? []
    return { rows: [{ claimable: true }], rowCount: 1 }
  } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, update), true)
  assert.ok(statement.includes("u.update_body ? 'edited_message'"))
  assert.ok(statement.includes("'{edited_message,chat,type}'='private'"))
  assert.ok(statement.includes("'{edited_message,text}'"))
  assert.ok(statement.includes("'{callback_query,message,chat,type}'"))
  assert.deepEqual(values, [7, JSON.stringify(update)])
})

test('private edited /start is processed by the native user and keyword handlers', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 33, bot_rid: 7, update_body: { edited_message: { message_id: 12, chat: { id: 55, type: 'private' }, from: { id: 55, first_name: 'Alice' }, text: '/start' } } }
  const requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (q: string) => q.startsWith('SELECT rid FROM t_telegram_bot_user') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }, release() {} }
  const pool = { query: async (q: string) => {
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT bot_token,bot_username')) return { rows: [{ bot_token: token, bot_username: 'demo_bot' }], rowCount: 1 }
    if (q.includes('FROM t_telegram_bot_keyreply kr JOIN')) return { rows: [{ rid: 1, bot_token: token, bot_username: 'demo_bot', opt_type: 1, monitor_word: '/start', reply_content: 'Welcome', reply_photo: null }] }
    return { rows: [], rowCount: 0 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 13 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'sendMessage')
    assert.equal(requests[0].payload.text, 'Welcome')
    assert.equal(requests[0].payload.chat_id, '55')
  } finally { restoreEnv(env) }
})

test('support preflight returns false when no worker-claimable update exists', async () => {
  const pool = { query: async () => ({ rows: [{ claimable: false }], rowCount: 1 }) }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, { message: {} }), false)
})

test('disabled support worker has no database or Telegram side effects', async () => {
  const result = await syncTelegramSupportUpdates({ enabled: false, pool: { query: async () => { throw new Error('unexpected query') } } as never, fetcher: async () => { throw new Error('unexpected request') } })
  assert.deepEqual(result, { skipped: true, processed: 0, failed: 0 })
})

test('support start opens a session when captcha is disabled', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const sql: string[] = [], methods: string[] = []
  const update = { rid: 4, bot_rid: 7, update_body: { message: { message_id: 10, chat: { id: 55, type: 'private' }, from: { id: 55, first_name: 'Guest' }, text: '/support' } } }
  const pool = { query: async (q: string) => {
    sql.push(q)
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: token, bot_username: '@bot', bot_admin_username: 'admin', support_enabled: true, support_captcha_enabled: false, support_verified_minutes: 1440, ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (q.startsWith('SELECT tg_uid')) return { rows: [{ tg_uid: '99' }], rowCount: 1 }
    if (q.startsWith('INSERT INTO t_telegram_verification')) return { rows: [], rowCount: 1 }
    if (q.startsWith('INSERT INTO t_telegram_moderation_log') || q.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input) => { methods.push(String(input).split('/').pop()!); return Response.json({ ok: true, result: { message_id: 44 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(methods, ['sendMessage'])
    assert.ok(sql.some(q => q.includes("verification_type,status,expires_at,verified_at")))
  } finally { restoreEnv(env) }
})

test('support captcha exposes a Telegram WebApp verification button with the configured origin only', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  process.env.PLATFORM_ORIGIN = 'https://platform.example.test'
  let markup: any
  const update = { rid: 5, bot_rid: 7, update_body: { message: { message_id: 11, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '人工客服' } } }
  const pool = { query: async (q: string) => {
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: token, bot_username: '@bot', bot_admin_username: 'admin', support_enabled: true, support_captcha_enabled: true, support_verified_minutes: 1440, ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (q.startsWith('SELECT tg_uid')) return { rows: [{ tg_uid: '99' }], rowCount: 1 }
    if (q.startsWith('INSERT INTO t_telegram_verification')) return { rows: [{ rid: 9 }], rowCount: 1 }
    if (q.startsWith('INSERT INTO t_telegram_moderation_log') || q.startsWith('UPDATE t_telegram_verification') || q.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (_input, init) => { markup = JSON.parse(String(init?.body)).reply_markup; return Response.json({ ok: true, result: { message_id: 45 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(markup.inline_keyboard[0][0].web_app.url.startsWith('https://platform.example.test/api/moderation?verify='), true)
  } finally { restoreEnv(env) }
})

test('only the configured administrator can reply through the exact support message mapping', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 6, bot_rid: 7, update_body: { message: { message_id: 90, chat: { id: 99, type: 'private' }, from: { id: 99, username: 'admin' }, reply_to_message: { message_id: 700 }, text: '已处理' } } }
  const queries: string[] = [], methods: string[] = []
  const pool = { query: async (q: string) => {
    queries.push(q)
    if (q.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (q.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: token, bot_username: '@bot', bot_admin_username: 'admin', support_enabled: true, support_captcha_enabled: false, support_verified_minutes: 1440, ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (q.startsWith('SELECT tg_uid')) return { rows: [{ tg_uid: '99' }], rowCount: 1 }
    if (q.startsWith('SELECT user_id::text FROM t_telegram_support_message')) return { rows: [{ user_id: '55' }], rowCount: 1 }
    if (q.startsWith('INSERT INTO t_telegram_support_message') || q.startsWith('INSERT INTO t_telegram_moderation_log') || q.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input) => { methods.push(String(input).split('/').pop()!); return Response.json({ ok: true, result: { message_id: 901 } }) } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(methods, ['copyMessage'])
    assert.ok(queries.some(q => q.includes('support_chat_id=$2 AND support_message_id=$3')))
    assert.ok(queries.some(q => q.includes("INSERT INTO t_telegram_support_message") && q.includes("support_to_user")))
  } finally { restoreEnv(env) }
})

test('monitor wallet list callback paginates the caller-owned addresses and keeps the legacy actions available', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3000, bot_rid: 7, update_body: { callback_query: { id: 'monitor-page-2', data: 'monitorwallet_2', from: { id: 55 }, message: { message_id: 99, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➡️下一页', callback_data: 'monitorwallet_2' }]] } } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT cash_trx::text,cash_usdt::text')) return { rows: [{ cash_trx: '8.000000', cash_usdt: '6.250000', max_monitor_wallet: 20 }], rowCount: 1 }
    if (query.startsWith('SELECT COALESCE((SELECT free_monitor_wallet')) return { rows: [{ free_limit: 4 }], rowCount: 1 }
    if (query.startsWith('SELECT count(*)::int AS total FROM t_monitor_wallet')) return { rows: [{ total: 12 }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet')) return { rows: [{ monitor_wallet: 'TAddress11' }, { monitor_wallet: 'TAddress12' }], rowCount: 2 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 100 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const message = requests.find(row => row.method === 'sendMessage')!.payload
    assert.match(message.text, /当前已监控地址：12 个（2\/2）/u)
    assert.match(message.text, /TAddress11/u)
    assert.ok(message.reply_markup.inline_keyboard.some((row: any[]) => row.some(button => button.callback_data === 'monitorwallet_1')))
    assert.ok(message.reply_markup.inline_keyboard.some((row: any[]) => row.some(button => button.callback_data === 'monitorwalletfunc_1')))
    assert.ok(message.reply_markup.inline_keyboard[1].some((button: any) => button.url === 'https://t.me/support_admin'))
    assert.ok(sql.some(row => row.query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet') && row.values?.[2] === 10))
  } finally { restoreEnv(env) }
})

test('monitor wallet function toggle is scoped to the owner and callback retry does not toggle twice', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3010, bot_rid: 7, update_body: { callback_query: { id: 'monitor-toggle-usdt-1', data: 'monitorwalletupdatefuncusdt_45', from: { id: 55 }, message: { message_id: 109, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'USDT交易监听', callback_data: 'monitorwalletupdatefuncusdt_45' }]] } } } } }
  const wallet = { rid: 45, monitor_wallet: 'TMonitorOwned', monitor_usdt_transaction: 'NN', monitor_trx_transaction: 'YY', monitor_approve_transaction: 'NN', monitor_multi_transaction: 'NN', monitor_pledge_transaction: 'YY' }
  let toggleCount = 0, ledgerCount = 0
  const client = { query: async (query: string, values?: unknown[]) => {
    if (query.startsWith('SELECT update_rid FROM t_platform_telegram_monitor_wallet_toggle')) return { rows: ledgerCount ? [{ update_rid: 3010 }] : [], rowCount: ledgerCount ? 1 : 0 }
    if (query.startsWith('SELECT rid,monitor_wallet,monitor_usdt_transaction')) return { rows: [{ ...wallet }], rowCount: 1 }
    if (query.startsWith('UPDATE t_monitor_wallet SET')) {
      assert.match(query, /WHERE rid=\$2 AND bot_rid=\$3 AND tg_notice_obj=\$4/u)
      wallet.monitor_usdt_transaction = String(values?.[0])
      toggleCount++
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('INSERT INTO t_platform_telegram_monitor_wallet_toggle')) { ledgerCount++; return { rows: [], rowCount: 1 } }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (query: string) => {
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT rid,monitor_wallet,monitor_usdt_transaction')) return { rows: [{ ...wallet }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  const messages: any[] = []
  try {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => { const method = String(input).split('/').pop()!; const payload = JSON.parse(String(init?.body)); if (method === 'sendMessage') messages.push(payload); return Response.json({ ok: true, result: { message_id: 110 } }) }
    assert.deepEqual(await syncTelegramSupportUpdates({ pool: pool as never, fetcher }), { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(await syncTelegramSupportUpdates({ pool: pool as never, fetcher }), { skipped: false, processed: 1, failed: 0 })
    assert.equal(toggleCount, 1)
    assert.equal(ledgerCount, 1)
    assert.equal(wallet.monitor_usdt_transaction, 'YY')
    assert.equal(messages.length, 2)
    assert.match(messages[1].text, /USDT交易监听：<u>✅已开启<\/u>/u)
  } finally { restoreEnv(env) }
})

test('monitor wallet add callback stores an expiring private prompt using purchased and free quota', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3001, bot_rid: 7, update_body: { callback_query: { id: 'monitor-add', data: 'monitorddaddress', from: { id: 55 }, message: { message_id: 100, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➕添加监控地址', callback_data: 'monitorddaddress' }]] } } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT max_monitor_wallet')) return { rows: [{ max_monitor_wallet: 3 }], rowCount: 1 }
    if (query.startsWith('SELECT COALESCE((SELECT free_monitor_wallet')) return { rows: [{ free_limit: 5 }], rowCount: 1 }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet')) return { rows: [{ monitor_wallet: 'TRecentWallet' }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 101 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /<b>当前已监控：<\/b>1 个/u)
    assert.match(requests[1].payload.text, /还可以监控：7 个/u)
    assert.ok(sql.some(row => row.query.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.query.includes("'monitor_add_address'") && row.values?.[3] === '101'))
  } finally { restoreEnv(env) }
})

test('monitor wallet delete callback lists only caller-owned addresses and creates a two-minute reply state', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3002, bot_rid: 7, update_body: { callback_query: { id: 'monitor-delete', data: 'monitordeleteaddress', from: { id: 55 }, message: { message_id: 102, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '➖删除监控地址', callback_data: 'monitordeleteaddress' }]] } } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT max_monitor_wallet')) return { rows: [{ max_monitor_wallet: 2 }], rowCount: 1 }
    if (query.startsWith('SELECT COALESCE((SELECT free_monitor_wallet')) return { rows: [{ free_limit: 4 }], rowCount: 1 }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet')) return { rows: [{ monitor_wallet: 'TPrivateWallet' }, { monitor_wallet: 'TSecondWallet' }], rowCount: 2 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: 'support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 103 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[1].payload.reply_markup.force_reply, true)
    assert.match(requests[1].payload.text, /TPrivateWallet/u)
    assert.match(requests[1].payload.text, /剩余可监控：4 个/u)
    assert.ok(sql.some(row => row.query.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.query.includes("'monitor_delete_address'")))
  } finally { restoreEnv(env) }
})

test('monitor wallet note pager lists only caller-owned wallets with note selection callbacks', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3011, bot_rid: 7, update_body: { callback_query: { id: 'monitor-note-page', data: 'monitorwalletupdate_2', from: { id: 55 }, message: { message_id: 111, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '🛠修改备注', callback_data: 'monitorwalletupdate_2' }]] } } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 9 }], rowCount: 1 }
    if (query.startsWith('SELECT count(*)::int AS total FROM t_monitor_wallet')) return { rows: [{ total: 12 }], rowCount: 1 }
    if (query.startsWith('SELECT rid,monitor_wallet,comments FROM t_monitor_wallet')) return { rows: [{ rid: 78, monitor_wallet: 'TPrivateWallet', comments: '主钱包' }, { rid: 77, monitor_wallet: 'TOtherWallet', comments: null }], rowCount: 2 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 112 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const message = requests.find(row => row.method === 'sendMessage')!.payload
    assert.match(message.text, /12 个/u)
    assert.equal(message.reply_markup.inline_keyboard[0][0].callback_data, 'monitorwalletupdatewallet_78')
    assert.match(message.reply_markup.inline_keyboard[0][0].text, /主钱包/u)
    assert.ok(message.reply_markup.inline_keyboard.some((row: any[]) => row.some(button => button.callback_data === 'monitorwalletupdate_1')))
    assert.ok(sql.some(row => row.query.startsWith('SELECT rid,monitor_wallet,comments FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2') && row.values?.join(',') === '7,55,10'))
  } finally { restoreEnv(env) }
})

test('monitor wallet note selection creates a two-minute owner-scoped ForceReply state', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3012, bot_rid: 7, update_body: { callback_query: { id: 'monitor-note-select', data: 'monitorwalletupdatewallet_78', from: { id: 55 }, message: { message_id: 113, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'TPrivateWallet', callback_data: 'monitorwalletupdatewallet_78' }]] } } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: 9 }], rowCount: 1 }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet WHERE rid=$1')) return { rows: [{ monitor_wallet: 'TPrivateWallet' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 114 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const prompt = requests.find(row => row.method === 'sendMessage')!.payload
    assert.equal(prompt.reply_markup.force_reply, true)
    assert.match(prompt.text, /输入50个汉字内的备注/u)
    assert.ok(sql.some(row => row.query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3') && row.values?.join(',') === '78,7,55'))
    assert.ok(sql.some(row => row.query.startsWith('INSERT INTO t_platform_telegram_conversation_state') && row.query.includes("'monitor_update_comment'") && row.values?.[4] === '{"walletRid":78}'))
  } finally { restoreEnv(env) }
})

test('monitor wallet note reply truncates by Unicode character, scopes the write, and atomically consumes state with the inbox item', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const comment = '备注'.repeat(51)
  const update = { rid: 3013, bot_rid: 7, update_body: { message: { message_id: 115, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: comment, reply_to_message: { message_id: 114 } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], tx: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (query: string, values?: unknown[]) => { tx.push({ query, values }); return { rows: [], rowCount: 1 } }, release() {} }
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query.startsWith('SELECT context FROM t_platform_telegram_conversation_state')) return { rows: [{ context: { walletRid: 78 } }], rowCount: 1 }
    if (query.startsWith('UPDATE t_monitor_wallet SET comments=$1')) return { rows: [{ monitor_wallet: 'TPrivateWallet' }], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 116 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    const write = sql.find(row => row.query.startsWith('UPDATE t_monitor_wallet SET comments=$1'))!
    assert.equal(Array.from(String(write.values?.[0])).length, 50)
    assert.deepEqual(write.values?.slice(1), [78, 7, '55'])
    assert.match(requests.find(row => row.method === 'sendMessage')!.payload.text, /备注修改成功/u)
    assert.ok(tx.some(row => row.query.startsWith('DELETE FROM t_platform_telegram_conversation_state') && row.values?.join(',') === '3013,55,55,114'))
    assert.ok(tx.some(row => row.query.startsWith("UPDATE t_platform_telegram_update SET status='processed'") && row.values?.[0] === 3013 && String(row.values?.[1]).startsWith('support-sync-')))
    assert.ok(tx.some(row => row.query === 'COMMIT'))
  } finally { restoreEnv(env) }
})

test('replying to monitor wallet add enforces blacklist, global duplicates, user quota, and stores inactive TRON wallet', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb'
  const update = { rid: 3003, bot_rid: 7, update_body: { message: { message_id: 104, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address, reply_to_message: { message_id: 101 } } } }
  const sql: Array<{ query: string; values?: unknown[] }> = [], tx: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  let inserted = false
  const client = { query: async (query: string, values?: unknown[]) => {
    tx.push({ query, values })
    if (query.startsWith('SELECT max_monitor_wallet')) return { rows: [{ max_monitor_wallet: 3 }], rowCount: 1 }
    if (query.startsWith('SELECT rid FROM t_transit_wallet_black')) return { rows: [], rowCount: 0 }
    if (query.startsWith('SELECT rid FROM t_monitor_wallet WHERE monitor_wallet=')) return { rows: [], rowCount: 0 }
    if (query.startsWith('SELECT count(*)::int AS total FROM t_monitor_wallet')) return { rows: [{ total: inserted ? 2 : 1 }], rowCount: 1 }
    if (query.startsWith('SELECT COALESCE((SELECT free_monitor_wallet')) return { rows: [{ free_limit: 5 }], rowCount: 1 }
    if (query.startsWith('INSERT INTO t_monitor_wallet')) { inserted = true; return { rows: [], rowCount: 1 } }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet')) return { rows: inserted ? [{ monitor_wallet: address }, { monitor_wallet: 'TOldWallet' }] : [{ monitor_wallet: 'TOldWallet' }], rowCount: inserted ? 2 : 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (query: string, values?: unknown[]) => {
    sql.push({ query, values })
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query.startsWith('DELETE FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'monitor_add_address' }], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 105 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(tx.some(row => row.query === 'BEGIN') && tx.some(row => row.query === 'COMMIT'))
    assert.ok(tx.some(row => row.query.includes("'telegram-monitor-wallet-address:'") && row.values?.[0] === address))
    assert.ok(tx.some(row => row.query.startsWith("INSERT INTO t_monitor_wallet(chain_type,monitor_wallet,status,bot_rid,tg_notice_obj,create_time) VALUES('trc',$1,0,$2,$3,now())") && row.values?.join(',') === `${address},7,55`))
    assert.match(requests[0].payload.text, /监控钱包地址已添加成功/u)
    assert.match(requests[0].payload.text, new RegExp(address))
    assert.ok(sql.some(row => row.query.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
  } finally { restoreEnv(env) }
})

test('replying to monitor wallet delete removes only the caller bot and chat address', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb'
  const update = { rid: 3004, bot_rid: 7, update_body: { message: { message_id: 106, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: address, reply_to_message: { message_id: 103 } } } }
  const tx: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (query: string, values?: unknown[]) => {
    tx.push({ query, values })
    if (query.startsWith('SELECT max_monitor_wallet')) return { rows: [{ max_monitor_wallet: 2 }], rowCount: 1 }
    if (query.startsWith('SELECT rid FROM t_monitor_wallet WHERE bot_rid=')) return { rows: [{ rid: 78 }], rowCount: 1 }
    if (query.startsWith('DELETE FROM t_monitor_wallet')) return { rows: [], rowCount: 1 }
    if (query.startsWith('SELECT monitor_wallet FROM t_monitor_wallet')) return { rows: [{ monitor_wallet: 'TOtherWallet' }], rowCount: 1 }
    if (query.startsWith('SELECT count(*)::int AS total FROM t_monitor_wallet')) return { rows: [{ total: 1 }], rowCount: 1 }
    if (query.startsWith('SELECT COALESCE((SELECT free_monitor_wallet')) return { rows: [{ free_limit: 4 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (query: string, values?: unknown[]) => {
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query.startsWith('DELETE FROM t_platform_telegram_conversation_state')) return { rows: [{ state: 'monitor_delete_address' }], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: 'support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 107 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.ok(tx.some(row => row.query.startsWith('DELETE FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3') && row.values?.join(',') === '78,7,55'))
    assert.match(requests[0].payload.text, /监控地址已删除成功/u)
  } finally { restoreEnv(env) }
})

test('monitorwalletbuy renders configured packages from the active private opt_type 6 menu', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3005, bot_rid: 7, update_body: { callback_query: { id: 'monitor-buy-menu', data: 'monitorwalletbuy', from: { id: 55 }, message: { message_id: 108, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '💎购买监控包', callback_data: 'monitorwalletbuy' }]] } } } } }
  const sql: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (query: string) => {
    sql.push(query)
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT cash_trx::text,cash_usdt::text,max_monitor_wallet')) return { rows: [{ cash_trx: '3.000000', cash_usdt: '20.000000', max_monitor_wallet: 6 }], rowCount: 1 }
    if (query.startsWith('SELECT free_monitor_wallet,price_usdt_5')) return { rows: [{ free_monitor_wallet: 4, price_usdt_5: '5.0000', price_usdt_10: '8.0000', price_usdt_20: '0.0000', price_usdt_50: '20.0000', price_usdt_100: '30.0000', price_usdt_200: '50.0000' }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: '@support_admin' }], rowCount: 1 }
    if (query.startsWith('SELECT count(*)::int AS count FROM t_monitor_wallet')) return { rows: [{ count: 2 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 109 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.match(requests[1].payload.text, /总可监控数量：<\/b><code>10<\/code>/u)
    assert.match(requests[1].payload.text, /剩余可监控数量：<\/b><code>8<\/code>/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard[0], [
      { text: '🔥5个(5 U)', callback_data: 'buywalletmonitor5' },
      { text: '🔥10个(8 U)', callback_data: 'buywalletmonitor10' },
      { text: '🔥50个(20 U)', callback_data: 'buywalletmonitor50' },
    ])
    assert.ok(sql.some(query => query.includes('kr.status=0 AND kr.opt_type=6')))
  } finally { restoreEnv(env) }
})

test('monitor package purchase debits exact USDT and increases quota once across inbox retries', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 3006, bot_rid: 7, update_body: { callback_query: { id: 'monitor-purchase-unique', data: 'buywalletmonitor5', from: { id: 55 }, message: { message_id: 110, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '🔥5个(5.25 U)', callback_data: 'buywalletmonitor5' }]] } } } } }
  const sql: string[] = [], tx: Array<{ query: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  let ledger: any = null, balance = '7.125000', quota = 3, updates = 0
  const client = { query: async (query: string, values?: unknown[]) => {
    tx.push({ query, values })
    if (query.startsWith('SELECT outcome,package_wallets')) return { rows: ledger ? [ledger] : [], rowCount: ledger ? 1 : 0 }
    if (query.startsWith('SELECT rid,cash_usdt::text,max_monitor_wallet')) return { rows: [{ rid: 4, cash_usdt: balance, max_monitor_wallet: quota }], rowCount: 1 }
    if (query.startsWith('SELECT price_usdt_5::text')) return { rows: [{ price_usdt_5: '5.2500', price_usdt_10: '8.0000', price_usdt_20: '13.0000', price_usdt_50: '24.0000', price_usdt_100: '38.0000', price_usdt_200: '56.0000' }], rowCount: 1 }
    if (query.startsWith('UPDATE t_telegram_bot_user SET cash_usdt=')) { balance = String(values?.[0]); quota = Number(values?.[1]); updates++; return { rows: [], rowCount: 1 } }
    if (query.startsWith('INSERT INTO t_platform_telegram_monitor_wallet_purchase')) {
      ledger = { outcome: values?.[6], package_wallets: values?.[4], price_usdt: values?.[5], balance_before: values?.[7], balance_after: values?.[8], quota_before: values?.[9], quota_after: values?.[10] }
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (query: string) => {
    sql.push(query)
    if (query.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (query === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (query.startsWith('SELECT bot_admin_username')) return { rows: [{ bot_admin_username: 'support_admin' }], rowCount: 1 }
    if (query.startsWith("UPDATE t_platform_telegram_update SET status='processed'")) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 111 } })
    }
    const first = await syncTelegramSupportUpdates({ pool: pool as never, fetcher })
    const replay = await syncTelegramSupportUpdates({ pool: pool as never, fetcher })
    assert.deepEqual(first, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(replay, { skipped: false, processed: 1, failed: 0 })
    assert.equal(balance, '1.875000')
    assert.equal(quota, 8)
    assert.equal(updates, 1)
    assert.equal(ledger.outcome, 'purchased')
    assert.equal(ledger.price_usdt, '5.250000')
    assert.ok(tx.some(row => row.query.includes('telegram-monitor-wallet-purchase:') && row.values?.[0] === 'monitor-purchase-unique'))
    assert.ok(tx.some(row => row.query.startsWith('INSERT INTO t_platform_telegram_monitor_wallet_purchase') && row.values?.[0] === 3006))
    assert.equal(requests.filter(row => row.method === 'sendMessage' && /购买成功/u.test(row.payload.text)).length, 2)
  } finally { restoreEnv(env) }
})

test('buygoods page callback lists available code keys with safe notes and legacy pagination', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 4101, bot_rid: 7, update_body: { callback_query: { id: 'goods-page-2', data: 'buygoods12_2', from: { id: 55 }, message: { message_id: 120, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Example', callback_data: 'buygoods12_2' }]] } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token, bot_admin_username: '@support_admin' }], rowCount: 1 }
    if (sql.startsWith('SELECT 1 FROM t_telegram_bot_user')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::int AS total')) return { rows: [{ total: 21 }], rowCount: 1 }
    if (sql.startsWith('SELECT a.rid,a.cdkey_no,b.show_notes')) return { rows: [{ rid: 75, cdkey_no: 'CARD-75', show_notes: '<商品说明 & more>' }, { rid: 74, cdkey_no: 'CARD-74', show_notes: 'unused' }], rowCount: 2 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 121 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.match(requests[1].payload.text, /&lt;商品说明 &amp; more&gt;/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard, [
      [{ text: 'CARD-75', callback_data: 'buygoodscdkey75' }],
      [{ text: 'CARD-74', callback_data: 'buygoodscdkey74' }],
      [{ text: '🔥我要充值', callback_data: 'aitrusteeshiprechargetrx' }, { text: '👨联系客服', url: 'https://t.me/support_admin' }],
      [{ text: '⬅️上一页', callback_data: 'buygoods12_1' }, { text: '➡️下一页', callback_data: 'buygoods12_3' }],
    ])
    assert.ok(statements.some(row => row.sql.startsWith('SELECT a.rid,a.cdkey_no,b.show_notes') && row.values?.join(',') === '12,10'))
  } finally { restoreEnv(env) }
})

test('buygoods page callback preserves the private-chat-only group response', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 4102, bot_rid: 7, update_body: { callback_query: { id: 'goods-page-group', data: 'buygoods12_1', from: { id: 55 }, message: { message_id: 122, chat: { id: -1007, type: 'supergroup' }, reply_markup: { inline_keyboard: [[{ text: 'Example', callback_data: 'buygoods12_1' }]] } } } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token, bot_admin_username: 'support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 123 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[1].payload.text, '购买商品请私聊机器人！')
    assert.equal(requests[1].payload.reply_markup, undefined)
    assert.ok(!statements.some(sql => sql.includes('t_shop_goods_cdkey')))
  } finally { restoreEnv(env) }
})

test('buygoodscdkey selection shows exact discounted prices and available balance methods', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 4103, bot_rid: 7, update_body: { callback_query: { id: 'goods-select', data: 'buygoodscdkey75', from: { id: 55 }, message: { message_id: 124, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'CARD-75', callback_data: 'buygoodscdkey75' }]] } } } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token, bot_admin_username: '@support_admin' }], rowCount: 1 }
    if (sql.startsWith('SELECT 1 FROM t_telegram_bot_user')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
    if (sql.startsWith('SELECT a.rid,a.cdkey_no,a.cdkey_usdt_price::text')) return { rows: [{ rid: 75, cdkey_no: 'CARD<&75', cdkey_usdt_price: '0', cdkey_trx_price: '2.5000', goods_usdt_price: '12.5000', goods_trx_price: '5.0000', goods_usdt_discount: '0.80', goods_trx_discount: '0.90', cash_trx: '2.250000', cash_usdt: '12.500000' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 125 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(row => row.method), ['answerCallbackQuery', 'sendMessage'])
    assert.match(requests[1].payload.text, /<code>CARD&lt;&amp;75<\/code>/u)
    assert.match(requests[1].payload.text, /TRX：2\.25 或者支付USDT：10/u)
    assert.match(requests[1].payload.text, /<code>2\.25<\/code>/u)
    assert.match(requests[1].payload.text, /<code>12\.5<\/code>/u)
    assert.deepEqual(requests[1].payload.reply_markup.inline_keyboard, [[
      { text: 'TRX 余额支付', callback_data: 'buygoodscdkeyconfirmtrx75' },
      { text: 'USDT 余额支付', callback_data: 'buygoodscdkeyconfirmusdt75' },
    ]])
    assert.ok(statements.some(sql => sql.includes('JOIN t_shop_goods_bot c ON c.goods_rid=b.rid AND c.bot_rid=$1 AND c.status=0')))
  } finally { restoreEnv(env) }
})

test('buygoodscdkey selection preserves the private-chat-only group response', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 4104, bot_rid: 7, update_body: { callback_query: { id: 'goods-select-group', data: 'buygoodscdkey75', from: { id: 55 }, message: { message_id: 126, chat: { id: -1007, type: 'supergroup' }, reply_markup: { inline_keyboard: [[{ text: 'CARD-75', callback_data: 'buygoodscdkey75' }]] } } } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token, bot_admin_username: 'support_admin' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 127 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[1].payload.text, '购买商品请私聊机器人！')
    assert.equal(requests[1].payload.reply_markup, undefined)
    assert.ok(!statements.some(sql => sql.includes('t_shop_goods_cdkey')))
  } finally { restoreEnv(env) }
})

test('buygoodscdkey confirmation atomically debits once and delivers the credential once', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.TRON_RSA_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const cipher = 'v2:' + publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from('ONE-TIME-TEST-CREDENTIAL')).toString('base64')
  const update = { rid: 4201, bot_rid: 7, update_body: { callback_query: { id: 'shop-purchase-callback-1', data: 'buygoodscdkeyconfirmtrx75', from: { id: 55, username: 'alice' }, message: { message_id: 130, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'TRX 余额支付', callback_data: 'buygoodscdkeyconfirmtrx75' }]] } } } } }
  let balance = '3.000000', cardStatus = 1, ledger: any = null, orders = 0, delivered = 0
  const requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT update_rid,outcome,delivery_status,order_rid FROM t_platform_telegram_shop_purchase WHERE callback_query_id=')) return { rows: ledger ? [ledger] : [], rowCount: ledger ? 1 : 0 }
    if (sql.startsWith('SELECT rid,cash_trx::text,cash_usdt::text FROM t_telegram_bot_user')) return { rows: [{ rid: 90, cash_trx: balance, cash_usdt: '0.000000' }], rowCount: 1 }
    if (sql.startsWith('SELECT a.rid,a.cdkey_no,a.cdkey_pwd')) return cardStatus === 1 ? { rows: [{ rid: 75, cdkey_no: 'CARD-75', cdkey_pwd: cipher, cdkey_trx_price: '2.5000', cdkey_usdt_price: '0', goods_trx_price: '0', goods_usdt_price: '0', goods_trx_discount: '0.9000', goods_usdt_discount: '0.8000' }], rowCount: 1 } : { rows: [], rowCount: 0 }
    if (sql.startsWith('UPDATE t_telegram_bot_user')) { assert.equal(values?.[1], '2.25'); balance = '0.750000'; return { rows: [{ cash_after: balance }], rowCount: 1 } }
    if (sql.startsWith('UPDATE t_shop_goods_cdkey SET status=2')) { cardStatus = 2; return { rows: [{ rid: 75 }], rowCount: 1 } }
    if (sql.startsWith('INSERT INTO t_shop_order')) { orders++; return { rows: [{ rid: 601 }], rowCount: 1 } }
    if (sql.startsWith('INSERT INTO t_platform_telegram_shop_purchase')) { ledger = { update_rid: 4201, outcome: values?.[7], delivery_status: values?.[8], order_rid: values?.[9] }; return { rows: [ledger], rowCount: 1 } }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = {
    connect: async () => client,
    query: async (sql: string) => {
      if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
      if (sql === 'SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token, bot_admin_username: '@support_admin' }], rowCount: 1 }
      if (sql.startsWith("UPDATE t_platform_telegram_shop_purchase p")) {
        if (ledger?.delivery_status === 'pending') { ledger.delivery_status = 'sending'; return { rows: [{ cdkey_no: 'CARD-75', cdkey_pwd: cipher }], rowCount: 1 } }
        return { rows: [], rowCount: 0 }
      }
      if (sql.startsWith("UPDATE t_platform_telegram_shop_purchase SET delivery_status='sent'")) { ledger.delivery_status = 'sent'; delivered++; return { rows: [], rowCount: 1 } }
      if (sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
  }
  try {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(input).split('/').pop()!
      const payload = JSON.parse(String(init?.body))
      requests.push({ method, payload })
      return Response.json({ ok: true, result: { message_id: 131 } })
    }
    assert.deepEqual(await syncTelegramSupportUpdates({ pool: pool as never, fetcher }), { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(await syncTelegramSupportUpdates({ pool: pool as never, fetcher }), { skipped: false, processed: 1, failed: 0 })
    assert.equal(balance, '0.750000')
    assert.equal(cardStatus, 2)
    assert.equal(orders, 1)
    assert.equal(ledger.outcome, 'purchased')
    assert.equal(ledger.delivery_status, 'sent')
    assert.equal(delivered, 1)
    const credentialMessages = requests.filter(row => row.method === 'sendMessage' && String(row.payload.text).includes('ONE-TIME-TEST-CREDENTIAL'))
    assert.equal(credentialMessages.length, 1)
    assert.equal(credentialMessages[0].payload.chat_id, '55')
    assert.equal(credentialMessages[0].payload.reply_markup.inline_keyboard[0][0].callback_data, 'aitrusteeshiprechargetrx')
  } finally { restoreEnv(env) }
})

test("private /start registers the user and sends its configured keyword reply", async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = "true"
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = "true"
  const update = { rid: 32, bot_rid: 7, update_body: { update_id: 918181, message: { message_id: 12, chat: { id: 55, type: "private" }, from: { id: 55, first_name: "Alice" }, text: "/start" } } }
  const requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (q: string) => q.startsWith("SELECT rid FROM t_telegram_bot_user") ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }, release() {} }
  const pool = { query: async (q: string) => {
    if (q.startsWith("WITH candidates")) return { rows: [update], rowCount: 1 }
    if (q.startsWith("SELECT bot_token,bot_username")) return { rows: [{ bot_token: token, bot_username: "demo_bot" }], rowCount: 1 }
    if (q.includes("FROM t_telegram_bot_keyreply kr JOIN")) return { rows: [{ rid: 1, bot_token: token, bot_username: "demo_bot", opt_type: 1, monitor_word: "/start", reply_content: "Welcome", reply_photo: null }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split("/").pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 13 } })
    } })
    assert.equal(result.processed, 1)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, "sendMessage")
    assert.equal(requests[0].payload.text, "Welcome")
    assert.equal(requests[0].payload.chat_id, "55")
  } finally { restoreEnv(env) }
})

test('premium wallet payment callbacks are preflight-claimable only through their private bot-user keyboard', async () => {
  const update = { callback_query: { id: 'premium-pay', data: 'tgpremiumwalletpay_72', from: { id: 55 }, message: { message_id: 81, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '余额支付', callback_data: 'tgpremiumwalletpay_72' }]] } } } }
  let statement = ''
  const pool = { query: async (sql: string) => { statement = sql; return { rows: [{ claimable: true }], rowCount: 1 } } } as never
  const result = await telegramSupportUpdateClaimable(pool, 7, update)
  assert.equal(result, true)
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}' ~ '^tgpremiumwalletpay_[1-9][0-9]{0,9}$'"))
  assert.ok(statement.includes("WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}'"))
})

test('premium wallet payment atomically debits only the buyer balance and moves the order to paid', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const callback = (rid: number, orderRid: number, chatId: number) => ({
    rid, bot_rid: 7,
    update_body: { callback_query: { id: `premium-${rid}`, data: `tgpremiumwalletpay_${orderRid}`, from: { id: chatId }, message: { message_id: 80 + rid, chat: { id: chatId, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '余额支付', callback_data: `tgpremiumwalletpay_${orderRid}` }]] } } } },
  })
  const updates = [callback(1920, 72, 55), callback(1921, 73, 56)]
  const statements: Array<{ sql: string; values?: unknown[] }> = [], transaction: Array<{ sql: string; values?: unknown[] }> = [], requests: Array<{ method: string; payload: any }> = []
  const client = { query: async (sql: string, values?: unknown[]) => {
    transaction.push({ sql, values })
    if (sql.startsWith('SELECT need_pay_usdt::text')) return { rows: [{ need_pay_usdt: values?.[0] === 72 ? '5.500000' : '2.000000', premium_tg_username: values?.[0] === 72 ? 'member<&>' : 'short', premium_package_month: values?.[0] === 72 ? 12 : 3 }], rowCount: 1 }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [{ rid: values?.[0] === 7 && values?.[1] === '55' ? 155 : 156 }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt=')) return values?.[2] === '5.500000' ? { rows: [{ cash_usdt: '4.500000' }], rowCount: 1 } : { rows: [], rowCount: 0 }
    if (sql.startsWith('UPDATE t_premium_platform_order SET status=1')) return { rows: [{ rid: values?.[0] }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: updates.splice(0), rowCount: 2 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, connect: async () => client }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      const method = String(input).split('/').pop()!
      requests.push({ method, payload: JSON.parse(String(init?.body)) })
      return method === 'answerCallbackQuery' ? Response.json({ ok: false }) : Response.json({ ok: true, result: { message_id: 99 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 2, failed: 0 })
    assert.deepEqual(requests, [
      { method: 'answerCallbackQuery', payload: { callback_query_id: 'premium-1920' } },
      { method: 'editMessageText', payload: { chat_id: '55', message_id: 2000, text: '会员订单支付成功，开通中···\n开通用户：member&lt;&amp;&gt;\n开通时间：12', parse_mode: 'HTML', allow_sending_without_reply: true } },
      { method: 'answerCallbackQuery', payload: { callback_query_id: 'premium-1921' } },
      { method: 'sendMessage', payload: { chat_id: '56', text: '用户USDT余额不足', reply_to_message_id: 2001, parse_mode: 'Markdown', allow_sending_without_reply: true } },
    ])
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt=cash_usdt-$3::numeric') && row.values?.join(',') === '155,7,5.500000'))
    assert.ok(transaction.some(row => row.sql.startsWith('UPDATE t_premium_platform_order SET status=1') && row.values?.join(',') === '72,7,55'))
    assert.equal(transaction.filter(row => row.sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt=')).length, 2)
    assert.equal(transaction.filter(row => row.sql.startsWith('UPDATE t_premium_platform_order SET status=1')).length, 1)
    assert.equal(transaction.filter(row => row.sql === 'COMMIT').length, 2)
    assert.ok(statements.filter(row => row.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")).length === 2)
  } finally { restoreEnv(env) }
})


test('legacy energy fee information callbacks are claimed only from the matching inline keyboard', async () => {
  const update = { callback_query: { id: 'energy-fee-info', data: '重新选择套餐energy', from: { id: 55 }, message: { message_id: 81, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '查看能量说明', callback_data: '重新选择套餐energy' }]] } } } }
  let statement = ''
  const result = await telegramSupportUpdateClaimable({ query: async (sql: string) => { statement = sql; return { rows: [{ claimable: true }], rowCount: 1 } } } as never, 7, update)
  assert.equal(result, true)
  assert.ok(statement.includes("u.update_body #>> '{callback_query,data}'='重新选择套餐energy'"))
  assert.ok(statement.includes("WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}'"))
})

test('legacy energy fee information callback displays the PHP alert and completes the inbox update', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 9301, bot_rid: 7, update_body: { callback_query: { id: 'energy-fee-info-9301', data: '重新选择套餐energy', from: { id: 55 }, message: { message_id: 81, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '查看能量说明', callback_data: '重新选择套餐energy' }]] } } } } }
  const statements: string[] = []
  const requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'energy-fee-info-9301',
        text: '波场手续费（⚠️务必仔细阅读⚠️）\n🔴对方有U，消耗约3.2万，燃烧13.44TRX\n🔴对方无U，消耗约6.5万，燃烧27.30TRX\n➖➖➖转账还需少量带宽➖➖➖\n🟢通过租赁能量，节省一大笔TRX\n🟢可选择租赁次数，租赁时长，能量24小时会恢复',
        show_alert: true,
      },
    }])
    assert.ok(statements.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})


test('trade-statistics commands are claimable but edited messages remain outside the legacy handler', async () => {
  const update = { message: { message_id: 81, chat: { id: -10055, type: 'supergroup' }, from: { id: 55 }, text: '统计' } }
  const editedUpdate = { edited_message: { message_id: 82, chat: { id: -10055, type: 'supergroup' }, from: { id: 55 }, text: '统计' } }
  const statements: string[] = []
  const pool = { query: async (sql: string) => { statements.push(sql); return { rows: [{ claimable: statements.length === 1 }], rowCount: 1 } } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, update), true)
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, editedUpdate), false)
  assert.ok(statements[0].includes("trim(COALESCE(u.update_body #>> '{message,text}','')) IN ('统计','能量统计','统计能量')"))
  assert.ok(statements[1].includes('NOT ('))
  assert.ok(statements[1].includes("u.update_body #>> '{edited_message,text}'"))
})

test('trade-statistics messages reply with the PHP command result and persist as processed', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 9302, bot_rid: 7, update_body: { message: { message_id: 82, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '统计' } } }
  const requests: Array<{ method: string; payload: any }> = [], statements: string[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT GROUPING(transferto_address)=1 AS is_total')) return { rows: [
      { is_total: false, transferto_address: 'TWallet123', today_count: '1', month_count: '1', total_count: '1', total: '4.5', today_total: '4.5', month_total: '4.5', back_total: '1.25', today_back_total: '1.25', month_back_total: '1.25', total_count_success: '1', today_count_success: '1', month_count_success: '1', total_success: '4.5', today_total_success: '4.5', month_total_success: '4.5', back_total_success: '1.25', today_back_total_success: '1.25', month_back_total_success: '1.25' },
      { is_total: true, transferto_address: null, today_count: '1', month_count: '1', total_count: '1', total: '4.5', today_total: '4.5', month_total: '4.5', back_total: '1.25', today_back_total: '1.25', month_back_total: '1.25', total_count_success: '1', today_count_success: '1', month_count_success: '1', total_success: '4.5', today_total_success: '4.5', month_total_success: '4.5', back_total_success: '1.25', today_back_total_success: '1.25', month_back_total_success: '1.25' },
    ], rowCount: 2 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 90 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[0].method, 'sendMessage')
    assert.equal(requests[0].payload.chat_id, '55')
    assert.equal(requests[0].payload.reply_to_message_id, 82)
    assert.match(requests[0].payload.text, /💹闪兑统计/u)
    assert.match(requests[0].payload.text, /钱包地址：<code>TWallet123<\/code>/u)
    assert.match(requests[0].payload.text, /总进USDT：4\.5 USDT/u)
    assert.equal(requests[0].payload.parse_mode, 'HTML')
    assert.ok(statements.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})
test('disabled sensitive commands are claimed and receive only the static denial response', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const secretText = '查私钥 0xVERY_SECRET_INPUT'
  const update = { rid: 9901, bot_rid: 7, update_body: { message: { message_id: 51, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: secretText } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const claimableSql = await telegramSupportUpdateClaimable({ query: async (sql: string) => { statements.push(sql); return { rows: [{ claimable: true }] } } } as never, 7, update.update_body)
    assert.equal(claimableSql, true)
    assert.ok(statements.some(sql => sql.includes("left(trim(COALESCE(u.update_body #>> '{message,text}'")))
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 52 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests[0].method, 'sendMessage')
    assert.equal(requests[0].payload.text, '该功能已停用，请勿通过机器人发送私钥或助记词。')
    assert.equal(JSON.stringify(requests).includes('VERY_SECRET_INPUT'), false)
    assert.ok(statements.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})

test('premium username replies are claimable only in an active private session and edited messages are excluded', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  try {
    const update = { message: { message_id: 91, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '@target_user' } }
  const edited = { edited_message: { message_id: 92, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '@target_user' } }
  const statements: string[] = []
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    return { rows: [{ claimable: statements.length === 2 }], rowCount: 1 }
  } }
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, update), true)
  const regularSql = statements.at(-1) ?? ''
  assert.ok(regularSql.includes("s.state='premium_purchase_username' AND s.expires_at>now()"))
  assert.ok(regularSql.includes("u.update_body ? 'message'"))
  assert.equal(await telegramSupportUpdateClaimable(pool as never, 7, edited), false)
  const editedSql = statements.at(-1) ?? ''
  assert.ok(editedSql.includes("u.update_body ? 'edited_message'"))
  assert.ok(editedSql.includes("'{edited_message,text}'"))
    assert.ok(editedSql.includes('AND NOT ('))
  } finally { restoreEnv(env) }
})

test('worker dispatches a selected premium package and marks its inbox update processed', async () => {
  const env = saveEnv()
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const callbackData = 'premium_' + 'a'.repeat(32)
  const update = { rid: 991, bot_rid: 7, update_body: { callback_query: {
    id: 'callback-1', data: callbackData, from: { id: 55, username: 'buyer' },
    message: { message_id: 30, chat: { id: 55, type: 'private' } },
  } } }
  const statements: string[] = [], requests: Array<{ method: string; payload: any }> = []
  const packageData = { rid: 71, premium_platform_rid: 4, package_name: 'Premium 12 months', package_month: 12, usdt_price: '10.00', show_notes: null, package_pic: null, receive_wallet: 'TReceiveWalletFixture', platform_hash: 'hash', platform_cookie: 'cookie' }
  const pool = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql === 'SELECT bot_token FROM t_telegram_bot WHERE rid=$1') return { rows: [{ bot_token: token }], rowCount: 1 }
    if (sql.startsWith('SELECT p.rid,p.premium_platform_rid')) return { rows: [packageData], rowCount: 1 }
    if (sql.startsWith('SELECT p.package_name,p.callback_data')) return { rows: [{ package_name: 'Premium 12 months', callback_data: callbackData }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    const result = await syncTelegramSupportUpdates({ pool: pool as never, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 31 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests.map(x => x.method), ['answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.reply_markup.inline_keyboard[1][0].callback_data, callbackData)
    assert.ok(statements.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally { restoreEnv(env) }
})
