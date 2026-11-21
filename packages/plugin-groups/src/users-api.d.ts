import type { Pool } from 'pg';
export type UsersIdentity = {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    routes: string[];
};
export type UsersApiHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    identity: (request: Request) => Promise<UsersIdentity>;
    can: (user: UsersIdentity, permission: string, route: string) => boolean;
    run: (handler: () => Promise<Response>) => Promise<Response>;
};
export declare function createUsersApi(host: UsersApiHost): (request: Request) => Promise<Response>;
