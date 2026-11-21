import type { Pool } from 'pg'
import { db } from './db.server'
import type { SchedulerLogger } from './scheduler.server'
import { syncCloneProxyRevenue as runCloneProxyRevenue } from '@tgbotpress/plugin-cloneproxy/settlement.js'

export { cloneProxyRevenueCommission } from '@tgbotpress/plugin-cloneproxy/revenue.js'
export type { CloneProxyRevenueResult } from '@tgbotpress/plugin-cloneproxy/settlement.js'

export function syncCloneProxyRevenue(
  pool: Pick<Pool, 'query' | 'connect'> = db,
  logger?: SchedulerLogger,
  shouldContinue?: () => boolean,
) {
  return runCloneProxyRevenue(pool, logger, shouldContinue)
}
