import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { planPremiumNotices, sendPremiumTelegramNotifications as notifyPremiumCustomers } from '@tgbotpress/plugin-premium/notifications'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error' | 'info'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean }

export { planPremiumNotices }

export function sendPremiumTelegramNotifications(options: Options = {}) {
  return notifyPremiumCustomers({
    pool: options.pool ?? db,
    fetcher: options.fetcher,
    logger: options.logger,
    shouldContinue: options.shouldContinue,
    enabled: options.enabled ?? process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
  })
}
