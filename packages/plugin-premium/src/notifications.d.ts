import type { DatabaseConnection as Pool } from './host-types.js';
type Database = Pick<Pool, 'query' | 'connect'>;
type Logger = Pick<Console, 'error' | 'info'>;
type Row = {
    rid: number;
    buy_tg_uid: string | null;
    premium_tg_username: string;
    premium_package_month: number;
    comments: string | null;
    status?: number;
    fulfillment_method?: string;
    tg_notice_user: string;
    tg_notice_admin: string;
    tg_admin_uid: string | null;
    bot_token: string | null;
};
type Notice = {
    kind: 'user' | 'admin';
    chatId: string;
    text: string;
};
export declare function planPremiumNotices(row: Row): {
    userDone: boolean;
    adminDone: boolean;
    notices: Notice[];
};
export declare function sendPremiumTelegramNotifications(options: {
    pool: Database;
    fetcher?: typeof fetch;
    logger?: Logger;
    shouldContinue?: () => boolean;
    enabled?: boolean;
}): Promise<{
    skipped: boolean;
    scanned: number;
    sent: number;
    failed: number;
}>;
export {};
