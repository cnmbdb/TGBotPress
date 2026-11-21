import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '@tgbotpress/plugin-sdk';
type Db = Pick<Pool, 'query' | 'connect'>;
export type GroupPluginState = 'active' | 'draining' | 'uninstalled';
export type GroupPluginAction = 'disable' | 'resume' | 'uninstall' | 'install';
export declare function lockGroupsPlugin(client: Pick<PoolClient, 'query'>): Promise<void>;
export declare function groupsPluginStatus(pool: Pick<Pool, 'query'>): Promise<{
    state: GroupPluginState;
    queue: {
        pending: number;
        paused: number;
        processing: number;
        failed: number;
    };
}>;
export declare function changeGroupsPlugin(pool: Db, action: GroupPluginAction): Promise<GroupPluginState>;
export {};
