const legacySchemaTables = ['t_admin', 't_admin_device_session', 't_telegram_bot_user', 't_collection_wallet']
const schemaWaitMs = Math.max(1_000, Number(process.env.PLATFORM_LEGACY_SCHEMA_WAIT_MS || 120_000))
const schemaPollMs = Math.max(250, Number(process.env.PLATFORM_LEGACY_SCHEMA_POLL_MS || 2_000))

export async function waitForLegacySchema(database, { timeoutMs = schemaWaitMs, pollMs = schemaPollMs, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
 const startedAt = now()
 let lastMissing = legacySchemaTables
 while (now() - startedAt < timeoutMs) {
  const result = await database.query(`
   SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
   FROM unnest($1::text[]) AS required(name)
  `, [legacySchemaTables])
  lastMissing = result.rows.filter(row => !row.present).map(row => row.name)
  if (lastMissing.length === 0) return
  await sleep(Math.min(pollMs, Math.max(0, timeoutMs - (now() - startedAt))))
 }
 throw new Error(`Legacy database schema is not ready (missing: ${lastMissing.join(', ')}). Start the Admin container to initialize the legacy schema, then retry. No TanStack migrations were applied.`)
}
