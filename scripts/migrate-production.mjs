import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { waitForLegacySchema } from './migration-readiness.mjs'
import { ensureEmptyTemplateTablesSeeded, initializeEmptyLegacyDatabase } from './legacy-db-initializer.mjs'
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_DATABASE, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, options: '-c timezone=Asia/Shanghai', max: 1 })
try {
 const initialized = await initializeEmptyLegacyDatabase(pool)
 if (initialized.initialized) console.log('Initialized clean legacy database schema and safe bootstrap records.')
 await waitForLegacySchema(pool)
 const templatesImported = await ensureEmptyTemplateTablesSeeded(pool)
 if (templatesImported && !initialized.initialized) console.log('Imported safe Telegram templates into empty legacy template tables.')
 const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()
 for (const file of files) await pool.query(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'))
 const packageEntries = (await readdir(new URL('../packages/', import.meta.url), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-')).sort((a,b) => a.name.localeCompare(b.name))
 for (const entry of packageEntries) {
  const migrationDirectory = new URL(`../packages/${entry.name}/migrations/postgres/`, import.meta.url)
  let moduleFiles
  try { moduleFiles = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort() }
  catch (error) { if (error?.code === 'ENOENT') continue; throw error }
  for (const file of moduleFiles) await pool.query(await readFile(new URL(file, migrationDirectory), 'utf8'))
 }
 console.log('Platform schema ready (additive migrations only).')
} finally { await pool.end() }
