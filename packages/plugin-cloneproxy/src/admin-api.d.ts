import type { Pool, PoolClient } from 'pg';
export type CloneProxyIdentity = {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    routes: string[];
};
type LifecycleState = 'active' | 'draining' | 'uninstalled';
type LifecycleAction = 'disable' | 'resume' | 'uninstall' | 'install';
export type CloneProxyApiHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    identity: (request: Request) => Promise<CloneProxyIdentity>;
    can: (user: CloneProxyIdentity, permission: string, route: string) => boolean;
    run: (handler: () => Promise<Response>) => Promise<Response>;
    getCloneProxyLifecycle: (pool: Pick<Pool, 'query'>) => Promise<LifecycleState>;
    lockCloneProxyLifecycle: (client: PoolClient) => Promise<void>;
    transitionCloneProxyLifecycle: (client: PoolClient, action: LifecycleAction) => Promise<LifecycleState>;
};
/** Create a management API bound to host authentication, database and lifecycle services. */
export declare function createCloneProxyApi(services: CloneProxyApiHost): (req: Request) => Promise<Response>;
export {};
