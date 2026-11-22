import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

test('generated SQLite legacy schema executes and preserves table/primary-key declarations', async () => {
  const generator=fileURLToPath(new URL('./generate-sqlite-legacy-schema.mjs',import.meta.url))
  const generated=spawnSync(process.execPath,[generator],{encoding:'utf8'})
  assert.equal(generated.status,0,generated.stderr)
  const sql=await readFile(new URL('../legacy/sqlite-000-legacy-schema.sql',import.meta.url),'utf8')
  const db=new DatabaseSync(':memory:')
  try {
    db.exec(sql.replace(/^\s*--.*$/gm,''))
    const tables=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n
    assert.equal(tables,64)
    const admin=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_admin'").get().sql
    assert.match(admin,/id INTEGER PRIMARY KEY AUTOINCREMENT/)
  } finally { db.close() }
})
