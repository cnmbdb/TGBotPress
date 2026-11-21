import type { Pool, PoolClient } from 'pg';
type Update = Record<string, any>;
type PoolLike = Pick<Pool, 'query' | 'connect'>;
type Task = {
    rid: number;
    source_update_rid: number;
    bot_rid: number;
    update_body: Update;
    attempts: number;
};
type Host = {
    lockGroupsPlugin: (client: Pick<PoolClient, 'query'>) => Promise<void>;
    groupsPluginStatus: (pool: PoolLike) => Promise<{
        state: string;
    }>;
};
export declare function createGroupTasks(host: Host): {
    isGroupManagementUpdate: (body: Update) => boolean;
    enqueueGroupManagementUpdate: (client: Pick<PoolClient, 'query'>, sourceUpdateRid: number, botRid: number, body: Update) => Promise<boolean>;
    syncGroupManagementTasks: (options: {
        pool: PoolLike;
        logger?: Pick<Console, 'error'>;
        shouldContinue?: () => boolean;
        process: (task: Task) => Promise<void>;
        batchSize?: number;
    }) => Promise<{
        skipped: boolean;
        processed: number;
        failed: number;
    }>;
};
export type GroupPluginTask = Task;
export {};
