import type { DatabaseConnection as Pool } from '../server/database.types'

const keyPattern = /^[A-Za-z0-9._:-]{1,128}$/u
const maxValueBytes = 1_000_000

export function pluginStorage(pool: Pick<Pool, 'query'>, pluginId: string, botId = 0) {
  const makeStorage = (scopeBotId: number) => {
    if (!Number.isSafeInteger(scopeBotId) || scopeBotId < 0) throw new Error('plugin_storage_bot_id_invalid')
  const assertBotScope = async () => {
    if(scopeBotId===0)return
    const result=await pool.query('SELECT 1 FROM t_platform_plugin_instance WHERE plugin_id=$1 AND bot_id=$2 AND state=\'active\'',[pluginId,scopeBotId])
    if(!result.rowCount)throw new Error('plugin_storage_bot_disabled')
  }
  const validateKey = (key: string) => {
    if (!keyPattern.test(key)) throw new Error('plugin_storage_key_invalid')
  }
  return {
    async get(key: string): Promise<unknown | null> {
      validateKey(key)
      await assertBotScope()
      const result = await pool.query<{ value_json: unknown }>('SELECT value_json FROM t_platform_plugin_storage WHERE plugin_id=$1 AND bot_id=$2 AND storage_key=$3', [pluginId,scopeBotId,key])
      return result.rows[0]?.value_json ?? null
    },
    async set(key: string, value: unknown) {
      validateKey(key)
      await assertBotScope()
      const json = JSON.stringify(value)
      if (json === undefined || Buffer.byteLength(json) > maxValueBytes) throw new Error('plugin_storage_value_invalid')
      await pool.query(`INSERT INTO t_platform_plugin_storage(plugin_id,bot_id,storage_key,value_json,updated_at)
        VALUES($1,$2,$3,$4::jsonb,now()) ON CONFLICT(plugin_id,bot_id,storage_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=now()`, [pluginId,scopeBotId,key,json])
    },
    async delete(key: string) {
      validateKey(key)
      await assertBotScope()
      await pool.query('DELETE FROM t_platform_plugin_storage WHERE plugin_id=$1 AND bot_id=$2 AND storage_key=$3', [pluginId,scopeBotId,key])
    },
  }
  }
  return { ...makeStorage(botId), forBot: (scopeBotId: number) => makeStorage(scopeBotId) }
}
