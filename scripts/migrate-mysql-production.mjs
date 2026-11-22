import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import { readdir, readFile } from 'node:fs/promises'

const pool = mysql.createPool({
  host: process.env.PLATFORM_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306), database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
  waitForConnections: true, multipleStatements: true, connectionLimit: 4, charset: 'utf8mb4_0900_ai_ci', timezone: '+08:00',
})
const templates = ['t_telegram_bot','t_telegram_bot_command','t_telegram_bot_keyboard','t_telegram_bot_keyreply','t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad','t_telegram_bot_ad_keyboard']
try {
  const [tables] = await pool.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE()')
  if (Number(tables[0].count) === 0) {
    const password = String(process.env.ADMIN_INITIAL_PASSWORD || '')
    if ([...password.trim()].length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('An empty database requires ADMIN_INITIAL_PASSWORD (12 to 72 UTF-8 bytes).')
    await pool.query(await readFile(new URL('../legacy/mysql-000-legacy-schema.sql', import.meta.url), 'utf8'))
    const hash = await bcrypt.hash(password, 12)
    await pool.execute("INSERT INTO t_admin(id,name,password,status) VALUES(1,'trxadmin',?,1)", [hash])
    const defaults = (await readFile(new URL('../legacy/000-legacy-defaults.sql', import.meta.url), 'utf8')).replaceAll('public.', '').replaceAll('\\', '\\\\').replace(/SELECT setval\([^;]+;\s*/gi, '')
    await pool.query(defaults)
    const seed = JSON.parse(await readFile(new URL('../legacy/telegram_templates.json', import.meta.url), 'utf8'))
    for (const table of templates) for (const row of seed[table]) {
      const columns=Object.keys(row);const names=columns.map(x=>'`'+x+'`').join(',');const binds=columns.map(()=>'?').join(',')
      await pool.execute(`INSERT INTO ${table} (${names}) VALUES (${binds})`,columns.map(key=>row[key]))
    }
    console.log('Initialized clean MySQL schema and initial administrator.')
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS t_platform_schema_migration (
    version VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`)
  const files=(await readdir(new URL('../migrations/mysql/',import.meta.url))).filter(file=>/^\d+.*\.sql$/.test(file)).sort()
  for(const file of files) {
    const [applied]=await pool.execute('SELECT version FROM t_platform_schema_migration WHERE version=?',[file])
    if(applied.length) continue
    await pool.query(await readFile(new URL('../migrations/mysql/'+file,import.meta.url),'utf8'))
    await pool.execute('INSERT INTO t_platform_schema_migration(version) VALUES(?)',[file])
    console.log(`Applied MySQL migration ${file}`)
  }
  console.log('MySQL platform schema ready.')
} finally { await pool.end() }
