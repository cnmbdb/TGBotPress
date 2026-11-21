import assert from 'node:assert/strict'
import test from 'node:test'
import { telegramEnergyBishuBindCommand, handleTelegramEnergyBishuBind } from './telegram-energy-bishu-bind.server'

const wallet = 'T' + 'A'.repeat(33)
const message = (text: string) => ({ message_id: 1, chat: { id: 77, type: 'private' }, from: { id: 77 }, text })

test('recognizes both legacy energy bishu bind commands only in the sender private chat', () => {
  assert.equal(telegramEnergyBishuBindCommand({ message: message(`绑定笔数 ${wallet} 101,202`) })?.text.startsWith('绑定笔数'), true)
  assert.equal(telegramEnergyBishuBindCommand({ message: message(`笔数绑定 ${wallet} 101`) })?.text.startsWith('笔数绑定'), true)
  assert.equal(telegramEnergyBishuBindCommand({ message: { ...message('绑定笔数'), chat: { id: -77, type: 'group' } } }), null)
  assert.equal(telegramEnergyBishuBindCommand({ message: { ...message('绑定笔数'), chat: { id: 88, type: 'private' } } }), null)
  assert.equal(telegramEnergyBishuBindCommand({ message: { ...message('绑定笔数'), from: { id: 77, is_bot: true } } }), null)
  assert.equal(telegramEnergyBishuBindCommand({ message: message('ordinary text') }), null)
})

test('does not write if wallet is missing and replies with legacy-equivalent guidance', async () => {
  const calls: string[] = []
  const result = await handleTelegramEnergyBishuBind({
    pool: { query: async (sql: string) => { calls.push(sql); return { rows: [{ wallet_exists: false, platform_exists: false, admin_uids: null }], rowCount: 0 } } } as never,
    botRid: 1,
    update: { message: message(`绑定笔数 ${wallet} 101`) },
    sendMessage: async (_message, text) => { assert.match(text, /不存在笔数套餐/); return true },
  })
  assert.equal(result.kind, 'replied')
  assert.equal(calls.length, 1)
})
