import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { ensureEmptyTemplateTablesSeeded, initializeEmptyLegacyDatabase } from './legacy-db-initializer.mjs'

function fakePool({ tableCounts = [0, 0] as number[], populated = false } = {}) {
 const statements: Array<{ sql: string; values?: unknown[] }> = []
 const client = {
  async query(sql: string, values?: unknown[]) {
   statements.push({ sql, values })
   if (sql.includes('FROM information_schema.tables')) return { rows: [{ count: tableCounts.shift() ?? 0 }] }
   if (sql.startsWith('SELECT EXISTS')) return { rows: [{ populated }] }
   if (sql.includes('pg_get_serial_sequence')) return { rows: [{ name: null }] }
   return { rows: [] }
  },
  release() {},
 }
 return { pool: { async connect() { return client } }, statements }
}

test('empty PostgreSQL receives the safe schema and only the password hash plus default records', async () => {
 const { pool, statements } = fakePool()
 const password = 'Local-only-initial-passphrase'
 const result = await initializeEmptyLegacyDatabase(pool as never, { initialPassword: password })
 assert.deepEqual(result, { initialized: true, templatesImported: true })

 const schemaSql = statements.find(item => item.sql.includes('CREATE TABLE public.t_admin'))?.sql || ''
 assert.match(schemaSql, /CREATE TABLE public\.t_admin_device_session/)
 assert.match(schemaSql, /ADD CONSTRAINT t_admin_pkey PRIMARY KEY/)
 assert.doesNotMatch(schemaSql, /^\s*(?:DROP|INSERT|COPY)\b/im)
 assert.doesNotMatch(schemaSql, /!requires-initial-password|INSERT INTO public\.t_admin /)

 const adminInsert = statements.find(item => item.sql.includes('INSERT INTO public.t_admin'))
 assert.ok(adminInsert)
 assert.equal(await bcrypt.compare(password, String(adminInsert.values?.[0])), true)

 const inserts = statements.filter(item => /^INSERT INTO public\.t_telegram_bot/i.test(item.sql))
 assert.ok(inserts.length > 150)
 assert.ok(statements.some(item => item.sql.includes("'超级管理员'")))
 assert.ok(statements.some(item => item.sql.includes("'App\\Models\\Admin\\Admin'")))
 assert.equal(statements.at(-1)?.sql, 'COMMIT')
})

test('an existing public schema is left untouched and needs no initial password', async () => {
 const { pool, statements } = fakePool({ tableCounts: [3] })
 const result = await initializeEmptyLegacyDatabase(pool as never, { initialPassword: '' })
 assert.deepEqual(result, { initialized: false, reason: 'existing-schema' })
 assert.equal(statements.length, 1)
})

test('empty database without a safe initial password fails before starting a transaction', async () => {
 const { pool, statements } = fakePool()
 await assert.rejects(initializeEmptyLegacyDatabase(pool as never, { initialPassword: 'short' }), /ADMIN_INITIAL_PASSWORD/)
 assert.equal(statements.length, 1)
})

test('concurrent initializer rechecks after acquiring the lock and rolls back without replay', async () => {
 const { pool, statements } = fakePool({ tableCounts: [0, 2] })
 const result = await initializeEmptyLegacyDatabase(pool as never, { initialPassword: 'Local-only-initial-passphrase' })
 assert.deepEqual(result, { initialized: false, reason: 'concurrent-initialization' })
 assert.ok(statements.some(item => item.sql === 'ROLLBACK'))
 assert.equal(statements.some(item => item.sql.includes('CREATE TABLE public.t_admin')), false)
})

test('existing template data prevents all template inserts', async () => {
 const { pool, statements } = fakePool({ populated: true })
 const imported = await ensureEmptyTemplateTablesSeeded(pool as never)
 assert.equal(imported, false)
 assert.equal(statements.some(item => /^INSERT INTO public\.t_telegram_bot/i.test(item.sql)), false)
 assert.equal(statements.at(-1)?.sql, 'COMMIT')
})
