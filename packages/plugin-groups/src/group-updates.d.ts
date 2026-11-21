import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk';
export type GroupMessage = {
    chat: {
        id: number | string;
        type: string;
        username?: string;
    };
    message_id: number | string;
    date?: number;
    from?: {
        id?: number | string;
        is_bot?: boolean;
    };
    text?: string;
    caption?: string;
    new_chat_title?: string;
    reply_to_message?: GroupMessage;
};
export type GroupUpdatesHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    scanRecentGroupMessages: (...args: any[]) => Promise<any>;
    telegramCalculatorReply: (...args: any[]) => any;
    handleTelegramKeywordReply: (...args: any[]) => Promise<any>;
    handleTelegramExchangeRate: (...args: any[]) => Promise<any>;
    lookupTronApprovals: (...args: any[]) => Promise<any>;
    lookupTronAddress: (...args: any[]) => Promise<any>;
    DISABLED_SECRET_COMMAND_REPLY: string;
    isDisabledSensitiveTelegramCommand: (...args: any[]) => boolean;
};
export declare function createGroupUpdates(host: GroupUpdatesHost): {
    groupMessage: (update: {
        message?: GroupMessage;
        edited_message?: GroupMessage;
    }) => GroupMessage | null;
    processGroupManagementPluginUpdate: (options: {
        pool: Pick<Pool, "connect" | "query">;
        fetcher: typeof fetch;
        botRid: number;
        update: {
            message?: GroupMessage;
            edited_message?: GroupMessage;
        };
    }) => Promise<void>;
    syncTelegramGroupMessages: (options: {
        pool?: Pick<Pool, "connect" | "query">;
        fetcher?: typeof fetch;
        enabled?: boolean;
        shouldContinue?: () => boolean;
        logger?: Pick<Console, "error">;
        batchSize?: number;
    }) => Promise<{
        skipped: boolean;
        processed: number;
        failed: number;
        fatal?: undefined;
    } | {
        skipped: boolean;
        processed: number;
        failed: number;
        fatal: boolean;
    }>;
};
