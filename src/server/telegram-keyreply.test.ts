import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleTelegramKeywordReply, normalizeTelegramKeyword, telegramKeyreplyClaimable, telegramKeyreplyClaimPredicate, telegramKeywordReplyMatches, telegramReplyIdContent, telegramReplyIdKeyboard, telegramReplyKeyboard } from './telegram-keyreply.server'

test('keyword reply matching follows the configured keyword list and emoji fallback', () => {
  assert.equal(telegramKeywordReplyMatches('帮助,联系客服', '帮助'), true)
  assert.equal(telegramKeywordReplyMatches('智能托管', '❇️智能托管@sample_bot', 'sample_bot'), true)
  assert.equal(telegramKeywordReplyMatches('hello', "he'llo"), true)
  assert.equal(telegramKeywordReplyMatches('help', 'Help'), false)
  assert.equal(telegramKeywordReplyMatches('查询', '查询一下'), false)
  assert.equal(telegramKeywordReplyMatches('hello,world', 'other'), false)
  assert.equal(normalizeTelegramKeyword('🚀\u200b智能托管'), '智能托管')
})

test('reply keyboard rows use three buttons and preserve optional custom emoji', () => {
  const keyboard = telegramReplyKeyboard([
    { keyboard_name: 'A', keyboard_icon_custom_emoji_id: 'emoji-id="12345"', keyboard_type: 1, inline_type: 0, keyboard_value: '', seq_sn: 4 },
    { keyboard_name: 'B', keyboard_icon_custom_emoji_id: null, keyboard_type: 1, inline_type: 0, keyboard_value: '', seq_sn: 3 },
    { keyboard_name: 'C', keyboard_icon_custom_emoji_id: null, keyboard_type: 1, inline_type: 0, keyboard_value: '', seq_sn: 2 },
    { keyboard_name: 'D', keyboard_icon_custom_emoji_id: null, keyboard_type: 1, inline_type: 0, keyboard_value: '', seq_sn: 1 },
  ])
  assert.deepEqual(keyboard, {
    keyboard: [[{ text: 'A', icon_custom_emoji_id: '12345' }, { text: 'B' }, { text: 'C' }], [{ text: 'D' }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    selective: true,
  })
})

test('inline keyboard rows use two buttons and choose URL or callback action', () => {
  const keyboard = telegramReplyKeyboard([
    { keyboard_name: 'Open', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 1, keyboard_value: 'https://example.test', seq_sn: 2 },
    { keyboard_name: 'Help', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'help', seq_sn: 1 },
    { keyboard_name: 'More', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'more', seq_sn: 0 },
  ])
  assert.deepEqual(keyboard, { inline_keyboard: [[{ text: 'Open', url: 'https://example.test' }, { text: 'Help', callback_data: 'help' }], [{ text: 'More', callback_data: 'more' }]] })
})

test('empty keyboard configurations do not add Telegram reply markup', () => {
  assert.equal(telegramReplyKeyboard([]), undefined)
  assert.equal(telegramReplyKeyboard([{ keyboard_name: '', keyboard_type: 1 }]), undefined)
})

test('ID replies include private user details, request-user/chat buttons, and escape HTML fields', () => {
  const message = { message_id: 20, chat: { id: 88, type: 'private' }, from: { id: 88, username: '<alice>', first_name: 'A&B', last_name: '<Admin>' } }
  assert.equal(telegramReplyIdContent(message), '<b>用户ID：</b><code>88</code>\n用户名：@&lt;alice&gt;\n用户昵称：<code>A&amp;B&lt;Admin&gt;</code>\n\n')
  assert.deepEqual(telegramReplyIdKeyboard(message), {
    keyboard: [
      [{ text: '查用户ID', request_users: { request_id: 1, user_is_bot: false } }, { text: '查群组ID', request_chat: { request_id: 2, chat_is_channel: false } }],
      [{ text: '查机器人ID', request_users: { request_id: 3, user_is_bot: true } }, { text: '查频道ID', request_chat: { request_id: 4, chat_is_channel: true } }],
      ['/start'],
    ], resize_keyboard: true, one_time_keyboard: false, selective: true,
  })
})

test('ID replies include group context and omit the private-only keyboard', () => {
  const message = { message_id: 20, chat: { id: -1007, type: 'supergroup', username: 'group_name', title: '<Group>' }, from: { id: 88, first_name: 'Alice' } }
  assert.equal(telegramReplyIdContent(message), '<b>用户ID：</b><code>88</code>\n用户名：@\n用户昵称：<code>Alice</code>\n\n<b>群组ID：</b><code>-1007</code>\n群组名：@group_name\n群组昵称：<code>&lt;Group&gt;</code>\n群组类型：<code>supergroup</code>\n')
  assert.equal(telegramReplyIdKeyboard(message), undefined)
})

test('native claim and send preserve configured static replies, safe placeholders, and related keyboards', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  assert.match(telegramKeyreplyClaimPredicate, /t_telegram_bot_keyreply/u)
  const queries: string[] = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.includes('AS claimable')) return { rows: [{ claimable: true }] }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 4, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: 'admin', opt_type: 1, monitor_word: 'help', reply_photo: null, reply_content: '<strong>${tgbotname}</strong>\\n${trxusdtwallet}' }] }
    if (sql.startsWith('SELECT c.exchange_rate')) return { rows: [{ exchange_rate: '2.50', receive_wallet: '<T-wallet>', show_notes: null }] }
    if (sql.startsWith('SELECT k.keyboard_name')) return { rows: [{ keyboard_name: 'Open', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 1, keyboard_value: 'https://example.test', seq_sn: 10 }] }
    throw new Error('unexpected query: ' + sql)
  } }
  assert.equal(await telegramKeyreplyClaimable(pool as never, 7, { message: { chat: { type: 'private' }, text: 'help' } }), true)
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = []
  const handled = await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      requests.push({ url: String(input), payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 19, text: 'help' },
  })
  assert.equal(handled, true)
  assert.deepEqual(requests, [{
    url: 'https://api.telegram.org/bot12345:Abcdefghijklmnopqrstuvwxyz_123/sendMessage',
    payload: { chat_id: '88', reply_to_message_id: 19, allow_sending_without_reply: true, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://example.test' }]] }, text: '<b>@bot</b>\n&lt;T-wallet&gt;' },
  }])
  assert.equal(queries.some((sql) => sql.includes('t_telegram_bot_keyreply_keyboard')), true)
})

test('native opt_type 2 replies include user and group ID details without a photo or API secret', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 5, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: null, opt_type: 2, monitor_word: 'id', reply_photo: 'ignored-photo', reply_content: '' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  const handled = await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { message_id: 26, chat: { id: -1007, type: 'supergroup', username: 'group', title: 'Chat' }, from: { id: 55, username: 'alice', first_name: 'Alice', last_name: 'User' }, text: 'id' },
  })
  assert.equal(handled, true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: { chat_id: '-1007', reply_to_message_id: 26, allow_sending_without_reply: true, parse_mode: 'HTML', text: '<b>用户ID：</b><code>55</code>\n用户名：@alice\n用户昵称：<code>AliceUser</code>\n\n<b>群组ID：</b><code>-1007</code>\n群组名：@group\n群组昵称：<code>Chat</code>\n群组类型：<code>supergroup</code>\n' },
  })
})

test('native opt_type 3 replies show active energy packages as inline buttons', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const queries: string[] = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.includes('AS claimable')) return { rows: [{ claimable: true }] }
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 6, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: null, opt_type: 3, monitor_word: 'energy', reply_photo: null, reply_content: '请选择能量套餐' }] }
    if (sql.startsWith('SELECT a.package_name')) return { rows: [
      { keyboard_name: '65,000 能量', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'energy_package_1', seq_sn: 2 },
      { keyboard_name: '100,000 能量', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'energy_package_2', seq_sn: 1 },
    ] }
    throw new Error('unexpected query: ' + sql)
  } }
  assert.match(telegramKeyreplyClaimPredicate, /opt_type IN \(1,2,3,4,5,6,7,8,9,10,11\)/u)
  assert.equal(await telegramKeyreplyClaimable(pool as never, 7, { message: { chat: { type: 'private' }, text: 'energy' } }), true)

  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 30, text: 'energy' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '-1007', reply_to_message_id: 30, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '65,000 能量', callback_data: 'energy_package_1' }, { text: '100,000 能量', callback_data: 'energy_package_2' }]] },
      text: '请选择能量套餐',
    },
  })
  assert.equal(queries.some((sql) => sql.includes('t_energy_platform_package')), true)
})

test('native opt_type 4 replies show active premium packages as inline buttons', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const queries: string[] = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 7, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'bot', bot_admin_username: null, opt_type: 4, monitor_word: '/buypremium', reply_photo: null, reply_content: '选择会员套餐' }] }
    if (sql.startsWith('SELECT a.package_name')) return { rows: [
      { keyboard_name: '月度会员', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'premium_month', seq_sn: 2 },
      { keyboard_name: '年度会员', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'premium_year', seq_sn: 1 },
    ] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 31, text: '/buypremium' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', reply_to_message_id: 31, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '月度会员', callback_data: 'premium_month' }, { text: '年度会员', callback_data: 'premium_year' }]] },
      text: '选择会员套餐',
    },
  })
  assert.ok(queries.some((sql) => sql.includes('t_premium_platform_package') && sql.includes('b.status=0')))
})

test('native opt_type 5 shows private account balances and existing top-up callbacks', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 8, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 5, monitor_word: '余额', reply_photo: null, reply_content: '账户状态' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [{ cash_trx: '12.300000', cash_usdt: '4.25' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 32, text: '余额' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [
          { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
          { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
          { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
        ],
        [
          { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
          { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
        ],
        [{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }],
      ] },
      text: '账户状态\n\n<b>TRX余额为：</b><code>12.300000 TRX</code>\n<b>USDT余额为：</b><code>4.25 USDT</code>\n\n⚠️TRX余额不足时，不再执行智能托管，请及时充值\n⚠️充值的USDT可点击下方转换为TRX\n\n<b>请保证余额充足,点击下方可充值余额！</b>',
    },
  })
})

test('native opt_type 11 shows private balances, configured prices, and trusteeship actions', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 25, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 11, monitor_word: '智能托管', reply_photo: null, reply_content: '' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [{ cash_trx: '12.300000', cash_usdt: '4.25' }] }
    if (sql.startsWith('SELECT trx_price_energy_32000')) return { rows: [{ trx_price_energy_32000: '5.2', trx_price_energy_65000: '9.7' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => { sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }; return Response.json({ ok: true }) },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 35, text: '智能托管' },
  }), true)
  assert.equal(sent?.method, 'sendMessage')
  assert.deepEqual(sent?.payload.reply_markup, { inline_keyboard: [
    [
      { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
      { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
      { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
    ],
    [
      { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
      { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
    ],
    [{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }],
  ] })
  assert.equal(sent?.payload.reply_to_message_id, undefined)
  assert.match(String(sent?.payload.text), /12\.300000 TRX/u)
  assert.match(String(sent?.payload.text), /4\.25 USDT/u)
  assert.match(String(sent?.payload.text), /65000能量 <u>5\.2 TRX<\/u>，131000能量 <u>9\.7 TRX<\/u>/u)
})

test('native opt_type 11 keeps group replies informational with validated private-chat links', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 26, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 11, monitor_word: '智能托管', reply_photo: null, reply_content: '' }] }
    throw new Error('group reply must not read private account rows: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => { sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }; return Response.json({ ok: true }) },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 36, text: '智能托管' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '-1007', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '👨联系客服', url: 'https://t.me/support_bot' },
        { text: '🤖私聊机器人', url: 'https://t.me/sample_bot' },
      ]] },
      text: '<b>能量智能托管说明</b>\n1️⃣在机器人充值TRX,每笔能量消耗该TRX余额\n2️⃣添加托管您的波场地址,地址一定要激活(转入TRX即可激活)\n3️⃣默认自动代理65000能量,可以给有USDT的地址免费转账一笔\n4️⃣可在我的托管地址中修改每笔代理能量数量和备注说明\n5️⃣每笔能量代理时间为一天,到期回收\n🔥点击下方私聊机器人赶紧使用吧！🔥',
    },
  })
})

test('native opt_type 5 asks group users to open a private bot chat', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 9, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 5, monitor_word: '余额', reply_photo: 'ignored-photo', reply_content: 'ignored group content' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 33, text: '余额' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '-1007', reply_to_message_id: 33, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🤖私聊机器人', url: 'https://t.me/sample_bot' }, { text: '👨联系客服', url: 'https://t.me/support_bot' }]] },
      text: '<b>该功能命令只能私聊机器人执行！点击下方私聊机器人</b> ！',
    },
  })
})

test('native opt_type 6 lists monitored addresses, exact remaining quota, and pager actions', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 10, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 6, monitor_word: '监控', reply_photo: null, reply_content: '监控地址列表' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [{ cash_trx: '8.125000', cash_usdt: '12.500000', max_monitor_wallet: 3 }] }
    if (sql.startsWith('SELECT COALESCE(free_monitor_wallet')) return { rows: [{ free_limit: 4 }] }
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: 11 }] }
    if (sql.startsWith('SELECT monitor_wallet')) return { rows: [{ monitor_wallet: 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 34, text: '监控' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [
          { text: '➕添加监控地址', callback_data: 'monitorddaddress' },
          { text: '➖删除监控地址', callback_data: 'monitordeleteaddress' },
        ],
        [
          { text: '💎购买监控包', callback_data: 'monitorwalletbuy' },
          { text: '👨联系客服', url: 'https://t.me/support_bot' },
        ],
        [
          { text: '➡️下一页', callback_data: 'monitorwallet_2' },
          { text: '🛠修改备注', callback_data: 'monitorwalletupdate_1' },
          { text: '🛠修改监控', callback_data: 'monitorwalletfunc_1' },
        ],
      ] },
      text: '监控地址列表\n\n<b>TRX余额为：</b><code>8.125000 TRX</code>\n<b>USDT余额为：</b><code>12.500000 USDT</code>\n\n<b>剩余可监控数量：</b><code>0</code>\n<b>可点击下方购买监控套餐！</b>\n当前已监控地址：11 个\n  <code>T123456789ABCDEFGHJKLMNPQRSTUVWXYZ</code>\n',
    },
  })
})

test('native opt_type 6 keeps monitoring private and does not query group account data', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 11, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 6, monitor_word: '监控', reply_photo: 'ignored-photo', reply_content: 'ignored group content' }] }
    throw new Error('group opt_type 6 must not read account data: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 35, text: '监控' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: { chat_id: '-1007', reply_to_message_id: 35, allow_sending_without_reply: true, parse_mode: 'HTML', text: '监控钱包请私聊机器人！' },
  })
})

test('native opt_type 7 shows active shop goods and keeps recharge/contact actions below them', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const queries: string[] = []
  const pool = { query: async (sql: string) => {
    queries.push(sql)
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 12, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 7, monitor_word: '商品', reply_photo: null, reply_content: '选择商品' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [{ cash_trx: '10.250000', cash_usdt: '3.500000' }] }
    if (sql.startsWith('SELECT b.rid,b.goods_name')) return { rows: [
      { rid: 31, goods_name: '商品甲' },
      { rid: 32, goods_name: '商品乙' },
      { rid: 33, goods_name: '商品丙' },
    ] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 36, text: '商品' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [
          { text: '商品甲', callback_data: 'buygoods31_1' },
          { text: '商品乙', callback_data: 'buygoods32_1' },
        ],
        [{ text: '商品丙', callback_data: 'buygoods33_1' }],
        [
          { text: '🔥我要充值', callback_data: 'aitrusteeshiprechargetrx' },
          { text: '👨联系客服', url: 'https://t.me/support_bot' },
        ],
      ] },
      text: '选择商品\n\n<b>TRX余额为：</b><code>10.250000 TRX</code>\n<b>USDT余额为：</b><code>3.500000 USDT</code>\n\n',
    },
  })
  assert.ok(queries.some((sql) => sql.includes('t_shop_goods_bot') && sql.includes('a.status=0') && sql.includes('b.status=0')))
})

test('native opt_type 7 blocks group purchases and omits the private-only photo', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 13, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 7, monitor_word: '商品', reply_photo: 'ignored-photo', reply_content: 'ignored content' }] }
    throw new Error('group opt_type 7 must not read private account data: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 37, text: '商品' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '-1007', reply_to_message_id: 37, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🤖私聊机器人', url: 'https://t.me/sample_bot' }, { text: '👨联系客服', url: 'https://t.me/support_bot' }]] },
      text: '<b>该功能命令只能私聊机器人执行！点击下方私聊机器人</b> ！',
    },
  })
})

test('native opt_type 8 renders escaped account identity, balances, and top-up buttons', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 14, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 8, monitor_word: '个人中心', reply_photo: null, reply_content: '欢迎' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [{ cash_trx: '20.250000', cash_usdt: '5.750000' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 38, from: { id: 88, username: '<alice>' }, text: '个人中心' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
        { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
        { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
      ]] },
      text: '欢迎\n\n用户ID：<code>88</code>\n用户名：@&lt;alice&gt;\n<b>TRX余额为：</b><code>20.250000 TRX</code>\n<b>USDT余额为：</b><code>5.750000 USDT</code>\n\n⚠️充值的USDT可点击下方转换为TRX\n',
    },
  })
})

test('native opt_type 8 sends the initialization hint and contact link for missing account rows', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 15, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: '@support_bot', opt_type: 8, monitor_word: '个人中心', reply_photo: null, reply_content: '欢迎' }] }
    if (sql.startsWith('SELECT cash_trx')) return { rows: [] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 39, text: '个人中心' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '👨联系客服', url: 'https://t.me/support_bot' }]] },
      text: '欢迎用户信息为空，请发送 /start 初始化用户',
    },
  })
})

test('native opt_type 10 formats the configured per-transaction price without floating-point multiplication', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 16, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 10, monitor_word: '笔数', reply_photo: 'ignored-photo', reply_content: '--' }] }
    if (sql.startsWith('SELECT per_bishu_usdt_price')) return { rows: [{ per_bishu_usdt_price: '0.35', receive_wallet: 'T<Wallet>&' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 40, text: '笔数' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [
          { text: '👨联系客服', url: 'https://t.me/support_bot' },
          { text: '⏳剩余笔数', callback_data: 'energybishusy' },
        ],
        [
          { text: '📣地址绑定通知', callback_data: 'energybishubind' },
          { text: '✏️已绑通知地址', callback_data: 'energybishusearch' },
        ],
        [{ text: '➕增加地址笔数', callback_data: 'energybishubalanceadd' }],
      ] },
      text: '\n\n👉<b>每笔单价：0.35 USDT</b>\n✅<b>支付地址：<code>T&lt;Wallet&gt;&amp;</code></b>\n\n👆<b>请点击地址复制，直接转入USDT，如转入 35 USDT，可获得100次免费转账次数</b>\n💰如已在机器人充值USDT，可发送指令：<u>添加笔数 Txx 10</u>，手工添加笔数，Txx为您的波场钱包地址，10为需要添加的笔数',
    },
  })
})

test('native opt_type 10 shows group-safe bot links and missing-mode text', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 17, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: '@sample_bot', bot_admin_username: '@support_bot', opt_type: 10, monitor_word: '笔数', reply_photo: 'ignored-photo', reply_content: 'configured' }] }
    if (sql.startsWith('SELECT per_bishu_usdt_price')) return { rows: [] }
    throw new Error('unexpected query: ' + sql)
  } }
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      sent = { method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) }
      return Response.json({ ok: true })
    },
    botRid: 7,
    message: { chat: { id: -1007, type: 'supergroup' }, message_id: 41, text: '笔数' },
  }), true)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '-1007', allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '👨联系客服', url: 'https://t.me/support_bot' }, { text: '⏳剩余笔数', url: 'https://t.me/sample_bot' }]] },
      text: '还未配置笔数模式，请联系客服配置后再使用！',
    },
  })
})

test('native opt_type 9 queries filtered OKX C2C offers and escapes merchant fields', { skip: process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' }, async () => {
  const pool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT kr.rid')) return { rows: [{ rid: 19, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', bot_username: 'sample_bot', bot_admin_username: 'support_bot', opt_type: 9, monitor_word: 'c2c,Z2', reply_photo: null, reply_content: '' }] }
    throw new Error('unexpected query: ' + sql)
  } }
  const requests: string[] = []
  let sent: { method: string; payload: Record<string, unknown> } | undefined
  assert.equal(await handleTelegramKeywordReply({
    pool: pool as never,
    fetcher: async (input, init) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('api.telegram.org')) {
        sent = { method: url.split('/').pop()!, payload: JSON.parse(String(init?.body)) }
        return Response.json({ ok: true })
      }
      return Response.json({ code: '0', data: { sell: [
        { price: '7.12', nickName: '<Shop & Co>', paymentMethods: ['bank', 'aliPay'] },
        { price: '7.13', nickName: 'merchant', paymentMethods: ['wxPay'] },
      ] } })
    },
    botRid: 7,
    message: { chat: { id: 88, type: 'private' }, message_id: 91, text: 'Z2' },
  }), true)
  assert.match(requests[0], /paymentMethod=aliPay/u)
  assert.match(String(sent?.payload.text), /^<b>\[Okex商家C2C实时top10 - 支付宝\]<\/b>\n<b>查询时间：<code>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}<\/code><\/b>\n\n1️⃣  <code>7\.12  &lt;Shop &amp; Co&gt;<\/code>  🈶银行卡 支付宝\n2️⃣  <code>7\.13  merchant<\/code>  🈶微信$/u)
  assert.deepEqual(sent, {
    method: 'sendMessage',
    payload: {
      chat_id: '88', reply_to_message_id: 91, allow_sending_without_reply: true, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '所有', callback_data: 'z0' }, { text: '银行卡', callback_data: 'z1' },
        { text: '✅支付宝', callback_data: 'z2' }, { text: '微信', callback_data: 'z3' },
      ]] },
      text: sent?.payload.text,
    },
  })
})


test('plugin disable blocks linked keyword replies and omits disabled plugin keyboards while shared replies continue',async()=>{
 const previous=process.env.PLATFORM_TELEGRAM_ACTIONS
 process.env.PLATFORM_TELEGRAM_ACTIONS='true'
 try{
  let claimSql=''
  const claimPool={query:async(sql:string)=>{claimSql=sql;return{rows:[{claimable:false}]}}}
  assert.equal(await telegramKeyreplyClaimable(claimPool as never,7,{message:{chat:{type:'private'},text:'energy'}}),false)
  assert.ok(claimSql.includes("platform_plugin_config_effective('keyreply'"))

  const disabledReplyQueries:string[]=[]
  let disabledSent=0
  const disabledReplyPool={query:async(sql:string)=>{disabledReplyQueries.push(sql);return{rows:[]}}}
  assert.equal(await handleTelegramKeywordReply({pool:disabledReplyPool as never,fetcher:async()=>{disabledSent++;return Response.json({ok:true})},botRid:7,message:{chat:{id:88,type:'private'},message_id:19,text:'energy'}}),false)
  assert.equal(disabledSent,0)
  assert.ok(disabledReplyQueries[0].includes("platform_plugin_config_effective('keyreply'"))

  let keyboardQuery=''
  const sharedReplyPool={query:async(sql:string)=>{
    if(sql.startsWith('SELECT kr.rid'))return{rows:[{rid:4,bot_token:'12345:Abcdefghijklmnopqrstuvwxyz_123',bot_username:'bot',bot_admin_username:null,opt_type:1,monitor_word:'help',reply_photo:null,reply_content:'Shared reply'}]}
    if(sql.startsWith('SELECT k.keyboard_name')){keyboardQuery=sql;return{rows:[]}}
    if(sql.includes('SELECT is_enable AS enabled'))return{rows:[]}
    throw new Error('unexpected query: '+sql)
  }}
  let payload:Record<string,unknown>|undefined
  const handled=await handleTelegramKeywordReply({pool:sharedReplyPool as never,fetcher:async(_input,init)=>{payload=JSON.parse(String(init?.body));return Response.json({ok:true})},botRid:7,message:{chat:{id:88,type:'private'},message_id:20,text:'help'}})
  assert.equal(handled,true)
  assert.equal(payload?.text,'Shared reply')
  assert.equal('reply_markup' in (payload||{}),false)
  assert.equal(keyboardQuery.includes("platform_plugin_config_effective('keyreply_keyboard'"),true)
  assert.equal(keyboardQuery.includes("platform_plugin_config_effective('keyboard'"),true)
 }finally{if(previous===undefined)delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=previous}
})
