import type { DatabaseConnection } from './host-types.js';
import { type PremiumRunPayment } from './fulfillment.js';
type Database = Pick<DatabaseConnection, 'query' | 'connect'>;
type Logger = Pick<Console, 'info' | 'error'>;
export type PremiumScheduledTaskOptions = {
    pool: Database;
    logger?: Logger;
    fetcher?: typeof fetch;
    getWalletApiKeys: () => Promise<string[]>;
    decryptSecret: (value: string | null) => string;
    runPayment: PremiumRunPayment;
    preflight: (mnemonic: string) => Promise<boolean>;
    walletPollingEnabled?: boolean;
    telegramActionsEnabled?: boolean;
    fulfillmentEnabled?: boolean;
    allowTelegramStars?: boolean;
};
export type PremiumScheduledTask = {
    name: 'premiumwalletusdttrade' | 'sendpremiumtgmessage' | 'tgpremium';
    intervalMs: number;
    run: (shouldContinue: () => boolean) => Promise<unknown>;
};
export declare function createPremiumScheduledTasks(options: PremiumScheduledTaskOptions): PremiumScheduledTask[];
export {};
