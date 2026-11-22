import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise'
import type { DatabaseClient, DatabaseConnection, DatabaseResult, DatabaseRow } from '../database.types'

export type MysqlConfig = { host: string; port: number; database: string; user: string; password: string; connectionLimit?: number }

/** Convert PostgreSQL positional placeholders while preserving quoted strings and comments. */
type ReturningPlan = { kind: 'insert'; table: string; columns: string } | { kind: 'update'|'delete'; table: string; columns: string; where: string }
type MysqlBound = { sql: string; values: unknown[]; returning?: ReturningPlan }
export function mysqlPlaceholders(sql: string, values: unknown[] = []): MysqlBound {
  let returning: ReturningPlan | undefined
  let match = /^\s*INSERT INTO ([\w.]+)[\s\S]*?\s+RETURNING\s+([\w.,\s]+)\s*;?\s*$/i.exec(sql)
  if (match) { returning = { kind: 'insert', table: match[1], columns: match[2].trim() }; sql = sql.slice(0, match.index + match[0].lastIndexOf(' RETURNING')).trim() }
  else {
    match = /^\s*(UPDATE|DELETE FROM) ([\w.]+)[\s\S]*?\s+WHERE ([\s\S]*?)\s+RETURNING\s+([\w.,\s]+)\s*;?\s*$/i.exec(sql)
    if (match) {
      const kind = match[1].toUpperCase() === 'UPDATE' ? 'update' : 'delete'
      returning = { kind, table: match[2], columns: match[4].trim(), where: match[3].trim() }
      sql = sql.slice(0, match.index + match[0].lastIndexOf(' RETURNING')).trim()
    }
  }
  if (/\bRETURNING\b/i.test(sql) && !returning) throw new Error('mysql_returning_unsupported_statement')
  sql = sql.replace(/\bILIKE\b/gi, 'LIKE').replace(/\bto_timestamp\(/gi, 'FROM_UNIXTIME(')
  const arrayParameters = new Set<number>()
  if (/\bON CONFLICT\b/i.test(sql)) {
    if (/\bDO NOTHING\s*;?$/i.test(sql)) {
      sql = sql.replace(/\bINSERT INTO\b/i, 'INSERT IGNORE INTO').replace(/\s+ON CONFLICT(?:\s*\([^)]*\))?\s+DO NOTHING\s*;?$/i, '')
    } else {
      sql = sql.replace(/\s+ON CONFLICT\s*\([^)]*\)\s+DO UPDATE SET\s+([\s\S]*?)\s*;?$/i, (_match, assignments) => ` ON DUPLICATE KEY UPDATE ${assignments.replace(/EXCLUDED\.([\w]+)/gi, 'VALUES($1)')}`)
    }
  }
  sql = sql.replace(/\$(\d+)\s*=\s*ANY\((platform_plugin_config_targets\([^)]*\))\)/g, (_match, position, targets) => `JSON_CONTAINS(${targets},JSON_QUOTE(CAST($${position} AS CHAR)))`)
  sql = sql.replace(/([\w.`]+)\s*=\s*ANY\(\$(\d+)::(?:integer|bigint|text|varchar)\[\]\)/gi, (_match, column, position) => { arrayParameters.add(Number(position) - 1); return `${column} IN ($${position})` })
  sql = sql.replace(/enabled_bot_ids\s*=\s*'\{\}'/gi, 'enabled_bot_ids=JSON_ARRAY()')
  let output = '', mapped: unknown[] = [], usedParameters = new Set<number>(), mode: 'normal'|'single'|'double'|'backtick'|'line'|'block' = 'normal'
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
      output += '?'; mapped.push(Array.isArray(values[position]) && !arrayParameters.has(position) ? JSON.stringify(values[position]) : values[position]); usedParameters.add(position); i = j - 1; continue
    }
    output += c
  }
  if (usedParameters.size !== values.length || values.some((_value, position) => !usedParameters.has(position))) throw new Error(`mysql_parameter_count_mismatch:${usedParameters.size}:${values.length}`)
  return returning ? { sql: output, values: mapped, returning } : { sql: output, values: mapped }
}

function whereBindings(where: string, values: unknown[]) {
  const bound: unknown[] = []
  const sql = where.replace(/\$(\d+)/g, (_match, position) => {
    const index = Number(position) - 1
    if (index < 0 || index >= values.length) throw new Error(`mysql_parameter_missing:${position}`)
    bound.push(values[index])
    return `$${bound.length}`
  })
  return { sql, values: bound }
}

function result<Row extends DatabaseRow>(rows: Row[] | ResultSetHeader): DatabaseResult<Row> {
  if (Array.isArray(rows)) return { rows: rows as Row[], rowCount: rows.length }
  return { rows: [], rowCount: rows.affectedRows }
}

class MysqlClient implements DatabaseClient {
  constructor(private readonly connection: PoolConnection) {}
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values: any[] = []): Promise<DatabaseResult<Row>> {
    const bound = mysqlPlaceholders(sql, values)
    const returning = bound.returning
    if (returning?.kind === 'delete') {
      const where = whereBindings(returning.where, values); const selected = await this.connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${mysqlPlaceholders(where.sql, where.values).sql}`, where.values as any[])
      await this.connection.query(bound.sql, bound.values as any[])
      return { rows: selected[0] as Row[], rowCount: (selected[0] as Row[]).length }
    }
    const [rows] = await this.connection.query(bound.sql, bound.values as any[])
    if (!returning) return result<Row>(rows as Row[] | ResultSetHeader)
    if (returning.kind === 'insert') {
      const header = rows as ResultSetHeader
      if (!header.insertId) return { rows: [], rowCount: header.affectedRows }
      const key = returning.columns.split(',')[0].trim()
      const selected = await this.connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${key}=?`, [header.insertId])
      return { rows: selected[0] as Row[], rowCount: header.affectedRows }
    }
    const where = whereBindings(returning.where, values); const selected = await this.connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${mysqlPlaceholders(where.sql, where.values).sql}`, where.values as any[])
    return { rows: selected[0] as Row[], rowCount: (rows as ResultSetHeader).affectedRows }
  }
  async beginTransaction() { await this.connection.beginTransaction() }
  async commit() { await this.connection.commit() }
  async rollback() { await this.connection.rollback() }
  release() { this.connection.release() }
}

export class MysqlDatabase implements DatabaseConnection {
  readonly dialect = 'mysql' as const
  private constructor(private readonly pool: Pool) {}
  static connect(config: MysqlConfig) {
    const pool = mysql.createPool({ ...config, waitForConnections: true, multipleStatements: true, namedPlaceholders: false, charset: 'utf8mb4_0900_ai_ci', timezone: '+08:00', decimalNumbers: false })
    return new MysqlDatabase(pool)
  }
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values: any[] = []): Promise<DatabaseResult<Row>> {
    const bound = mysqlPlaceholders(sql, values)
    const connection = await this.pool.getConnection()
    try {
      const returning = bound.returning
      if (returning?.kind === 'delete') {
        const where = whereBindings(returning.where, values); const selected = await connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${mysqlPlaceholders(where.sql, where.values).sql}`, where.values as any[])
        await connection.query(bound.sql, bound.values as any[])
        return { rows: selected[0] as Row[], rowCount: (selected[0] as Row[]).length }
      }
      const [rows] = await connection.query(bound.sql, bound.values as any[])
      if (!returning) return result<Row>(rows as Row[] | ResultSetHeader)
      if (returning.kind === 'insert') {
        const header = rows as ResultSetHeader
        if (!header.insertId) return { rows: [], rowCount: header.affectedRows }
        const key = returning.columns.split(',')[0].trim()
        const selected = await connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${key}=?`, [header.insertId])
        return { rows: selected[0] as Row[], rowCount: header.affectedRows }
      }
      const where = whereBindings(returning.where, values); const selected = await connection.query(`SELECT ${returning.columns} FROM ${returning.table} WHERE ${mysqlPlaceholders(where.sql, where.values).sql}`, where.values as any[])
      return { rows: selected[0] as Row[], rowCount: (rows as ResultSetHeader).affectedRows }
    } finally { connection.release() }
  }
  async connect(): Promise<DatabaseClient> { return new MysqlClient(await this.pool.getConnection()) }
  async end() { await this.pool.end() }
}
