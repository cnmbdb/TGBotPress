import { sendPremiumTelegramNotifications } from './notifications.js';
import { syncPremiumFulfillment } from './fulfillment.js';
import { syncPremiumWalletUsdtTrades } from './wallet-poll.js';
export function createPremiumScheduledTasks(options) {
    const logger = options.logger ?? console;
    return [
        {
            name: 'premiumwalletusdttrade',
            intervalMs: 2_000,
            run: async (shouldContinue) => syncPremiumWalletUsdtTrades({
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
    ];
}
