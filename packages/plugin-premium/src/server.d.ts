import type { DatabaseConnection } from './host-types.js';
import { type PremiumAdminHost } from './admin-api.js';
import { isPremiumCallbackUpdate, isPremiumUsernameReplyCandidate, type PremiumTelegramMessage, type PremiumTelegramUpdate } from './purchases.js';
import { type PremiumScheduledTaskOptions } from './tasks.js';
export type PremiumModuleDatabase = Pick<DatabaseConnection, 'query' | 'connect'>;
export type PremiumModuleRuntimeOptions = {
    adminHost: PremiumAdminHost;
    fetcher?: typeof fetch;
    getWalletApiKeys: (pool: PremiumModuleDatabase) => Promise<string[]>;
    decryptSecret: PremiumScheduledTaskOptions['decryptSecret'];
    runPayment: PremiumScheduledTaskOptions['runPayment'];
    preflight: PremiumScheduledTaskOptions['preflight'];
    walletPollingEnabled?: boolean;
    telegramActionsEnabled?: boolean;
    fulfillmentEnabled?: boolean;
    allowTelegramStars?: boolean;
};
export declare function createPremiumModuleRuntime(options: PremiumModuleRuntimeOptions): {
    manifest: import("./index.js").PremiumPluginManifest;
    api: {
        platforms: (request: Request) => Promise<Response>;
        packages: (request: Request) => Promise<Response>;
        orders: (request: Request) => Promise<Response>;
        trades: (request: Request) => Promise<Response>;
    };
    createTasks(pool: PremiumModuleDatabase, logger?: PremiumScheduledTaskOptions['logger']): import("./tasks.js").PremiumScheduledTask[];
    telegram: {
        claimPredicates: {
            package: string;
            walletPay: string;
            cancelUnpaid: string;
            chooseAgain: string;
            usernameReply: string;
        };
        isCallbackUpdate: typeof isPremiumCallbackUpdate;
        isUsernameReplyCandidate: typeof isPremiumUsernameReplyCandidate;
        isUsernameReplyForPrompt: (pool: Pick<PremiumModuleDatabase, 'query'>, botRid: number, update: PremiumTelegramUpdate) => Promise<boolean>;
        handleCallback: (pool: PremiumModuleDatabase, fetcher: typeof fetch, botRid: number, update: PremiumTelegramUpdate) => Promise<boolean>;
        handleUsernameReply: (pool: PremiumModuleDatabase, fetcher: typeof fetch, botRid: number, updateRid: number, message: PremiumTelegramMessage) => Promise<boolean>;
    };
};
