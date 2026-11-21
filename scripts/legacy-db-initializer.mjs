import bcrypt from 'bcryptjs'
import { readFile } from 'node:fs/promises'

const templateTables = [
  't_telegram_bot',
  't_telegram_bot_command',
  't_telegram_bot_keyboard',
  't_telegram_bot_keyreply',
  't_telegram_bot_keyreply_keyboard',
  't_telegram_bot_ad',
  't_telegram_bot_ad_keyboard',
]

async function publicTableCount(client) {
  const result = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'")
  return Number(result.rows[0]?.count || 0)
}

async function seedTemplates(client) {
  const seedPath = new URL('../legacy/telegram_templates.json', import.meta.url)
  const seed = JSON.parse(await readFile(seedPath, 'utf8'))
  if (Object.keys(seed).join('|') !== templateTables.join('|')) {
    throw new Error('Telegram template seed table list does not match the expected schema.')
  }

  for (const table of templateTables) {
    const result = await client.query(`SELECT EXISTS (SELECT 1 FROM public.${table}) AS populated`)
    if (result.rows[0]?.populated) return false
  }

  for (const table of templateTables) {
    const rows = seed[table]
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Telegram template seed is empty: ${table}`)
    for (const row of rows) {
      const columns = Object.keys(row)
      if (!columns.length || columns.some(column => !/^[a-z][a-z0-9_]*$/i.test(column))) {
        throw new Error(`Invalid Telegram template columns: ${table}`)
      }
      const quotedColumns = columns.map(column => `"${column}"`).join(', ')
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
      await client.query(`INSERT INTO public.${table} (${quotedColumns}) VALUES (${placeholders})`, columns.map(column => row[column]))
    }
  }

  for (const table of templateTables) {
    const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [`public.${table}`, 'rid'])
    const name = sequence.rows[0]?.name
    if (name) await client.query('SELECT setval($1::regclass, (SELECT COALESCE(MAX(rid), 1) FROM public.' + table + '), true)', [name])
  }
  return true
}

export async function ensureEmptyTemplateTablesSeeded(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    try {
      await client.query('SELECT pg_advisory_xact_lock(73124851635)')
      const imported = await seedTemplates(client)
      await client.query('COMMIT')
      return imported
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  } finally {
    client.release()
  }
}

/**
 * Creates only the clean legacy schema and its non-secret defaults when the
 * public schema is empty. Existing and partially initialized databases are
 * left to the legacy Admin schema sync and are never replayed from a dump.
 */
export async function initializeEmptyLegacyDatabase(pool, { initialPassword = process.env.ADMIN_INITIAL_PASSWORD } = {}) {
  const client = await pool.connect()
  try {
    const existingCount = await publicTableCount(client)
    if (existingCount !== 0) return { initialized: false, reason: 'existing-schema' }

    const password = String(initialPassword || '')
    if (Array.from(password.trim()).length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('An empty database requires ADMIN_INITIAL_PASSWORD (12 to 72 UTF-8 bytes). No schema changes were applied.')
    }
    const passwordHash = await bcrypt.hash(password, 12)
    const schema = await readFile(new URL('../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
    const defaults = await readFile(new URL('../legacy/000-legacy-defaults.sql', import.meta.url), 'utf8')

    await client.query('BEGIN')
    try {
      await client.query('SELECT pg_advisory_xact_lock(73124851634)')
      const currentCount = await publicTableCount(client)
      if (currentCount !== 0) {
        await client.query('ROLLBACK')
        return { initialized: false, reason: 'concurrent-initialization' }
      }

      await client.query(schema)
      await client.query("INSERT INTO public.t_admin (id, name, password, status) VALUES (1, 'trxadmin', $1, 1)", [passwordHash])
      await client.query("SELECT setval('public.t_admin_id_seq', 1, true)")
      await client.query(defaults)
      const templatesImported = await seedTemplates(client)
      await client.query('COMMIT')
      return { initialized: true, templatesImported }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  } finally {
    client.release()
  }
}
