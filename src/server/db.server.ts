import pg from 'pg'
import type { DatabaseClient, DatabaseConnection, DatabaseResult, DatabaseRow } from './database.types'
class PgClient implements DatabaseClient {
  constructor(private readonly client: pg.PoolClient) {}
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values?: any[]): Promise<DatabaseResult<Row>> {
    return await this.client.query(sql, values) as unknown as DatabaseResult<Row>
  }
  release() { this.client.release() }
}
class PgConnection implements DatabaseConnection {
  constructor(private readonly pool: pg.Pool) {}
  async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values?: any[]): Promise<DatabaseResult<Row>> {
    return await this.pool.query(sql, values) as unknown as DatabaseResult<Row>
  }
  async connect(): Promise<DatabaseClient> { return new PgClient(await this.pool.connect()) }
  async end(): Promise<void> { await this.pool.end() }
}
const globalDb = globalThis as typeof globalThis & { platformPool?: pg.Pool; platformDatabase?: DatabaseConnection }
const pool = globalDb.platformPool ?? new pg.Pool({
  host: process.env.PLATFORM_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432), database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
  options: '-c timezone=Asia/Shanghai', max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
})
if (process.env.NODE_ENV !== 'production') globalDb.platformPool = pool
export const db: DatabaseConnection = globalDb.platformDatabase ?? new PgConnection(pool)
if (process.env.NODE_ENV !== 'production') globalDb.platformDatabase = db
