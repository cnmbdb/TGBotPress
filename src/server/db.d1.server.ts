import { env } from 'cloudflare:workers'
import { D1Database } from './database/d1.server'
import type { D1Binding } from './database/d1.server'

export const db = new D1Database(env.DB as unknown as D1Binding)
