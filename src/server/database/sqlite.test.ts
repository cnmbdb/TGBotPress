import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteDatabase, sqlitePlaceholders } from './sqlite.server'

test('SQLite adapter rewrites positional placeholders, casts and array membership', () => {
  assert.deepEqual(sqlitePlaceholders("SELECT id::text FROM item WHERE id=$1 AND id=ANY($2::bigint[])", [7,[7,8]]), {
    sql: 'SELECT id FROM item WHERE id=? AND id IN (SELECT value FROM json_each(?))', values: [7,'[7,8]'],
  })
})

test('SQLite database adapter persists queries and supports transaction clients', async () => {
  const dir=await mkdtemp(join(tmpdir(),'tgbotpress-sqlite-')),db=SqliteDatabase.connect(join(dir,'test.sqlite'))
  try {
    await db.query('CREATE TABLE item(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT NOT NULL)')
    const client=await db.connect()
    await client.query('BEGIN')
    await client.query('INSERT INTO item(value) VALUES($1)', ['persisted'])
    await client.query('COMMIT')
    client.release()
    assert.deepEqual((await db.query<{value:string}>('SELECT value FROM item WHERE id=$1',[1])).rows,[{value:'persisted'}])
  } finally {await db.end();await rm(dir,{recursive:true,force:true})}
})
