import type { Pool, PoolClient } from 'pg';
export type CloneProxyTokenHost = {
    cloneBotConfiguration: (client: Pick<PoolClient, 'query'>, from: number, to: number, force: boolean) => Promise<unknown>;
    configuredWebhookOrigin: (values: {
        webUrl?: string;
        platformOrigin?: string;
        appUrl?: string;
    }) => string;
    configuredWebhookUrl: (base: string, rid: number) => string;
    webhookSecret: (rid: number, token: string, configuredKey: string, appKey: string) => string;
};
type Database = Pick<Pool, 'query' | 'connect'>;
type Update = {
    update_id?: unknown;
    message?: {
        text?: unknown;
        chat?: {
            id?: unknown;
            type?: unknown;
        };
        from?: {
            id?: unknown;
            username?: unknown;
            first_name?: unknown;
            last_name?: unknown;
            is_bot?: unknown;
        };
    };
};
type Dependencies = {
    services: CloneProxyTokenHost;
    pool: Database;
    masterBotRid: number;
    update: Update;
    fetcher?: typeof fetch;
    enabled?: boolean;
    appEnvironment?: string;
    webUrl?: string;
    webhookKey?: string;
    appKey?: string;
    shouldContinue?: () => boolean;
    inboxClaim?: {
        rid: number;
        owner: string;
    };
};
type IntakeResult = {
    handled: boolean;
    provisioned?: boolean;
    reason?: string;
};
export declare function handleCloneProxyTokenUpdate(options: Dependencies): Promise<IntakeResult>;
export {};
