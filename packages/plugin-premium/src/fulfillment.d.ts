import type { DatabaseConnection } from './host-types.js';
export type PremiumFulfillmentDatabase = Pick<DatabaseConnection, 'query' | 'connect'>;
export type PremiumFulfillmentLogger = Pick<Console, 'info' | 'error'>;
export type PremiumRunPayment = (amount: string, ref: string, months: number, mnemonic: string) => Promise<string>;
export type PremiumFulfillmentOptions = {
    pool: PremiumFulfillmentDatabase;
    decryptSecret: (value: string | null) => string;
    runPayment: PremiumRunPayment;
    preflight: (mnemonic: string) => Promise<boolean>;
    fetcher?: typeof fetch;
    logger?: PremiumFulfillmentLogger;
    shouldContinue?: () => boolean;
    enabled?: boolean;
    allowTelegramStars?: boolean;
    batchSize?: number;
};
export declare function syncPremiumFulfillment(options: PremiumFulfillmentOptions): Promise<{
    skipped: boolean;
    scanned: number;
    matched: number;
    succeeded: number;
    failed: number;
    manual: number;
}>;
