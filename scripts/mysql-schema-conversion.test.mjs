import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const source = await readFile(new URL('../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
const outputUrl = new URL('../legacy/mysql-000-legacy-schema.sql', import.meta.url)

test('MySQL base schema generation preserves all tables and auto-increment keys', async () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-mysql-legacy-schema.mjs', import.meta.url))], { cwd: fileURLToPath(root), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const mysqlSchema = await readFile(outputUrl, 'utf8')
  const sourceTables = [...source.matchAll(/CREATE TABLE public\.(\w+)/g)].map(match => match[1]).sort()
  const mysqlTables = [...mysqlSchema.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]).sort()
  assert.deepEqual(mysqlTables, sourceTables)
  assert.equal((mysqlSchema.match(/AUTO_INCREMENT/g) ?? []).length, (source.match(/\bbigserial\b/gi) ?? []).length + (source.match(/SET DEFAULT nextval/g) ?? []).length)
  assert.match(mysqlSchema, /active_opening_master_bot_rid INT GENERATED ALWAYS/)
  assert.match(mysqlSchema, /CREATE UNIQUE INDEX uq_telegram_clone_proxy_opening_pending_user/)
  assert.doesNotMatch(mysqlSchema, /::\w+|nextval\(|CREATE SEQUENCE|\bDO \$\$/)
})
