import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPluginTelegramApi } from './telegram-api.server'

test('third-party Telegram API calls resolve the bot token only for an active plugin', async () => {
  let sql = ''
  let url = ''
  let payload = ''
  const pool = {
    async query(statement: string) {
      sql = statement
      return { rows: [{ bot_token: 'test-token' }], rowCount: 1 }
    },
  } as never
  const api = createPluginTelegramApi(pool, 'sample', async (input, init) => {
    url = String(input)
    payload = String(init?.body)
    return Response.json({ ok: true, result: { message_id: 7 } })
  })
  const result = await api.call(3, 'sendMessage', { chat_id: '42', text: 'hello' }) as { ok: boolean; result: { message_id: number } }
  assert.match(sql, /t_platform_plugin_lifecycle/u)
  assert.match(sql, /l\.state='active'/u)
  assert.match(sql, /t_platform_plugin_instance/u)
  assert.match(sql, /x\.state='active'/u)
  assert.match(url, /\/sendMessage$/u)
  assert.equal(payload, JSON.stringify({ chat_id: '42', text: 'hello' }))
  assert.equal(result.result.message_id, 7)
})

test('third-party Telegram API blocks methods owned by the platform poller', async () => {
  let fetched = false
  const api = createPluginTelegramApi({ query: async () => ({ rows: [{ bot_token: 'test-token' }], rowCount: 1 }) } as never, 'sample', async () => {
    fetched = true
    return Response.json({ ok: true })
  })
  await assert.rejects(api.call(3, 'getUpdates'), /plugin_telegram_method_invalid/u)
  assert.equal(fetched, false)
})

test('third-party Telegram API refuses a Bot disabled for this plugin instance', async () => {
  let fetched=false
  const api=createPluginTelegramApi({query:async()=>({rows:[],rowCount:0})} as never,'sample',async()=>{fetched=true;return Response.json({ok:true})})
  await assert.rejects(api.call(8,'sendMessage',{chat_id:'1',text:'blocked'}),/plugin_telegram_bot_unavailable/u)
  assert.equal(fetched,false)
})
