import { readFileSync } from 'node:fs'
import { db } from '../src/server/db.server.js'
await db.query(readFileSync(new URL('../migrations/028-plugin-telegram-config-links.sql', import.meta.url), 'utf8'))
console.log('migration 028 applied')
await db.end()
