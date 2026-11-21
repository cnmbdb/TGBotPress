import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTimingAdKeyboard, expandTimingAdTemplate, sendTimingTelegramAds, timingAdCycleMs, timingAdIsDue } from './send-timing-telegram.server'

const placeholder = (name: string) => String.fromCharCode(36) + '{' + name + '}'
test('supports all legacy timer intervals and due boundaries', () => {
  assert.equal(timingAdCycleMs(1), 60_000)
  assert.equal(timingAdCycleMs(17), 15_552_000_000)
  assert.equal(timingAdCycleMs(99), null)
  assert.equal(timingAdIsDue(2, '2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:10:00Z')), true)
  assert.equal(timingAdIsDue(2, '2026-01-01T00:00:01Z', Date.parse('2026-01-01T00:10:00Z')), false)
})
test('builds inline and reply keyboards with custom emoji IDs', () => {
  const inline = buildTimingAdKeyboard([
    { keyboard_name: 'Open', keyboard_icon_custom_emoji_id: 'emoji-id=123456789', keyboard_type: 2, inline_type: 1, keyboard_value: 'https://example.test' },
    { keyboard_name: 'Click', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'go' },
    { keyboard_name: 'More', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'more' },
  ])
  assert.deepEqual(inline, { inline_keyboard: [[
    { text: 'Open', icon_custom_emoji_id: '123456789', url: 'https://example.test' },
    { text: 'Click', callback_data: 'go' },
  ], [{ text: 'More', callback_data: 'more' }]] })
  const reply = buildTimingAdKeyboard([
    { keyboard_name: 'A', keyboard_icon_custom_emoji_id: null, keyboard_type: 1, inline_type: 0, keyboard_value: '-' },
    { keyboard_name: 'B', keyboard_icon_custom_emoji_id: null, keyboard_type: 1, inline_type: 0, keyboard_value: '-' },
  ])
  assert.deepEqual(reply, { keyboard: [['A', 'B']], resize_keyboard: true, one_time_keyboard: false })
})
test('expands the legacy exchange template values', () => {
  const template = '10=' + placeholder('trx10usdtrate') + '; ' + placeholder('tgbotname') + '; ' + placeholder('trxusdtwallet') + '; ' + placeholder('unknown')
  assert.equal(expandTimingAdTemplate(template, { exchange_rate: '2.50', receive_wallet: 'TWallet', show_notes: 'Notice' }, 'my_bot', 'admin'),
    '10=25; @my_bot; TWallet; ' + placeholder('unknown'))
})
test('broadcasts direct and active users with template and keyboard via injected sender', async () => {
  const original = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  const ad = { rid: 9, bot_rid: 4, bot_token: 'fixture-token', bot_username: 'my_bot', bot_admin_username: 'admin', notice_cycle: 1,
    notice_obj: '-1001,888', notice_ad: '10=' + placeholder('trx10usdtrate') + ' ' + placeholder('tgbotname'), notice_photo: null, last_notice_time: null }
  const sent: { url: string; body: any }[] = []
  let afterClaim = 0
  const client = { query: async (sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
    if (sql.includes('SELECT notice_cycle,last_notice_time')) return { rows: [{ notice_cycle: 1, last_notice_time: null }], rowCount: 1 }
    if (sql.includes('UPDATE t_telegram_bot_ad SET last_notice_time')) { afterClaim++; return { rows: [{ rid: 9 }], rowCount: 1 } }
    throw new Error('unexpected transaction query')
  }, release() {} }
  const pool = { connect: async () => client, query: async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM t_telegram_bot_ad a')) return { rows: values?.[0] === 0 ? [ad] : [], rowCount: values?.[0] === 0 ? 1 : 0 }
    if (sql.includes('FROM t_telegram_bot_ad_keyboard a')) return { rows: [
      { keyboard_name: 'Open', keyboard_icon_custom_emoji_id: '12345', keyboard_type: 2, inline_type: 1, keyboard_value: 'https://example.test' },
      { keyboard_name: 'Help', keyboard_icon_custom_emoji_id: null, keyboard_type: 2, inline_type: 2, keyboard_value: 'help' },
    ], rowCount: 2 }
    if (sql.includes('FROM t_transit_wallet_coin a')) return { rows: [{ exchange_rate: '2.50', receive_wallet: 'TWallet', show_notes: 'Notice' }], rowCount: 1 }
    if (sql.includes('FROM t_telegram_bot_user')) return { rows: [{ tg_uid: '555' }, { tg_uid: '666' }], rowCount: 2 }
    throw new Error('unexpected query')
  } } as never
  try {
    const result = await sendTimingTelegramAds({
      pool, now: () => Date.UTC(2026, 0, 1), logger: { info() {}, error() {} },
      fetcher: async (url, init) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json({ ok: true }) },
    })
    assert.deepEqual(result, { skipped: false, scanned: 1, claimed: 1, sent: 3, failed: 0 })
    assert.equal(afterClaim, 1)
    assert.equal(sent.length, 3)
    assert.equal(sent[0].body.text, '10=25 @my_bot')
    assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].icon_custom_emoji_id, '12345')
    assert.deepEqual(sent.map(item => item.body.chat_id), ['-1001', '555', '666'])
  } finally { process.env.PLATFORM_TELEGRAM_ACTIONS = original ?? 'false' }
})
test('keeps real Telegram actions disabled in development without querying or sending', async () => {
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  let queries = 0, sends = 0
  const result = await sendTimingTelegramAds({
    pool: { query: async () => { queries++; return { rows: [], rowCount: 0 } }, connect: async () => { throw new Error('not expected') } } as never,
    fetcher: async () => { sends++; return Response.json({ ok: true }) },
  })
  assert.deepEqual(result, { skipped: true, scanned: 0, claimed: 0, sent: 0, failed: 0 })
  assert.equal(queries, 0)
  assert.equal(sends, 0)
})

