import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planEnergyTradeNotices, sendEnergyTelegramNotifications } from './send-energy-telegram.server'

const trade = (overrides: Record<string, unknown> = {}) => ({
  rid: 3,
  tx_hash: 'energy<&hash',
  transferfrom_address: 'T123456789abcdefghijk',
  coin_name: 'TRX',
  amount: '5',
  process_status: 9,
  process_comments: null,
  tg_notice_status_receive: 'N',
  tg_notice_status_send: 'N',
  tg_notice_obj_receive: '-10001,10002',
  tg_notice_obj_send: '-10003',
  bot_token: 'fixture-token',
  receive_wallet: 'Tenergy',
  energy_amount: 65000,
  package_name: '65K energy',
  bot_username: '@energy_bot',
  bot_admin_username: '@admin',
  ...overrides,
})

test('energy trade plans receive and success notices with recipient groups and legacy buttons', () => {
  const plan = planEnergyTradeNotices(trade() as never)
  assert.equal(plan.receiveDone, true)
  assert.equal(plan.sendDone, true)
  assert.deepEqual(plan.notices.map(notice => notice.chatId), ['-10001', '10002', '-10003'])
  assert.match(plan.notices[0].text, /energy&lt;&amp;hash/)
  assert.equal((plan.notices[2].replyMarkup as any).inline_keyboard[0][0].url, 'https://t.me/energy_bot')
  assert.equal((plan.notices[2].replyMarkup as any).inline_keyboard[1][0].url, 'https://t.me/admin')
})

test('energy trade keeps in-progress notifications pending and completes legacy terminal statuses', () => {
  const pending = planEnergyTradeNotices(trade({ process_status: 0 }) as never)
  assert.equal(pending.receiveDone, false)
  assert.equal(pending.sendDone, false)
  assert.equal(pending.notices.length, 0)
  const terminal = planEnergyTradeNotices(trade({ process_status: 5 }) as never)
  assert.equal(terminal.receiveDone, true)
  assert.equal(terminal.sendDone, true)
  const noTargets = planEnergyTradeNotices(trade({ tg_notice_obj_receive: '', tg_notice_obj_send: null }) as never)
  assert.equal(noTargets.receiveDone, true)
  assert.equal(noTargets.sendDone, true)
})

test('energy notifications have no database or Telegram side effects while disabled', async () => {
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  delete process.env.PLATFORM_TELEGRAM_ACTIONS
  let queries = 0
  try {
    const result = await sendEnergyTelegramNotifications({
      pool: {
        query: async () => { queries++; throw new Error('unexpected query') },
        connect: async () => { throw new Error('unexpected connect') },
      } as never,
      fetcher: async () => { throw new Error('unexpected send') },
    })
    assert.deepEqual(result, { skipped: true, scanned: 0, sent: 0, failed: 0 })
    assert.equal(queries, 0)
  } finally {
    if (previous != null) process.env.PLATFORM_TELEGRAM_ACTIONS = previous
  }
})


test('USDT bishu package trades preserve their dedicated legacy Telegram notice', () => {
  const plan=planEnergyTradeNotices(trade({coin_name:'usdt',process_comments:'成功,笔数套餐增加：12'}) as never)
  const notice=plan.notices.at(-1)!
  assert.match(notice.text,/笔数套餐购买成功/)
  assert.match(notice.text,/免费转账<\/b>：12 次/)
  assert.equal((notice.replyMarkup as any).inline_keyboard[0].length,2)
  assert.doesNotMatch(notice.text,/新的能量订单成功/)
})
