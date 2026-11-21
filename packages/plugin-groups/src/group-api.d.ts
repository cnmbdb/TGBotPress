import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk';
export type GroupIdentity = {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    routes: string[];
};
export type GroupApiHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    identity: (request: Request) => Promise<GroupIdentity>;
    can: (user: GroupIdentity, permission: string, route: string) => boolean;
    run: (handler: () => Promise<Response>) => Promise<Response>;
};
export declare function createGroupApi(host: GroupApiHost): (request: Request) => Promise<Response>;
