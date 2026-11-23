import type { DatabaseConnection as Pool } from './host-types.js';
type Database = Pick<Pool, 'query' | 'connect'>;
type Queryable = Pick<Pool, 'query'>;
type CallbackQuery = {
    id?: string | number;
    data?: string;
    from?: {
        id?: string | number;
        username?: string;
        is_bot?: boolean;
    };
    message?: Record<string, any>;
};
type Message = Record<string, any> & {
    message_id: string | number;
    chat: {
        id: string | number;
        type: string;
    };
    from?: {
        id?: string | number;
        username?: string;
        first_name?: string;
        last_name?: string;
        is_bot?: boolean;
    };
    text?: string;
};
type Update = {
    message?: Message;
    callback_query?: CallbackQuery;
};
export type PremiumTelegramDatabase = Database;
export type PremiumTelegramMessage = Message;
export type PremiumTelegramUpdate = Update;
export declare const premiumPackageCallbackClaimPredicate: string;
export declare const premiumUsernameReplyClaimPredicate: string;
export declare function isPremiumUsernameReplyCandidate(update: Update): boolean;
export declare function isPremiumUsernameReplyForPrompt(pool: Queryable, botRid: number, update: Update): Promise<boolean>;
export declare const premiumWalletPayClaimPredicate: string;
export declare const premiumCancelUnpaidClaimPredicate: string;
export declare const premiumChooseAgainClaimPredicate: string;
export declare function isPremiumCallbackUpdate(update: Update): boolean;
export declare function handleTelegramPremiumPackageCallback(pool: Queryable, fetcher: typeof fetch, botRid: number, update: Update): Promise<boolean>;
export declare function handleTelegramPremiumUsernameReply(pool: Database, fetcher: typeof fetch, botRid: number, updateRid: number, message: Message): Promise<boolean>;
export declare function handlePremiumWalletPayCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update): Promise<boolean>;
export declare function handlePremiumCancelUnpaidCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update): Promise<boolean>;
export declare function handlePremiumChooseAgainCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update): Promise<boolean>;
export declare function handlePremiumTelegramCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update): Promise<boolean>;
export {};
