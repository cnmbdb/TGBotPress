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
};
export declare function createApi(host: Host): (request: Request) => Promise<Response>;
export {};
