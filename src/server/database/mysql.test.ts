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
