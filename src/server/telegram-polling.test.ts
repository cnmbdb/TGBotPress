import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { pollNextTelegramBot } from './telegram-polling.server'

function createPool(options: { acquired?: boolean; bot?: Record<string, unknown> } = {}) {
  const calls: string[] = []
  const pool = {
    calls,
    query: async (sql: string, ..._args: unknown[]) => {
      calls.push(sql)
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: options.bot ? [options.bot] : [], rowCount: options.bot ? 1 : 0 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: options.acquired === false ? [] : [{ owner_id: 'lease' }], rowCount: options.acquired === false ? 0 : 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, ...args: unknown[]) => pool.query(sql, ...args), release() {} }),
  }
  return { pool: pool as unknown as Pick<Pool, 'query' | 'connect'>, calls }
}

const baseOptions = {
  afterBotRid: 0,
  pollingEnabled: true,
  telegramEnabled: true,
  pollingToken: 'x'.repeat(40),
  legacyOrigin: 'http://admin.local',
  appUrl: 'https://admin.example.test',
}

test('Telegram polling is disabled without touching the database', async () => {
  const { pool, calls } = createPool()
  const result = await pollNextTelegramBot({ ...baseOptions, pool, pollingEnabled: false, fetcher: async () => { throw new Error('unexpected network request') } })
  assert.equal(result.skipped, true)
  assert.deepEqual(calls, [])
})

test('Telegram polling relays updates to Admin and keeps webhook deletion off by default', async () => {
  const { pool, calls } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    fetcher: async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('getUpdates')) return Response.json({ ok: true, result: [{ update_id: 41, message: { text: 'hello' }, ignored_field: 'discard' }] })
      return new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /offset=41/)
  assert.match(requests[0].url, /allowed_updates=/)
  assert.equal(requests[1].url, 'http://admin.local/api/telegram/getdata?rid=7')
  assert.equal(new Headers(requests[1].init?.headers).get('host'), 'admin.example.test')
  assert.equal(new Headers(requests[1].init?.headers).get('x-internal-telegram-token'), 'x'.repeat(40))
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { rid: 7, update_id: 41, message: { text: 'hello' } })
  assert.ok(calls.some(sql => sql.startsWith('DELETE FROM t_platform_job_leader')))
})

test('polling subscribes to active third-party manifest update types and queues them for the plugin runtime', async () => {
  let lastUpdateId: number | null = 50
  const update={update_id:51,inline_query:{id:'inline-1',from:{id:9},query:'search'}}
  const statements:string[]=[]
  const pool={
    dialect:'postgres',
    query:async(sql:string)=>{
      statements.push(sql)
      if(sql.startsWith('SELECT rid,bot_token,last_update_id'))return{rows:[{rid:7,bot_token:'bot-secret',last_update_id:lastUpdateId}],rowCount:1}
      if(sql.startsWith('SELECT DISTINCT jsonb_array_elements_text'))return{rows:[{update_type:'inline_query'}],rowCount:1}
      if(sql.startsWith('SELECT EXISTS'))return{rows:[{claimable:true}],rowCount:1}
      if(sql.startsWith('INSERT INTO t_platform_job_leader'))return{rows:[{owner_id:'lease'}],rowCount:1}
      return{rows:[],rowCount:1}
    },
    connect:async()=>({query:async(sql:string,values?:unknown[])=>{
      statements.push(sql)
      if(sql.startsWith('SELECT last_update_id FROM t_telegram_bot'))return{rows:[{last_update_id:lastUpdateId}],rowCount:1}
      if(sql.startsWith('INSERT INTO t_platform_telegram_update'))return{rows:[{rid:110}],rowCount:1}
      if(sql.startsWith('UPDATE t_telegram_bot SET last_update_id')){lastUpdateId=Number(values?.[1]);return{rows:[],rowCount:1}}
      return{rows:[],rowCount:1}
    },release(){}}),
  } as unknown as Pick<Pool,'query'|'connect'>
  const urls:string[]=[]
  const result=await pollNextTelegramBot({
    ...baseOptions,pool,supportUpdateSyncEnabled:true,
    fetcher:async input=>{const url=String(input);urls.push(url);return url.includes('getUpdates')?Response.json({ok:true,result:[update]}):new Response('',{status:200})},
  })
  assert.equal(result.accepted,1)
  const allowed=new URL(urls[0]!).searchParams.get('allowed_updates')
  assert.ok(JSON.parse(allowed!).includes('inline_query'))
  assert.ok(statements.some(sql=>sql.startsWith('INSERT INTO t_platform_telegram_update')))
  assert.equal(lastUpdateId,51)
})

test('plain private /start is routed into the durable inbox for native follower handling', async () => {
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, message: { message_id: 12, chat: { id: 55, type: 'private' }, from: { id: 55, username: 'alice' }, text: '/start' } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 90 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('private userbindaddress callback is routed into the durable inbox for native wallet binding', async () => {
  let lastUpdateId: number | null = 40
  const update = { update_id: 42, callback_query: { id: 'cb-42', data: 'userbindaddress', from: { id: 55 }, message: { message_id: 17, chat: { id: 55, type: 'private' } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 91 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.values?.[1] === JSON.stringify(update)))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 42)
})

test('private shared-ID replies route through the native durable inbox instead of Admin PHP', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, message: { message_id: 17, chat: { id: 55, type: 'private' }, from: { id: 55 }, user_shared: { request_id: 1, user_id: 123456 } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 93 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('private edited_message routes through the native durable inbox instead of Admin PHP', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, edited_message: { message_id: 17, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '/start' } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 95 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('private bindA callback routes through the native durable inbox instead of Admin PHP', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, callback_query: { id: 'callback-1', data: 'bindA', from: { id: 55 }, message: { message_id: 18, chat: { id: 55, type: 'private' } } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 94 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('native my_chat_member dispatch writes the durable inbox and advances Telegram offset atomically', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, my_chat_member: { from: { is_bot: false }, chat: { id: 123, type: 'private', username: 'alice', first_name: 'Alice' }, new_chat_member: { status: 'member' } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 90 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    memberUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.ok(statements.findIndex(row => row.sql === 'BEGIN') < statements.findIndex(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update')))
  assert.ok(statements.findIndex(row => row.sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) < statements.findIndex(row => row.sql === 'COMMIT'))
  assert.equal(lastUpdateId, 41)
})

test('native my_chat_member dispatch stays on PHP while its consumer gate is disabled', async () => {
  const { pool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    memberUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates')
        ? Response.json({ ok: true, result: [{ update_id: 41, my_chat_member: { chat: { id: 123, type: 'private' }, new_chat_member: { status: 'member' } } }] })
        : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.equal(requests[1], 'http://admin.local/api/telegram/getdata?rid=7')
})

test('native join-request dispatch uses the durable inbox only when its consumer gate is enabled', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, chat_join_request: { chat: { id: -123, type: 'supergroup' }, from: { id: 456, first_name: 'New', username: 'new_user' }, user_chat_id: 456 } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 91 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    joinUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('unsupported chat_member transitions enter the native inbox for terminal ignore handling', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, chat_member: { chat: { id: -1009, type: 'supergroup' }, old_chat_member: { status: 'member' }, new_chat_member: { status: 'left', user: { id: 900 } } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 96 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, joinUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('join-request polling remains on PHP while its consumer gate is disabled', async () => {
  const { pool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    joinUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates')
        ? Response.json({ ok: true, result: [{ update_id: 41, chat_join_request: { chat: { id: -123 }, from: { id: 456 } } }] })
        : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.equal(requests[1], 'http://admin.local/api/telegram/getdata?rid=7')
})

test('native group-message dispatch writes the durable inbox under the dispatcher gate', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, message: { chat: { id: -100123, type: 'supergroup' }, message_id: 99, text: 'hello group', from: { id: 456 } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 92 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    groupMessageSyncEnabled: true,
    joinUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('native group-title changes enter the durable inbox instead of PHP fallback', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, message: { chat: { id: -100123, type: 'supergroup', username: 'renamed_group' }, message_id: 100, new_chat_title: 'Renamed Group', from: { id: 456, is_bot: false } } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 92 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    groupMessageSyncEnabled: true,
    joinUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('group-message polling stays on PHP when the dispatcher gate is disabled', async () => {
  const { pool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    groupMessageSyncEnabled: false,
    joinUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates')
        ? Response.json({ ok: true, result: [{ update_id: 41, message: { chat: { id: -100123, type: 'supergroup' }, message_id: 99, text: 'hello group' } }] })
        : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.equal(requests[1], 'http://admin.local/api/telegram/getdata?rid=7')
})

test('new-member service messages are not stranded in the group-message queue', async () => {
  const { pool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const requests: string[] = []
  await pollNextTelegramBot({
    ...baseOptions,
    pool,
    groupMessageSyncEnabled: true,
    joinUpdateSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates')
        ? Response.json({ ok: true, result: [{ update_id: 41, message: { chat: { id: -100123, type: 'supergroup' }, message_id: 100, new_chat_member: { id: 456 } } }] })
        : new Response('', { status: 200 })
    },
  })
  assert.equal(requests[1], 'http://admin.local/api/telegram/getdata?rid=7')
})

test('Telegram polling stops the batch when Admin does not accept an update', async () => {
  const { pool, calls } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 0 } })
  const relayed: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    fetcher: async input => {
      const url = String(input)
      if (url.includes('getUpdates')) return Response.json({ ok: true, result: [{ update_id: 1, message: {} }, { update_id: 2, callback_query: {} }] })
      relayed.push(url)
      return new Response('', { status: 503 })
    },
  })
  assert.equal(result.accepted, 0)
  assert.equal(relayed.length, 1)
  assert.ok(!calls.some(sql => sql.startsWith('UPDATE t_telegram_bot SET last_update_id')))
})

test('deleteWebhook is called only with the explicit option', async () => {
  const { pool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 0 } })
  const methods: string[] = []
  await pollNextTelegramBot({
    ...baseOptions,
    pool,
    deleteWebhook: true,
    fetcher: async input => {
      const url = String(input)
      methods.push(url.includes('deleteWebhook') ? 'deleteWebhook' : url.includes('getUpdates') ? 'getUpdates' : 'admin')
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [] }) : Response.json({ ok: true, result: true })
    },
  })
  assert.deepEqual(methods, ['deleteWebhook', 'getUpdates'])
})

test('one bot polling lease prevents duplicate long-poll requests', async () => {
  const { pool } = createPool({ acquired: false, bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 0 } })
  const result = await pollNextTelegramBot({ ...baseOptions, pool, fetcher: async () => { throw new Error('unexpected network request') } })
  assert.equal(result.locked, true)
})

test('support-enabled private updates claimed by the support worker enter the durable inbox', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const update = { update_id: 41, message: { message_id: 10, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '/support' } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 90 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    supportUpdateSyncEnabled: true,
    memberUpdateSyncEnabled: false,
    joinUpdateSyncEnabled: false,
    groupMessageSyncEnabled: false,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.values?.[0] === 7 && row.values?.[1] === JSON.stringify(update)))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('verification Mini App /start links enter the durable inbox instead of PHP fallback', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  let lastUpdateId: number | null = 40
  const token = 'a'.repeat(64)
  const update = { update_id: 41, message: { message_id: 11, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: `/start ${token}` } }
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
        if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 91 }], rowCount: 1 }
        if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 1 }
      },
      release() {},
    }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    memberUpdateSyncEnabled: false,
    joinUpdateSyncEnabled: false,
    groupMessageSyncEnabled: false,
    supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.values?.[1] === JSON.stringify(update)))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 41)
})

test('private updates the support worker cannot claim stay on PHP', async () => {
  const { pool: basePool } = createPool({ bot: { rid: 7, bot_token: 'bot-secret', last_update_id: 40 } })
  const calls: string[] = []
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, ...args: unknown[]) => {
      calls.push(sql)
      statements.push({ sql, values: Array.isArray(args[0]) ? args[0] as unknown[] : undefined })
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: false }], rowCount: 1 }
      return Reflect.apply(basePool.query, basePool, [sql, ...args])
    },
    connect: basePool.connect,
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions,
    pool,
    supportUpdateSyncEnabled: true,
    memberUpdateSyncEnabled: false,
    joinUpdateSyncEnabled: false,
    groupMessageSyncEnabled: false,
    fetcher: async (input, init) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('getUpdates')) return Response.json({ ok: true, result: [{ update_id: 41, message: { message_id: 11, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: 'ordinary message' } }] })
      return init?.method === 'POST' ? new Response('', { status: 200 }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.equal(requests[1], 'http://admin.local/api/telegram/getdata?rid=7')
  assert.ok(calls.some(sql => sql.startsWith('SELECT EXISTS')))
  assert.ok(statements.some(row => row.sql.startsWith('UPDATE t_telegram_bot SET last_update_id=GREATEST') && row.values?.[0] === 7 && row.values?.[1] === 41))
})

test('private energy bishu bind command is routed into the native durable inbox', async () => {
  let lastUpdateId: number | null = 40
  const update = { update_id: 43, message: { message_id: 18, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '绑定笔数 T' + 'A'.repeat(33) + ' 700002,700003' } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 94 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.values?.[1] === JSON.stringify(update)))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 43)
})
test('private USDT/U exchange-rate command is routed into the native durable inbox', async () => {
  let lastUpdateId: number | null = 40
  const update = { update_id: 44, message: { message_id: 19, chat: { id: 55, type: 'private' }, from: { id: 55 }, text: '5 USDT' } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 95 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.values?.[1] === JSON.stringify(update)))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 44)
})

test('premium wallet payment callback is queued natively instead of being relayed to PHP', async () => {
  let lastUpdateId: number | null = 40
  const update = { update_id: 45, callback_query: { id: 'premium-pay-45', data: 'tgpremiumwalletpay_72', from: { id: 55 }, message: { message_id: 81, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '余额支付', callback_data: 'tgpremiumwalletpay_72' }]] } } } }
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT rid,bot_token,last_update_id')) return { rows: [{ rid: 7, bot_token: 'bot-secret', last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ claimable: true }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_job_leader')) return { rows: [{ owner_id: 'lease' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values })
      if (sql.startsWith('SELECT last_update_id FROM t_telegram_bot')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_platform_telegram_update')) return { rows: [{ rid: 96 }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(values?.[1]); return { rows: [], rowCount: 1 } }
      return { rows: [], rowCount: 1 }
    }, release() {} }),
  } as unknown as Pick<Pool, 'query' | 'connect'>
  const requests: string[] = []
  const result = await pollNextTelegramBot({
    ...baseOptions, pool, supportUpdateSyncEnabled: true,
    fetcher: async input => {
      const url = String(input)
      requests.push(url)
      return url.includes('getUpdates') ? Response.json({ ok: true, result: [update] }) : new Response('', { status: 200 })
    },
  })
  assert.equal(result.accepted, 1)
  assert.deepEqual(requests.map(url => new URL(url).hostname), ['api.telegram.org'])
  assert.ok(statements.some(row => row.sql.startsWith('SELECT EXISTS') && row.sql.includes("tgpremiumwalletpay_[1-9][0-9]{0,9}")))
  assert.ok(statements.some(row => row.sql.startsWith('INSERT INTO t_platform_telegram_update') && row.values?.[2] === JSON.stringify(update)))
  assert.equal(lastUpdateId, 45)
})
