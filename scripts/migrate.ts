import { config } from 'dotenv'
import { readdir, readFile } from 'node:fs/promises'
config({ path: '../.env', quiet: true })
const { db } = await import('../src/server/db.server')
try {
 const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()
 for (const file of files) await db.query(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'))
 const packageEntries = (await readdir(new URL('../packages/', import.meta.url), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-')).sort((a,b) => a.name.localeCompare(b.name))
 for (const entry of packageEntries) {
  const migrationDirectory = new URL(`../packages/${entry.name}/migrations/postgres/`, import.meta.url)
  let moduleFiles: string[]
  try { moduleFiles = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort() }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
  for (const file of moduleFiles) await db.query(await readFile(new URL(file, migrationDirectory), 'utf8'))
 }
 console.log('Platform schema ready (additive migrations only).')
} finally { await db.end() }
