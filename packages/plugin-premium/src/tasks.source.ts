import type { DatabaseConnection } from './host-types.js'
import { sendPremiumTelegramNotifications } from './notifications.js'
import { syncPremiumFulfillment, type PremiumRunPayment } from './fulfillment.js'
import { syncPremiumWalletUsdtTrades } from './wallet-poll.js'

type Database = Pick<DatabaseConnection, 'query' | 'connect'>
type Logger = Pick<Console, 'info' | 'error'>
export type PremiumScheduledTaskOptions = {
  pool: Database
  logger?: Logger
  fetcher?: typeof fetch
  getWalletApiKeys: () => Promise<string[]>
  decryptSecret: (value: string | null) => string
  runPayment: PremiumRunPayment
  preflight: (mnemonic: string) => Promise<boolean>
  walletPollingEnabled?: boolean
  telegramActionsEnabled?: boolean
  fulfillmentEnabled?: boolean
  allowTelegramStars?: boolean
}
export type PremiumScheduledTask = {
  name: 'premiumwalletusdttrade' | 'sendpremiumtgmessage' | 'tgpremium'
  intervalMs: number
  run: (shouldContinue: () => boolean) => Promise<unknown>
}

export function createPremiumScheduledTasks(options: PremiumScheduledTaskOptions): PremiumScheduledTask[] {
  const logger = options.logger ?? console
  return [
    {
      name: 'premiumwalletusdttrade',
      intervalMs: 2_000,
      run: async shouldContinue => syncPremiumWalletUsdtTrades({
        pool: options.pool,
        request: options.fetcher,
        logger,
        enabled: options.walletPollingEnabled,
        shouldContinue,
        apiKeys: await options.getWalletApiKeys(),
      }),
    },
    {
      name: 'sendpremiumtgmessage',
      intervalMs: 2_000,
      run: shouldContinue => sendPremiumTelegramNotifications({
        pool: options.pool,
        fetcher: options.fetcher,
        logger,
        shouldContinue,
        enabled: options.telegramActionsEnabled,
      }),
    },
    {
      name: 'tgpremium',
      intervalMs: 3_000,
      run: shouldContinue => syncPremiumFulfillment({
        pool: options.pool,
        decryptSecret: options.decryptSecret,
        runPayment: options.runPayment,
        preflight: options.preflight,
        fetcher: options.fetcher,
        logger,
        shouldContinue,
        enabled: options.fulfillmentEnabled,
        allowTelegramStars: options.allowTelegramStars,
      }),
    },
  ]
}
