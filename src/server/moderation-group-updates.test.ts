import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupMessage, processGroupManagementPluginUpdate, syncTelegramGroupMessages } from './moderation-group-updates.server'

test('accepts group and supergroup messages and ignores private or malformed updates', () => {
  assert.equal(groupMessage({ message: { chat: { id: -1007, type: 'supergroup' }, message_id: 12 } })?.chat.id, -1007)
  assert.equal(groupMessage({ edited_message: { chat: { id: -1008, type: 'group' }, message_id: 13 } })?.message_id, 13)
  assert.equal(groupMessage({ message: { chat: { id: 123, type: 'private' }, message_id: 14 } }), null)
  assert.equal(groupMessage({ message: { chat: { id: 'bad', type: 'group' }, message_id: 14 } }), null)
})

test('disabled update consumer does not touch the database or Telegram', async () => {
  const pool = { query: async () => { throw new Error('unexpected database access') } } as never
  const result = await syncTelegramGroupMessages({ pool, enabled: false, fetcher: async () => { throw new Error('unexpected Telegram request') } })
  assert.deepEqual(result, { skipped: true, processed: 0, failed: 0 })
})

test('stores group history when dispatch is ready while Telegram moderation actions are disabled', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const calls: string[] = []
  const update = { rid: 4, bot_rid: 7, update_body: { update_id: 91, message: { chat: { id: -1007, type: 'supergroup' }, message_id: 12, date: 1793220000, text: 'hello', from: { id: 55 } } } }
  const pool = {
    query: async (sql: string) => {
      calls.push(sql)
      if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: 'fixture', bot_username: '@bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT bot_rid,tg_groupid')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
      throw new Error('unexpected query: ' + sql)
    },
  } as never
  try {
    await processGroupManagementPluginUpdate({ pool, botRid: 7, update: update.update_body, fetcher: async () => { throw new Error('unexpected Telegram request') } })
    assert.ok(calls.some(sql => sql.startsWith('INSERT INTO t_telegram_group_message_history')))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group title changes update the existing group record and restore its active state', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const update = { rid: 41, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup', username: 'updated_group' }, message_id: 21, new_chat_title: 'Renamed Group', from: { id: 55, is_bot: false } } } }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_group')) return { rows: [{ rid: 9 }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_bot_group SET')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    await processGroupManagementPluginUpdate({ pool, botRid: 7, update: update.update_body, fetcher: async () => { throw new Error('unexpected Telegram request') } })
    const renamed = calls.find(call => call.sql.startsWith('UPDATE t_telegram_bot_group SET'))
    assert.ok(renamed)
    assert.deepEqual(renamed.values, [9, 'updated_group', 'Renamed Group'])
    assert.match(renamed.sql, /status=1/)
    assert.match(renamed.sql, /stop_time=NULL/)
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group title changes create a missing legacy group record and ignore bot-authored title changes', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const updates = [
    { rid: 51, bot_rid: 7, update_body: { message: { chat: { id: -1008, type: 'group' }, message_id: 31, new_chat_title: 'New Group', from: { id: 55, is_bot: false } } } },
    { rid: 52, bot_rid: 7, update_body: { message: { chat: { id: -1009, type: 'group' }, message_id: 32, new_chat_title: 'Bot Group', from: { id: 56, is_bot: true } } } },
  ]
  const pool = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: updates.splice(0), rowCount: 2 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_group')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('INSERT INTO t_telegram_bot_group')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    await Promise.all(updates.map(update => processGroupManagementPluginUpdate({ pool, botRid: 7, update: update.update_body, fetcher: async () => { throw new Error('unexpected Telegram request') } })))
    const created = calls.find(call => call.sql.startsWith('INSERT INTO t_telegram_bot_group'))
    assert.ok(created)
    assert.deepEqual(created.values, [7, 'group', '-1008', '', 'New Group'])
    assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO t_telegram_bot_group')).length, 1)
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})


test('admin /jgjc reply adds the message as a group keyword and triggers the legacy 30-minute rescan', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const queries: Array<{ sql: string; values?: unknown[] }> = []
  const telegramCalls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const command = { chat: { id: -1007, type: 'supergroup' }, message_id: 13, date: 1793220300, text: '/jgjc', from: { id: 55 }, reply_to_message: { chat: { id: -1007, type: 'supergroup' }, message_id: 12, date: 1793220000, text: '博彩 giveaway', from: { id: 66 } } }
  const update = { rid: 5, bot_rid: 7, update_body: { message: command } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values })
      if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT bot_token,bot_username')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@bot' }], rowCount: 1 }
      if (sql.startsWith('SELECT group_moderation_enabled')) return { rows: [{ group_moderation_enabled: true, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT bot_rid,tg_groupid')) return { rows: [{ bot_rid: 7, tg_groupid: '-1007', group_moderation_enabled: true, block_forwarded_messages: false, ad_keywords: '', ad_action: 'delete', ad_restrict_duration_seconds: 60 }], rowCount: 1 }
      if (sql.startsWith('SELECT rid,message_id::text')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
      throw new Error('unexpected query: ' + sql)
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values })
      if (sql.startsWith('SELECT ad_keywords')) return { rows: [{ ad_keywords: '' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as never
  try {
    await processGroupManagementPluginUpdate({ pool, botRid: 7, update: update.update_body, fetcher: async (input, init) => {
      const method = String(input).split('/').pop() || ''
      const payload = JSON.parse(String(init?.body || '{}'))
      telegramCalls.push({ method, payload })
      return method === 'getChatMember' ? Response.json({ ok: true, result: { status: 'administrator' } }) : Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(telegramCalls.map(call => call.method), ['getChatMember', 'deleteMessage'])
    assert.ok(queries.some(query => query.sql.startsWith('UPDATE t_telegram_bot_group_policy') && String(query.values?.[2]).includes('博彩 giveaway')))
    assert.ok(queries.some(query => query.sql.includes("event_type='keyword_capture'")))
    assert.ok(queries.some(query => query.sql.startsWith('SELECT rid,message_id::text') && query.values?.[2] === 30))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group arithmetic messages receive a native Telegram calculator reply when actions are enabled', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 84, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 85, text: '(2 + 3) * 4', from: { id: 55 } } } }
  const queries: string[] = []
  const telegramCalls: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token,b.bot_username')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_rid,tg_groupid')) return { rows: [{ bot_rid: 7, tg_groupid: '-1007', group_moderation_enabled: false, block_forwarded_messages: false, ad_keywords: '', ad_action: 'delete', ad_restrict_duration_seconds: 60 }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123' }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      telegramCalls.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 86 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(telegramCalls, [{ method: 'sendMessage', payload: { chat_id: '-1007', text: '(2 + 3) * 4 = 20', reply_to_message_id: 85, allow_sending_without_reply: true, parse_mode: 'HTML' } }])
    assert.ok(queries.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group updates send configured opt_type 1 keyword replies through native dispatch', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 92, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 30, text: '帮助', from: { id: 55 } } } }
  const queries: string[] = [], requests: Array<{ method: string; payload: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token,b.bot_username,c.ad_score_threshold')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_rid,tg_groupid::text')) return { rows: [{ bot_rid: 7, tg_groupid: '-1007', group_moderation_enabled: false }], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 1, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: null, monitor_word: '帮助', reply_photo: null, reply_content: '请查看 <strong>帮助中心</strong>' }], rowCount: 1 }
    if (sql.startsWith('SELECT k.keyboard_name')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 31 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{ method: 'sendMessage', payload: { chat_id: '-1007', reply_to_message_id: 30, allow_sending_without_reply: true, parse_mode: 'HTML', text: '请查看 <b>帮助中心</b>' } }])
    assert.ok(queries.some(sql => sql.startsWith('SELECT kr.rid')))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group updates show active energy-package buttons for native opt_type 3 replies', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 93, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 32, text: '购买能量', from: { id: 55 } } } }
  const requests: Array<{ method: string; payload: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token,b.bot_username,c.ad_score_threshold')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_rid,tg_groupid::text')) return { rows: [{ bot_rid: 7, tg_groupid: '-1007', group_moderation_enabled: false }], rowCount: 1 }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 2, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: null, opt_type: 3, monitor_word: '购买能量', reply_photo: null, reply_content: '选择套餐' }] }
    if (sql.startsWith('SELECT a.package_name')) return { rows: [{ keyboard_name: '65,000 能量', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'energy_package_1', seq_sn: 1 }] }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 33 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{ method: 'sendMessage', payload: {
      chat_id: '-1007', reply_to_message_id: 32, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '65,000 能量', callback_data: 'energy_package_1' }]] }, text: '选择套餐',
    } }])
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('group USDT/U messages receive the legacy exchange-rate reply before moderation handlers', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const update = { rid: 94, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 95, text: '3u', from: { id: 55 } } } }
  const queries: string[] = [], requests: Array<{ method: string; payload: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT a.exchange_rate::text')) return { rows: [{ exchange_rate: '2.50', receive_wallet: 'TReceive' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123' }], rowCount: 1 }
    if (sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 96 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(requests, [{ method: 'sendMessage', payload: {
      chat_id: '-1007', text: '💹实时汇率: <b>3 USDT = 7.5 TRX</b>\n\n官方USDT-TRC20自动兑换地址（点击地址复制）\n<code>TReceive</code>',
      reply_to_message_id: 95, parse_mode: 'HTML', allow_sending_without_reply: true,
    } }])
    assert.ok(queries.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
    assert.ok(!queries.some(sql => sql.startsWith('SELECT b.bot_token,b.bot_username')))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})


test('group 查授权 commands use the native read-only TronScan lookup and reply to the source message', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const update = { rid: 95, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 97, text: '查授权 ' + address, from: { id: 55 } } } }
  const queries: Array<{ sql: string; values?: unknown[] }> = []
  const requests: Array<{ url: URL; payload?: Record<string, unknown> }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM t_telegram_bot')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123' }], rowCount: 1 }
    if (sql.startsWith("SELECT config_val FROM t_sys_config")) return { rows: [{ config_val: '{}' }], rowCount: 1 }
    if (sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      const url = new URL(String(input))
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      requests.push({ url, payload })
      return url.hostname === 'apilist.tronscanapi.com'
        ? Response.json({ total: 0, data: [] })
        : Response.json({ ok: true, result: { message_id: 98 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url.pathname, '/api/account/approve/list')
    assert.equal(requests[0].url.searchParams.get('address'), address)
    assert.equal(requests[1].url.pathname, '/bot12345:Abcdefghijklmnopqrstuvwxyz_123/sendMessage')
    assert.match(String(requests[1].payload?.text), /查询结果：恭喜，地址没有授权/u)
    assert.deepEqual(requests[1].payload, {
      chat_id: '-1007',
      text: requests[1].payload?.text,
      parse_mode: 'HTML',
      allow_sending_without_reply: true,
      reply_to_message_id: 97,
      reply_markup: { inline_keyboard: [[{ text: '波场链上查询', url: 'https://tronscan.org/#/address/' + address }]] },
    })
    assert.ok(queries.some(query => query.sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
    assert.ok(!queries.some(query => query.sql.startsWith('SELECT bot_rid,tg_groupid')))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})


test('group raw TRON addresses use the native balance lookup after group moderation and reply with legacy buttons', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  const address = 'TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F'
  const botToken = '12345:Abcdefghijklmnopqrstuvwxyz_123'
  const update = { rid: 96, bot_rid: 7, update_body: { message: { chat: { id: -1007, type: 'supergroup' }, message_id: 99, text: address, from: { id: 55 } } } }
  const queries: string[] = []
  const requests: Array<{ url: URL; payload?: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_group_message_history')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token,b.bot_username,c.ad_score_threshold')) return { rows: [{ bot_token: botToken, bot_username: '@sample_bot', ad_score_threshold: 4, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_rid,tg_groupid::text')) return { rows: [{ bot_rid: 7, tg_groupid: '-1007', group_moderation_enabled: false, block_forwarded_messages: false, ad_keywords: '', ad_keywords_auto_upload: false, ad_keywords_auto_sync: false, ad_action: 'delete', ad_restrict_duration_seconds: 60, ad_verification_timeout_seconds: 1800 }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token,bot_username FROM t_telegram_bot')) return { rows: [{ bot_token: botToken, bot_username: '@sample_bot' }], rowCount: 1 }
    if (sql.startsWith('SELECT config_val FROM t_sys_config')) return { rows: [{ config_val: '{}' }], rowCount: 1 }
    if (sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  } } as never
  try {
    const result = await syncTelegramGroupMessages({ pool, enabled: true, fetcher: async (input, init) => {
      const url = new URL(String(input))
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      requests.push({ url, payload })
      return url.hostname === 'apilist.tronscanapi.com'
        ? Response.json({ balance: '123456789', activated: true, withPriceTokens: [{ tokenId: '_', amount: '123.456789' }, { tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', balance: '9876543', tokenDecimal: 6 }], transactions: 8, transactions_in: 4, transactions_out: 4, totalTransactionCount: 9, bandwidth: { freeNetRemaining: 1, netRemaining: 2, freeNetLimit: 3, netLimit: 4, energyRemaining: 5, energyLimit: 6 }, date_created: 0, latest_operation_time: 0, ownerPermission: { threshold: 1, keys: [{ address, weight: 1 }] }, activePermissions: [] })
        : Response.json({ ok: true, result: { message_id: 100 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url.pathname, '/api/accountv2')
    assert.equal(requests[0].url.searchParams.get('address'), address)
    assert.equal(requests[1].url.pathname, '/bot' + botToken + '/sendMessage')
    assert.equal(requests[1].payload?.chat_id, '-1007')
    assert.equal(requests[1].payload?.reply_to_message_id, 99)
    assert.equal(requests[1].payload?.parse_mode, 'HTML')
    assert.match(String(requests[1].payload?.text), /TRX余额：<code>123\.456789<\/code>/u)
    assert.match(String(requests[1].payload?.text), /USDT余额：<code>9\.876543<\/code>/u)
    assert.deepEqual(requests[1].payload?.reply_markup, { inline_keyboard: [
      [{ text: '链上查询', url: 'https://tronscan.org/#/address/' + address }, { text: '查授权', callback_data: '查授权' + address }, { text: '关于机器人', url: 'https://t.me/sample_bot' }],
      [{ text: '兑换TRX', callback_data: '兑换' }, { text: 'USDT记录', callback_data: 'searchusdtlistall' + address }, { text: 'TRX记录', callback_data: 'searchtrxalistall' + address }],
    ] })
    assert.ok(queries.indexOf('SELECT bot_rid,tg_groupid::text AS tg_groupid,group_moderation_enabled,block_forwarded_messages,ad_keywords,ad_keywords_auto_upload,ad_keywords_auto_sync,ad_action,ad_restrict_duration_seconds,ad_verification_timeout_seconds FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2') < queries.indexOf('SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid DESC LIMIT 1'))
    assert.ok(queries.some(sql => sql.startsWith("UPDATE t_platform_telegram_update SET status='processed'")))
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})
