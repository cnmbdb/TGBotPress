import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { premiumWalletConfigKeys, premiumWalletStartTimestamp, syncPremiumWalletUsdtTrades as pollPremiumWallet } from '@tgbotpress/plugin-premium/wallet-poll'

type Database = Pick<Pool, 'query' | 'connect'>
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; request?: Fetcher; logger?: Logger; enabled?: boolean; shouldContinue?: () => boolean; now?: () => Date }

export { premiumWalletStartTimestamp }

export async function premiumWalletApiKeys(pool: Database) {
  try {
    const result = await pool.query<{ config_val: unknown }>("SELECT config_val FROM t_sys_config WHERE config_key='trongrid_api_keys' ORDER BY rid")
    const keys = result.rows.flatMap(row => premiumWalletConfigKeys(row.config_val))
    if (keys.length) return keys
  } catch { /* use environment fallback like the existing host config */ }
  return String(process.env.TRONGRID_API_KEYS ?? process.env.TRONGRID_API_KEY ?? '')
    .split(/[\s,]+/).map(value => value.trim()).filter(Boolean)
}

export async function syncPremiumWalletUsdtTrades(options: Options = {}) {
  const pool = options.pool ?? db
  return pollPremiumWallet({
    pool,
    request: options.request,
    logger: options.logger,
    enabled: options.enabled ?? process.env.PLATFORM_PREMIUM_WALLET_POLLING === 'true',
    shouldContinue: options.shouldContinue,
    now: options.now,
    apiKeys: await premiumWalletApiKeys(pool),
  })
}
