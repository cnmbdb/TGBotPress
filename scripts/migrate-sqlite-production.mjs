import bcrypt from 'bcryptjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const path=resolve(process.env.SQLITE_PATH || process.env.DB_DATABASE || './data/tgbotpress.sqlite')
mkdirSync(dirname(path),{recursive:true})
const db=new DatabaseSync(path)
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
const tables=db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n
try {
 if(!tables){
  const password=String(process.env.ADMIN_INITIAL_PASSWORD||'')
  if([...password.trim()].length<12||Buffer.byteLength(password,'utf8')>72)throw new Error('An empty database requires ADMIN_INITIAL_PASSWORD (12 to 72 UTF-8 bytes).')
  db.exec(readFileSync(new URL('../legacy/sqlite-000-legacy-schema.sql',import.meta.url),'utf8').replace(/^\s*--.*$/gm,''))
  const hash=await bcrypt.hash(password,12)
  db.prepare("INSERT INTO t_admin(id,name,password,status) VALUES(1,'trxadmin',?,1)").run(hash)
  const defaults=readFileSync(new URL('../legacy/000-legacy-defaults.sql',import.meta.url),'utf8').replaceAll('public.','').replace(/SELECT setval\([^;]+;\s*/gi,'')
  db.exec(defaults)
  const seed=JSON.parse(readFileSync(new URL('../legacy/telegram_templates.json',import.meta.url),'utf8'))
  for(const [table,rows] of Object.entries(seed))for(const row of rows){const columns=Object.keys(row);if(!/^[a-z][a-z0-9_]*$/i.test(table)||columns.some(c=>!/^[a-z][a-z0-9_]*$/i.test(c)))throw new Error('Invalid template seed identifier');db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]))}
  console.log('Initialized clean SQLite schema and initial administrator.')
 }
 db.exec('CREATE TABLE IF NOT EXISTS t_platform_schema_migration(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
 const applied=db.prepare('SELECT 1 FROM t_platform_schema_migration WHERE version=?')
 const record=db.prepare('INSERT INTO t_platform_schema_migration(version) VALUES(?)')
 const migrationPath=new URL('../migrations/sqlite/',import.meta.url)
 for(const file of readdirSync(migrationPath).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
  if(applied.get(file))continue
  db.exec(readFileSync(new URL(file,migrationPath),'utf8'))
  record.run(file)
  console.log(`Applied SQLite migration ${file}`)
 }
 const manual=readFileSync(new URL('../migrations/sqlite/MANUAL_PORTS.txt',import.meta.url),'utf8').trim()
 if(manual)console.warn(`SQLite manual migration ports remain: ${manual.replaceAll('\n',', ')}`)
 console.log('SQLite platform schema ready.')
} finally {db.close()}
