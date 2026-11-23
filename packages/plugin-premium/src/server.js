import { createPremiumOrderApi, createPremiumPackagesApi, createPremiumPlatformApi, createPremiumTradeApi } from './admin-api.js';
import { handlePremiumTelegramCallback, handleTelegramPremiumUsernameReply, isPremiumCallbackUpdate, isPremiumUsernameReplyCandidate, isPremiumUsernameReplyForPrompt, premiumCancelUnpaidClaimPredicate, premiumChooseAgainClaimPredicate, premiumPackageCallbackClaimPredicate, premiumUsernameReplyClaimPredicate, premiumWalletPayClaimPredicate } from './purchases.js';
import { createPremiumScheduledTasks } from './tasks.js';
import { manifest } from './index.js';
export function createPremiumModuleRuntime(options) {
    return {
        manifest,
        api: {
            platforms: createPremiumPlatformApi(options.adminHost),
            packages: createPremiumPackagesApi(options.adminHost),
            orders: createPremiumOrderApi(options.adminHost),
            trades: createPremiumTradeApi(options.adminHost),
        },
        createTasks(pool, logger) {
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
            });
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
            isUsernameReplyForPrompt: (pool, botRid, update) => isPremiumUsernameReplyForPrompt(pool, botRid, update),
            handleCallback: (pool, fetcher, botRid, update) => handlePremiumTelegramCallback(pool, fetcher, botRid, update),
            handleUsernameReply: (pool, fetcher, botRid, updateRid, message) => handleTelegramPremiumUsernameReply(pool, fetcher, botRid, updateRid, message),
        },
    };
}
