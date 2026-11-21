import pg from 'pg'
const globalDb = globalThis as typeof globalThis & { platformPool?: pg.Pool }
export const db = globalDb.platformPool ?? new pg.Pool({
  host: process.env.PLATFORM_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432), database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
  options: '-c timezone=Asia/Shanghai',
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
})
if (process.env.NODE_ENV !== 'production') globalDb.platformPool = db
