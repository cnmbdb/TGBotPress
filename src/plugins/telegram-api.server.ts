import type { DatabaseConnection as Pool } from '../server/database.types'
import type { PluginTelegramApi } from '@tgbotpress/plugin-sdk'

type Db = Pick<Pool, 'query'>
type Fetcher = typeof fetch
const methodPattern = /^[A-Za-z][A-Za-z0-9]{0,63}$/u
const blockedMethods = new Set(['getUpdates', 'setWebhook', 'deleteWebhook', 'logOut', 'close'])
const maxPayloadBytes = 1_000_000

export function createPluginTelegramApi(pool: Db, pluginId: string, fetcher: Fetcher = fetch): PluginTelegramApi {
  return {
    async call(botId, method, payload = {}) {
      if (!Number.isSafeInteger(botId) || botId < 1) throw new Error('plugin_telegram_bot_id_invalid')
      if (!methodPattern.test(method) || blockedMethods.has(method)) throw new Error('plugin_telegram_method_invalid')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('plugin_telegram_payload_invalid')
      const body = JSON.stringify(payload)
      if (Buffer.byteLength(body) > maxPayloadBytes) throw new Error('plugin_telegram_payload_too_large')
      const result = await pool.query<{ bot_token: string | null }>(`SELECT b.bot_token FROM t_telegram_bot b
        JOIN t_platform_plugin_lifecycle l ON l.plugin_id=$2 AND l.state='active'
        JOIN t_platform_plugin_instance x ON x.plugin_id=$2 AND x.bot_id=b.rid AND x.state='active'
        WHERE b.rid=$1 AND COALESCE(b.bot_token,'')<>''`, [botId, pluginId])
      const token = result.rows[0]?.bot_token
      if (!token) throw new Error('plugin_telegram_bot_unavailable')
      let response: Response
      try {
        response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        })
      } catch { throw new Error('plugin_telegram_api_request_failed') }
      if (!response.ok) throw new Error('plugin_telegram_api_http_' + response.status)
      try { return await response.json() as unknown } catch { throw new Error('plugin_telegram_api_response_invalid') }
    },
  }
}
