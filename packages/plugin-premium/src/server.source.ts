import type { DatabaseConnection } from './host-types.js'
import { createPremiumOrderApi, createPremiumPackagesApi, createPremiumPlatformApi, createPremiumTradeApi, type PremiumAdminHost } from './admin-api.js'
import { handlePremiumTelegramCallback, handleTelegramPremiumUsernameReply, isPremiumCallbackUpdate, isPremiumUsernameReplyCandidate, isPremiumUsernameReplyForPrompt, premiumCancelUnpaidClaimPredicate, premiumChooseAgainClaimPredicate, premiumPackageCallbackClaimPredicate, premiumUsernameReplyClaimPredicate, premiumWalletPayClaimPredicate, type PremiumTelegramMessage, type PremiumTelegramUpdate } from './purchases.js'
import { createPremiumScheduledTasks, type PremiumScheduledTaskOptions } from './tasks.js'
import { manifest } from './index.js'

export type PremiumModuleDatabase = Pick<DatabaseConnection, 'query' | 'connect'>
export type PremiumModuleRuntimeOptions = {
  adminHost: PremiumAdminHost
  fetcher?: typeof fetch
  getWalletApiKeys: (pool: PremiumModuleDatabase) => Promise<string[]>
  decryptSecret: PremiumScheduledTaskOptions['decryptSecret']
  runPayment: PremiumScheduledTaskOptions['runPayment']
  preflight: PremiumScheduledTaskOptions['preflight']
  walletPollingEnabled?: boolean
  telegramActionsEnabled?: boolean
  fulfillmentEnabled?: boolean
  allowTelegramStars?: boolean
}

export function createPremiumModuleRuntime(options: PremiumModuleRuntimeOptions) {
  return {
    manifest,
    api: {
      platforms: createPremiumPlatformApi(options.adminHost),
      packages: createPremiumPackagesApi(options.adminHost),
      orders: createPremiumOrderApi(options.adminHost),
      trades: createPremiumTradeApi(options.adminHost),
    },
    createTasks(pool: PremiumModuleDatabase, logger?: PremiumScheduledTaskOptions['logger']) {
      return createPremiumScheduledTasks({
        pool,
        logger,
        fetcher: options.fetcher,
        getWalletApiKeys: () => options.getWalletApiKeys(pool),
        decryptSecret: options.decryptSecret,
        runPayment: options.runPayment,
        preflight: options.preflight,
        walletPollingEnabled: options.walletPollingEnabled,
        telegramActionsEnabled: options.telegramActionsEnabled,
        fulfillmentEnabled: options.fulfillmentEnabled,
        allowTelegramStars: options.allowTelegramStars,
      })
    },
    telegram: {
      claimPredicates: {
        package: premiumPackageCallbackClaimPredicate,
        walletPay: premiumWalletPayClaimPredicate,
        cancelUnpaid: premiumCancelUnpaidClaimPredicate,
        chooseAgain: premiumChooseAgainClaimPredicate,
        usernameReply: premiumUsernameReplyClaimPredicate,
      },
      isCallbackUpdate: isPremiumCallbackUpdate,
      isUsernameReplyCandidate: isPremiumUsernameReplyCandidate,
      isUsernameReplyForPrompt: (pool: Pick<PremiumModuleDatabase, 'query'>, botRid: number, update: PremiumTelegramUpdate) => isPremiumUsernameReplyForPrompt(pool, botRid, update),
      handleCallback: (pool: PremiumModuleDatabase, fetcher: typeof fetch, botRid: number, update: PremiumTelegramUpdate) => handlePremiumTelegramCallback(pool, fetcher, botRid, update),
      handleUsernameReply: (pool: PremiumModuleDatabase, fetcher: typeof fetch, botRid: number, updateRid: number, message: PremiumTelegramMessage) => handleTelegramPremiumUsernameReply(pool, fetcher, botRid, updateRid, message),
    },
  }
}
