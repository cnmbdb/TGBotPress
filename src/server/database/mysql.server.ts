import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise'
import type { DatabaseClient, DatabaseConnection, DatabaseResult, DatabaseRow } from '../database.types'

export type MysqlConfig = { host: string; port: number; database: string; user: string; password: string; connectionLimit?: number }

/** Convert PostgreSQL positional placeholders while preserving quoted strings and comments. */
export function mysqlPlaceholders(sql: string, values: unknown[] = []): { sql: string; values: unknown[] } {
  const arrayParameters = new Set<number>()
  sql = sql.replace(/\$(\d+)\s*=\s*ANY\((platform_plugin_config_targets\([^)]*\))\)/g, (_match, position, targets) => `JSON_CONTAINS(${targets},JSON_QUOTE(CAST($${position} AS CHAR)))`)
  sql = sql.replace(/([\w.`]+)\s*=\s*ANY\(\$(\d+)::(?:integer|bigint|text|varchar)\[\]\)/gi, (_match, column, position) => { arrayParameters.add(Number(position) - 1); return `${column} IN ($${position})` })
  sql = sql.replace(/enabled_bot_ids\s*=\s*'\{\}'/gi, 'enabled_bot_ids=JSON_ARRAY()')
  let output = '', mapped: unknown[] = [], index = 0, mode: 'normal'|'single'|'double'|'backtick'|'line'|'block' = 'normal'
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1]
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      output += c
      const end = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
      if (c === '\\' && i + 1 < sql.length) output += sql[++i]
      else if (c === end) {
        if (next === end) output += sql[++i]
        else mode = 'normal'
      }
      continue
    }
    if (mode === 'line') { output += c; if (c === '\n') mode = 'normal'; continue }
    if (mode === 'block') { output += c; if (c === '*' && next === '/') { output += sql[++i]; mode = 'normal' }; continue }
    if (c === "'") { mode = 'single'; output += c; continue }
    if (c === '"') { mode = 'double'; output += c; continue }
    if (c === ':' && next === ':') {
      let j = i + 2
      while (/[a-z0-9_]/i.test(sql[j] || '')) j++
      if (sql[j] === '(') { while (j < sql.length && sql[j] !== ')') j++; if (sql[j] === ')') j++ }
      if (sql[j] === '[' && sql[j + 1] === ']') j += 2
      if (j > i + 2) { i = j - 1; continue }
    }
    if (c === '`') { mode = 'backtick'; output += c; continue }
    if (c === '-' && next === '-') { mode = 'line'; output += c + next; i++; continue }
    if (c === '/' && next === '*') { mode = 'block'; output += c + next; i++; continue }
    if (c === '$' && /[1-9]/.test(next || '')) {
      let j = i + 1
      while (/[0-9]/.test(sql[j] || '')) j++
      const position = Number(sql.slice(i + 1, j)) - 1
      if (position >= values.length) throw new Error(`mysql_parameter_missing:${position + 1}`)
      output += '?'; mapped.push(Array.isArray(values[position]) && !arrayParameters.has(position) ? JSON.stringify(values[position]) : values[position]); i = j - 1; index++; continue
    }
    output += c
  }
  if (index !== values.length) throw new Error(`mysql_parameter_count_mismatch:${index}:${values.length}`)
  return { sql: output, values: mapped }
}

function result<Row extends DatabaseRow>(rows: Row[] | ResultSetHeader): DatabaseResult<Row> {
  if (Array.isArray(rows)) return { rows: rows as Row[], rowCount: rows.length }
  return { rows: [], rowCount: rows.affectedRows }
}

class MysqlClient implements DatabaseClient {
  constructor(private readonly connection: PoolConnection) {}
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values: any[] = []): Promise<DatabaseResult<Row>> {
    const bound = mysqlPlaceholders(sql, values)
    const [rows] = await this.connection.query(bound.sql, bound.values as any[])
    return result<Row>(rows as Row[] | ResultSetHeader)
  }
  async beginTransaction() { await this.connection.beginTransaction() }
  async commit() { await this.connection.commit() }
  async rollback() { await this.connection.rollback() }
  release() { this.connection.release() }
}

export class MysqlDatabase implements DatabaseConnection {
  private constructor(private readonly pool: Pool) {}
  static connect(config: MysqlConfig) {
    const pool = mysql.createPool({ ...config, waitForConnections: true, namedPlaceholders: false, timezone: '+08:00', decimalNumbers: false })
    return new MysqlDatabase(pool)
  }
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values: any[] = []): Promise<DatabaseResult<Row>> {
    const bound = mysqlPlaceholders(sql, values)
    const [rows] = await this.pool.query(bound.sql, bound.values as any[])
    return result<Row>(rows as Row[] | ResultSetHeader)
  }
  async connect(): Promise<DatabaseClient> { return new MysqlClient(await this.pool.getConnection()) }
  async end() { await this.pool.end() }
}
