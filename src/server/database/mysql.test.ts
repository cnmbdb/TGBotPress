import test from 'node:test'
import assert from 'node:assert/strict'
import { mysqlPlaceholders } from './mysql.server'

test('MySQL adapter binds positional values in SQL order', () => {
  assert.deepEqual(mysqlPlaceholders('UPDATE item SET name=$2 WHERE id=$1', ['id-1', 'Ada']), {
    sql: 'UPDATE item SET name=? WHERE id=?', values: ['Ada', 'id-1'],
  })
})

test('placeholder conversion leaves quoted text and SQL comments untouched', () => {
  assert.deepEqual(mysqlPlaceholders("SELECT '$1', \"$2\", `$3` -- $4\nFROM item WHERE id=$1 /* $2 */", ['x']), {
    sql: "SELECT '$1', \"$2\", `$3` -- $4\nFROM item WHERE id=? /* $2 */", values: ['x'],
  })
})

test('placeholder conversion rejects missing and unused values', () => {
  assert.throws(() => mysqlPlaceholders('SELECT $2', ['one']), /mysql_parameter_missing:2/)
  assert.throws(() => mysqlPlaceholders('SELECT $1', ['one', 'two']), /mysql_parameter_count_mismatch:1:2/)
})

test('MySQL adapter rewrites plugin target ANY membership to JSON containment', () => {
  assert.deepEqual(mysqlPlaceholders("SELECT c.rid FROM t_telegram_bot_command c WHERE $1=ANY(platform_plugin_config_targets('command',c.bot_rid,c.rid,c.command,NULL))", ['transit']), {
    sql: "SELECT c.rid FROM t_telegram_bot_command c WHERE JSON_CONTAINS(platform_plugin_config_targets('command',c.bot_rid,c.rid,c.command,NULL),JSON_QUOTE(CAST(? AS CHAR)))",
    values: ['transit'],
  })
})

test('MySQL adapter removes PostgreSQL casts without changing quoted literals', () => {
  assert.deepEqual(mysqlPlaceholders("SELECT $1::bigint, '$2::text'", ['42']), { sql: "SELECT ?, '$2::text'", values: ['42'] })
})

test('MySQL adapter converts idempotent inserts and upserts', () => {
  assert.deepEqual(mysqlPlaceholders('INSERT INTO t_demo(id,value) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [1, 'x']), {
    sql: 'INSERT IGNORE INTO t_demo(id,value) VALUES(?,?)', values: [1, 'x'],
  })
  assert.deepEqual(mysqlPlaceholders('INSERT INTO t_demo(id,value) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,updated_at=now()', [1, 'x']), {
    sql: 'INSERT INTO t_demo(id,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=now()', values: [1, 'x'],
  })
})

test('MySQL adapter extracts supported RETURNING clauses and leaves WHERE bindings reusable', () => {
  const bound = mysqlPlaceholders('UPDATE t_demo SET value=$2 WHERE id=$1 RETURNING id', ['record-1', 'new'])
  assert.deepEqual(bound, {
    sql: 'UPDATE t_demo SET value=? WHERE id=?',
    values: ['new', 'record-1'],
    returning: { kind: 'update', table: 't_demo', columns: 'id', where: 'id=$1' },
  })
})

test('MySQL adapter fails closed on CTE RETURNING forms that need a dialect-specific rewrite', () => {
  assert.throws(() => mysqlPlaceholders('WITH changed AS (UPDATE t SET x=1 RETURNING id) SELECT * FROM changed'), /mysql_returning_unsupported_statement/)
})

test('MySQL adapter duplicates bound values when PostgreSQL reuses a parameter', () => {
  assert.deepEqual(mysqlPlaceholders('SELECT $1,$1,$2', ['same','other']), { sql: 'SELECT ?,?,?', values: ['same','same','other'] })
})
