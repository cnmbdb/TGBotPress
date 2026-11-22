import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

test('generated SQLite base schema and declarative migrations apply to an empty database', async()=>{
  const db=new DatabaseSync(':memory:')
  try{
    db.exec((await readFile(new URL('../legacy/sqlite-000-legacy-schema.sql',import.meta.url),'utf8')).replace(/^\s*--.*$/gm,''))
    const names=(await readdir(new URL('../migrations/sqlite/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()
    for(const name of names){try{db.exec(await readFile(new URL('../migrations/sqlite/'+name,import.meta.url),'utf8'))}catch(error){throw new Error(`${name}: ${error instanceof Error?error.message:String(error)}`)}}
    const count=db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 't_platform_%'").get().n
    assert.ok(count>=25,`expected platform tables, got ${count}`)
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='t_platform_telegram_update'").get())
  } finally {db.close()}
})
