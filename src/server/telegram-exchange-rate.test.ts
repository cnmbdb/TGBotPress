import assert from 'node:assert/strict'
import test from 'node:test'
import { handleTelegramExchangeRate, telegramExchangeRateCommand } from './telegram-exchange-rate.server'

const message = (text: string, chat: { id: number; type: string } = { id: 81, type: 'private' }) => ({
  message_id: 9, text, chat, from: { id: 81 },
})

test('parses legacy integer USDT/U rate commands, defaulting the bare token to one', () => {
  assert.equal(telegramExchangeRateCommand({ message: message('usdt') })?.amount, '1')
  assert.equal(telegramExchangeRateCommand({ message: message('25 USDT') })?.amount, '25')
  assert.equal(telegramExchangeRateCommand({ message: message('07u') })?.amount, '07')
  assert.equal(telegramExchangeRateCommand({ message: message('1.5u') }), null)
  const groupMessage = message('25u', { id: -9, type: 'group' })
  assert.equal(telegramExchangeRateCommand({ message: groupMessage }), null)
  assert.equal(telegramExchangeRateCommand({ message: groupMessage }, { allowGroups: true })?.amount, '25')
  assert.equal(telegramExchangeRateCommand({ message: message('25u', { id: 82, type: 'private' }) }), null)
})

test('replies with exact two-decimal rate arithmetic and escapes the public wallet in HTML', async () => {
  let sent = ''
  const result = await handleTelegramExchangeRate({
    pool: { query: async () => ({ rows: [{ exchange_rate: '2.50', receive_wallet: '<wallet&>' }], rowCount: 1 }) } as never,
    botRid: 1,
    update: { message: message('3u') },
    sendMessage: async (_message, text) => { sent = text; return true },
  })
  assert.equal(result.kind, 'replied')
  assert.equal(result.configured, true)
  assert.match(sent, /3 USDT = 7.5 TRX/)
  assert.match(sent, /&lt;wallet&amp;&gt;/)
})

test('reports missing exchange wallet without treating it as a failed delivery', async () => {
  let sent = ''
  const result = await handleTelegramExchangeRate({
    pool: { query: async () => ({ rows: [], rowCount: 0 }) } as never,
    botRid: 1,
    update: { message: message('u') },
    sendMessage: async (_message, text) => { sent = text; return true },
  })
  assert.equal(result.kind, 'replied')
  assert.equal(result.configured, false)
  assert.match(sent, /请先配置机器人闪兑钱包/)
})
