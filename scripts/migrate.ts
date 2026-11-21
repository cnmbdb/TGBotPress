import { config } from 'dotenv'
import { readdir, readFile } from 'node:fs/promises'
config({ path: '../.env', quiet: true })
const { db } = await import('../src/server/db.server')
try {
 const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()
 for (const file of files) await db.query(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'))
 console.log('Platform schema ready (additive migrations only).')
} finally { await db.end() }
