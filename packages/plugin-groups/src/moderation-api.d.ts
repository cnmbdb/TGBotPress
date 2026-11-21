import type { Pool } from 'pg';
type Identity = {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    routes: string[];
};
type Host = {
    db: Pick<Pool, 'query' | 'connect'>;
    identity: (request: Request) => Promise<Identity>;
    can: (user: Identity, permission: string, route: string) => boolean;
    run: (handler: () => Promise<Response>) => Promise<Response>;
    scanRecentGroupMessages: (...args: any[]) => Promise<any>;
    telegramVerificationApi: (request: Request) => Promise<Response>;
    customGroupAdKeywords: (group: string, global: string) => string[];
};
export declare function createModerationApi(host: Host): (request: Request) => Promise<Response>;
export {};
