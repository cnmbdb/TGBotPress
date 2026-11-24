import { timingSafeEqual } from 'node:crypto'
import { db } from './db.server'
import { webhookSecret } from './bot-service.server'
import { enqueueGroupManagementUpdate, isGroupManagementUpdate } from '../plugins/groups/tasks.server'
import { trustedRequestHostname } from './cloudflare-access.server'
import { activeThirdPartyTelegramUpdateTypes } from '../plugins/third-party-runtime.server'

type TelegramUpdate = { update_id: number; [key: string]: unknown }
type Queryable = Pick<typeof db, 'query'|'connect'> & { dialect?: 'postgres'|'mysql'|'sqlite'|'d1' }
type WebhookDependencies = {
  enabled: boolean
  getBotToken: (rid: number) => Promise<string | null>
  expectedSecret: (rid: number, token: string) => string
  getPluginUpdateTypes?: (rid: number) => Promise<string[]>
  persist: (rid: number, update: TelegramUpdate, ignored?: boolean) => Promise<'inserted' | 'duplicate' | 'conflict'>
}

const MAX_BODY_BYTES = 1_048_576

const defaultDependencies = (pool: Queryable = db): WebhookDependencies => ({
  // Keep intake disabled until the full Telegram update dispatcher has been migrated.
  enabled: process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true',
  getBotToken: async (rid) => {
    const result = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [rid])
    return result.rows[0]?.bot_token || null
  },
  expectedSecret: (rid, token) => webhookSecret(rid, token, process.env.TELEGRAM_WEBHOOK_SECRET_KEY || '', process.env.APP_KEY || ''),
  getPluginUpdateTypes: async (rid) => activeThirdPartyTelegramUpdateTypes(pool,rid),
  persist: async (rid, update, ignored = false) => {
    const payload = JSON.stringify(update)
    const inserted = await pool.query<{rid:number}>(
      "INSERT INTO t_platform_telegram_update(bot_rid,update_id,update_body,status) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(bot_rid,update_id) DO NOTHING RETURNING rid",
      [rid, String(update.update_id), payload, ignored ? 'ignored' : 'pending'],
    )
    let inboxRid = Number(inserted.rows[0]?.rid)
    let outcome: 'inserted'|'duplicate'|'conflict' = 'inserted'
    if (!inserted.rowCount) {
      const existing = await pool.query<{rid:number;same_payload:boolean}>(
      'SELECT rid,update_body=$3::jsonb AS same_payload FROM t_platform_telegram_update WHERE bot_rid=$1 AND update_id=$2',
      [rid, String(update.update_id), payload],
    )
      if (!existing.rowCount) throw new Error('duplicate Telegram update disappeared')
      if (!existing.rows[0].same_payload) return 'conflict'
      inboxRid = Number(existing.rows[0].rid)
      outcome = 'duplicate'
    }
    if (!ignored && isGroupManagementUpdate(update)) {
      const client = await pool.connect()
      try { await client.query('BEGIN'); await enqueueGroupManagementUpdate(client,inboxRid,rid,update); await client.query('COMMIT') }
      catch(error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    }
    return outcome
  },
})

function json(status: number, body: Record<string, unknown>, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers })
}

function validSecret(expected: string, received: string) {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const receivedBytes = Buffer.from(received, 'utf8')
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

export async function telegramWebhookApi(request: Request, dependencies: WebhookDependencies = defaultDependencies()) {
  if (request.method !== 'POST') return json(405, { ok: false }, { Allow: 'POST' })
  const expectedHost = (process.env.PLATFORM_WEBHOOK_HOST || '').trim().toLowerCase()
  if (expectedHost && trustedRequestHostname(request) !== expectedHost) return json(421, { ok: false })
  if (!dependencies.enabled) return json(503, { ok: false })
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json(415, { ok: false })
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) return json(413, { ok: false })

  const url = new URL(request.url)
  const ridText = url.searchParams.get('rid') || ''
  if (!/^\d{1,10}$/.test(ridText) || Number(ridText) < 1) return json(400, { ok: false })
  const rid = Number(ridText)
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') || ''
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(receivedSecret)) return json(403, { ok: false })

  try {
    const token = await dependencies.getBotToken(rid)
    if (!token || !validSecret(dependencies.expectedSecret(rid, token), receivedSecret)) return json(403, { ok: false })
  } catch {
    return json(503, { ok: false })
  }

  let rawBody: string
  try { rawBody = await request.text() } catch { return json(400, { ok: false }) }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json(413, { ok: false })
  let parsed: unknown
  try { parsed = JSON.parse(rawBody) } catch { return json(400, { ok: false }) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { ok: false })
  const update = parsed as Partial<TelegramUpdate>
  if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0) return json(400, { ok: false })

  try {
    const pluginUpdateTypes=await dependencies.getPluginUpdateTypes?.(rid)??[]
    const supportedUpdate = ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request', ...pluginUpdateTypes].some(field => field in update)
    const result = await dependencies.persist(rid, update as TelegramUpdate, !supportedUpdate)
    if (result === 'conflict') return json(409, { ok: false })
    const response = { ok: true, duplicate: result === 'duplicate' }
    return json(200, supportedUpdate ? response : { ...response, ignored: true })
  } catch {
    // Never log request bodies, bot tokens, or webhook secrets.
    return json(503, { ok: false })
  }
}
