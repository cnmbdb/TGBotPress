import type { Pool } from 'pg';
type Database = Pick<Pool, 'query' | 'connect'>;
type Msg = {
    chat?: {
        id?: unknown;
        type?: unknown;
    };
    from?: {
        id?: unknown;
        username?: unknown;
        is_bot?: unknown;
    };
    text?: unknown;
};
type Update = {
    update_id?: unknown;
    message?: Msg;
    callback_query?: {
        id?: unknown;
        data?: unknown;
        from?: Msg['from'];
        message?: Msg;
    };
};
export declare const CLONE_PROXY_BUTTON = "\u514B\u9686/\u4EE3\u7406";
export declare const telegramCloneProxyClaimPredicate: string;
export declare function appendCloneProxyButton(pool: Pick<Pool, 'query'>, botRid: number, chatType: unknown, markup: unknown): Promise<unknown>;
export declare function handleTelegramCloneProxyUpdate(options: {
    pool: Database;
    fetcher: typeof fetch;
    botRid: number;
    update: Update;
    shouldContinue?: () => boolean;
}): Promise<boolean>;
export {};
