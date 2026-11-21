import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyTelegramJoinUpdate, multiplyRate, sendVerifiedJoinNotification, syncTelegramJoinUpdates } from './telegram-join-updates.server'
import { estimateTelegramAccountAgeSeconds } from './telegram-account-age.server'

test('multiplies decimal exchange rates without floating point rounding', () => {
  assert.equal(multiplyRate('0.123456789', 1000n), '123.45')
  assert.equal(multiplyRate('12.345', 10n), '123.45')
  assert.equal(multiplyRate('-0.005', 10n), '-0.05')
  assert.equal(multiplyRate('not-a-rate', 10n), '')
})

test('classifies join requests and welcome messages while excluding bots and duplicate members', () => {
  assert.deepEqual(classifyTelegramJoinUpdate({ chat_join_request: { chat: { id: -1001 }, from: { id: 10, first_name: 'Alice' }, user_chat_id: 20 } }), [
    { chatId: '-1001', userId: '10', displayName: 'Alice', username: '', member: { id: 10, first_name: 'Alice', bio: undefined }, kind: 'join_request', userChatId: '20' },
  ])
  assert.equal(classifyTelegramJoinUpdate({ chat_join_request: { chat: { id: -1001 }, from: { id: 10, is_bot: true } } }).length, 0)
  assert.deepEqual(classifyTelegramJoinUpdate({ chat_member: { chat: { id: -1001 }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 11, first_name: 'Rejoin' } } } }), [
    { chatId: '-1001', userId: '11', displayName: 'Rejoin', username: '', member: { id: 11, first_name: 'Rejoin' }, kind: 'join_member', userChatId: null },
  ])
  assert.equal(classifyTelegramJoinUpdate({ chat_member: { chat: { id: -1001 }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 11 } }, via_join_request: true } }).length, 0)
  assert.deepEqual(classifyTelegramJoinUpdate({ message: { chat: { id: -1001 }, new_chat_member: { id: 10, first_name: 'A' }, new_chat_members: [{ id: 10, first_name: 'A' }, { id: 11, first_name: 'B' }, { id: 12, is_bot: true }] } }).map(event => event.userId), ['10', '11'])
})

test('does not claim queued join events while global dispatch or Telegram actions are disabled', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS, oldDispatch = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  let touched = false
  try {
    const result = await syncTelegramJoinUpdates({ pool: { query: async () => { touched = true; throw new Error('unexpected query') } } as never })
    assert.deepEqual(result, { skipped: true, processed: 0, failed: 0 })
    assert.equal(touched, false)
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    if (oldDispatch == null) delete process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY; else process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = oldDispatch
  }
})

test('marks unsupported chat_member transitions ignored instead of leaving them pending', async () => {
  const update = { rid: 77, bot_rid: 2, update_body: { chat_member: { chat: { id: -1009 }, old_chat_member: { status: 'member' }, new_chat_member: { status: 'left', user: { id: 8559682246 } } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith("UPDATE t_platform_telegram_update SET status='ignored'")) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async () => { throw new Error('ignored member transition must not call Telegram') } })
  assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
  assert.ok(statements[0]?.sql.includes("update_body ? 'chat_member'"))
  assert.deepEqual(statements.at(-1)?.values, [77, 'telegram-join-' + process.pid])
})

test('approves and sends the configured welcome response for an eligible join request', async () => {
  const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const update = { rid: 8, bot_rid: 2, update_body: { chat_join_request: { chat: { id: -1007 }, from: { id: 55, first_name: '博彩 <Bob>', username: 'alice' }, user_chat_id: 66 } } }
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_admin_username: '@admin', bot_username: '@bot', ad_score_threshold: 4, moderation_ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT join_captcha_enabled')) return { rows: [{ join_captcha_enabled: false, no_avatar_captcha_enabled: false, no_username_captcha_enabled: false, new_account_captcha_enabled: false, new_account_max_age_seconds: 86400, verification_timeout_seconds: 180, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,reply_photo')) return { rows: [{ rid: 2, reply_photo: '', reply_content: '欢迎来到群组' }], rowCount: 1 }
    if (sql.startsWith('SELECT b.keyboard_name')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  try {
    const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async (input, init) => {
      calls.push({ method: String(input).split('/').pop() || '', payload: JSON.parse(String(init?.body || '{}')) })
      return Response.json({ ok: true, result: true })
    } })
    assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(calls.map(call => call.method), ['approveChatJoinRequest', 'sendMessage'])
    assert.deepEqual(calls[0].payload, { chat_id: '-1007', user_id: '55' })
    assert.match(String(calls[1].payload.text), /欢迎 博彩 &lt;Bob&gt; 加入群组！/)
  } finally {
    if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS; else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
  }
})

test('sends the configured welcome reply and keyboard after a verified join', async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT rid,reply_photo')) return { rows: [{ rid: 7, reply_photo: '', reply_content: '欢迎 ${tgbotname}' }], rowCount: 1 }
    if (sql.startsWith('SELECT a.exchange_rate')) return { rows: [{ exchange_rate: '1.25', receive_wallet: 'T-wallet', show_notes: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT b.keyboard_name')) return { rows: [{ keyboard_name: '打开面板', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 1, keyboard_value: 'https://example.test' }], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  const sent = await sendVerifiedJoinNotification({
    pool,
    fetcher: async (input, init) => {
      const method = String(input).split('/').pop() || ''
      const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      calls.push({ method, payload })
      if (method === 'getChatMember') return Response.json({ ok: true, result: { user: { first_name: '林', last_name: '小明', username: 'lin_01' } } })
      return Response.json({ ok: true, result: true })
    },
    botRid: 3,
    token: '12345:Abcdefghijklmnopqrstuvwxyz_123',
    bot: { bot_admin_username: '@admin', bot_username: '@bot' },
    chatId: '-1003',
    userId: '55',
  })
  assert.equal(sent, true)
  assert.deepEqual(calls.map(call => call.method), ['getChatMember', 'sendMessage'])
  assert.equal(calls[1].payload.text, '欢迎 林 小明 加入群组！\n用户：@lin_01\n欢迎 @bot')
  assert.deepEqual(calls[1].payload.reply_markup, { inline_keyboard: [[{ text: '打开面板', url: 'https://example.test' }]] })
})

test('does not send a configured welcome when no active welcome reply exists', async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT rid,reply_photo')) return { rows: [], rowCount: 0 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  const methods: string[] = []
  const sent = await sendVerifiedJoinNotification({
    pool,
    fetcher: async input => { methods.push(String(input).split('/').pop() || ''); return Response.json({ ok: true, result: { user: { id: 55 } } }) },
    botRid: 3,
    token: '12345:Abcdefghijklmnopqrstuvwxyz_123',
    bot: { bot_admin_username: null, bot_username: null },
    chatId: '-1003',
    userId: '55',
  })
  assert.equal(sent, false)
  assert.deepEqual(methods, [])
})


test('creates a private verification prompt instead of approving a captcha-enabled join request', async () => {
  process.env.PLATFORM_ORIGIN = 'https://admin.example.test'
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const sqlCalls: Array<{ sql: string; values?: unknown[] }> = []
  const update = { rid: 9, bot_rid: 2, update_body: { chat_join_request: { chat: { id: -1008 }, from: { id: 55, first_name: 'Alice' }, user_chat_id: 66 } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      sqlCalls.push({ sql, values })
      if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
      if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_admin_username: null, bot_username: 'bot', ad_score_threshold: 4, moderation_ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT join_captcha_enabled')) return { rows: [{ join_captcha_enabled: true, no_avatar_captcha_enabled: false, no_username_captcha_enabled: false, new_account_captcha_enabled: false, new_account_max_age_seconds: 86400, verification_timeout_seconds: 180, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_verification') || sql.startsWith('INSERT INTO t_telegram_moderation_log')) return { rows: [], rowCount: 1 }
      if (sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
      throw new Error('unexpected query: ' + sql)
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => { sqlCalls.push({ sql, values }); return { rows: [], rowCount: 1 } }, release() {} }),
  } as never
  const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async (input, init) => {
    calls.push({ method: String(input).split('/').pop() || '', payload: JSON.parse(String(init?.body || '{}')) })
    return Response.json({ ok: true, result: { message_id: 88 } })
  } })
  assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
  assert.deepEqual(calls.map(call => call.method), ['sendMessage'])
  assert.equal(calls[0].payload.chat_id, '66')
  assert.equal((calls[0].payload.reply_markup as { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> }).inline_keyboard[0][0].web_app?.url.includes('/api/moderation?verify='), true)
  const insert = sqlCalls.find(call => call.sql.startsWith('INSERT INTO t_telegram_verification'))
  assert.ok(insert)
  assert.equal(insert.values?.[4], '66')
})

test('restricts a new member before sending the group verification prompt', async () => {
  process.env.PLATFORM_ORIGIN = 'https://admin.example.test'
  const calls: string[] = []
  let claimSql = ''
  const update = { rid: 10, bot_rid: 2, update_body: { chat_member: { chat: { id: -1009 }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 8559682246, first_name: 'Bob' } } } } }
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('WITH candidates')) { claimSql = sql; return { rows: [update], rowCount: 1 } }
      if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_admin_username: null, bot_username: 'bot', ad_score_threshold: 4, moderation_ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT join_captcha_enabled')) return { rows: [{ join_captcha_enabled: true, no_avatar_captcha_enabled: true, no_username_captcha_enabled: true, new_account_captcha_enabled: true, new_account_max_age_seconds: 31536000, verification_timeout_seconds: 180, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_verification') || sql.startsWith('INSERT INTO t_telegram_moderation_log') || sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
      throw new Error('unexpected query: ' + sql)
    },
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 1 }), release() {} }),
  } as never
  const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async (input) => {
    const method = String(input).split('/').pop() || ''
    calls.push(method)
    return Response.json({ ok: true, result: { message_id: 89, total_count: 0 } })
  } })
  assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
  assert.ok(claimSql.includes("update_body ? 'chat_member'"))
  assert.deepEqual(calls, ['getUserProfilePhotos', 'restrictChatMember', 'sendMessage'])
  assert.match(String(calls[2]), /sendMessage/)
})


test('estimates Telegram account age by interpolation between the PHP backend UID anchors', () => {
  assert.equal(estimateTelegramAccountAgeSeconds(0, 1_800_000_000), null)
  assert.equal(estimateTelegramAccountAgeSeconds(2_768_409, 1_800_000_000), 1_800_000_000 - Math.floor(Date.parse('2013-11-01T00:00:00Z') / 1000))
  assert.ok((estimateTelegramAccountAgeSeconds(8_000_000_000, 1_800_000_000) ?? 0) < (estimateTelegramAccountAgeSeconds(7_000_000_000, 1_800_000_000) ?? 0))
  assert.equal(estimateTelegramAccountAgeSeconds(8_000_000_000, 1_000_000_000), 0)
})

test('screens new members without usernames even when full join captcha is disabled', async () => {
  process.env.PLATFORM_ORIGIN = 'https://admin.example.test'
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const update = { rid: 11, bot_rid: 2, update_body: { message: { chat: { id: -1010 }, new_chat_member: { id: 88, first_name: 'New' } } } }
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
      if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_admin_username: null, bot_username: 'bot', ad_score_threshold: 4, moderation_ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('SELECT join_captcha_enabled')) return { rows: [{ join_captcha_enabled: false, no_avatar_captcha_enabled: false, no_username_captcha_enabled: true, new_account_captcha_enabled: false, new_account_max_age_seconds: 86400, verification_timeout_seconds: 180, ad_keywords: '' }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_verification') || sql.startsWith('INSERT INTO t_telegram_moderation_log') || sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
      throw new Error('unexpected query: ' + sql)
    },
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 1 }), release() {} }),
  } as never
  const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async (input, init) => {
    calls.push({ method: String(input).split('/').pop() || '', payload: JSON.parse(String(init?.body || '{}')) })
    return Response.json({ ok: true, result: { message_id: 90 } })
  } })
  assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
  assert.deepEqual(calls.map(call => call.method), ['restrictChatMember', 'sendMessage'])
  assert.match(String(calls[1].payload.text), /用户无 Telegram 用户名/)
})

test('declines a join request whose profile matches high-risk ad terms', async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  const update = { rid: 12, bot_rid: 2, update_body: { chat_join_request: { chat: { id: -1011 }, from: { id: 89, first_name: '博彩' }, user_chat_id: 90 } } }
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('WITH candidates')) return { rows: [update], rowCount: 1 }
    if (sql.startsWith('SELECT b.bot_token')) return { rows: [{ bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_admin_username: null, bot_username: 'bot', ad_score_threshold: 4, moderation_ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('SELECT join_captcha_enabled')) return { rows: [{ join_captcha_enabled: true, no_avatar_captcha_enabled: false, no_username_captcha_enabled: false, new_account_captcha_enabled: false, new_account_max_age_seconds: 86400, verification_timeout_seconds: 180, ad_keywords: '' }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_moderation_log') || sql.startsWith('UPDATE t_platform_telegram_update')) return { rows: [], rowCount: 1 }
    throw new Error('unexpected query: ' + sql)
  } } as never
  const result = await syncTelegramJoinUpdates({ pool, enabled: true, fetcher: async (input, init) => {
    calls.push({ method: String(input).split('/').pop() || '', payload: JSON.parse(String(init?.body || '{}')) })
    return Response.json({ ok: true, result: true })
  } })
  assert.deepEqual(result, { skipped: false, processed: 1, failed: 0 })
  assert.deepEqual(calls.map(call => call.method), ['declineChatJoinRequest'])
})
