import type { DatabaseConnection as Pool } from './host-types.js';
type Database = Pick<Pool, 'query' | 'connect'>;
type Logger = Pick<Console, 'error'>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type PremiumWalletPollOptions = {
    pool: Database;
    request?: Fetcher;
    logger?: Logger;
    enabled?: boolean;
    shouldContinue?: () => boolean;
    now?: () => Date;
    apiKeys?: string[];
};
export declare function premiumWalletStartTimestamp(latest: string | null, saved: Date | string | null): string;
export declare function premiumWalletConfigKeys(value: unknown): string[];
export declare function syncPremiumWalletUsdtTrades(options: PremiumWalletPollOptions): Promise<{
    wallets: number;
    inserted: number;
    skipped: boolean;
}>;
export {};
