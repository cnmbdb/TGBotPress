import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('generated D1 SQLite migrations apply to a clean database', async()=>{
  const generated=spawnSync(process.execPath,[fileURLToPath(new URL('./generate-d1-migrations.mjs',import.meta.url))],{encoding:'utf8'})
  assert.equal(generated.status,0,generated.stderr)
  const files=(await readdir(new URL('../migrations/d1/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()
  const db=new DatabaseSync(':memory:')
  try{
    for(const file of files)db.exec(await readFile(new URL('../migrations/d1/'+file,import.meta.url),'utf8'))
    const tables=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n
    assert.ok(tables>=100,`expected legacy and platform tables, got ${tables}`)
    assert.equal(db.prepare('SELECT count(*) AS n FROM t_roles').get().n,1)
    assert.match(db.prepare('SELECT model_type FROM t_model_has_roles LIMIT 1').get().model_type,/App\\Models\\Admin\\Admin/)
  }finally{db.close()}
})
