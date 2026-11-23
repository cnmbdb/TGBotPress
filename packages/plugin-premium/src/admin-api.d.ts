import type { DatabaseConnection } from './host-types.js';
export type PremiumAdminIdentity = {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    routes: string[];
};
export type PremiumAdminHost = {
    db: Pick<DatabaseConnection, 'query' | 'connect'>;
    identity: (request: Request) => Promise<PremiumAdminIdentity>;
    can: (user: PremiumAdminIdentity, permission: string, route: string) => boolean;
    run: (handler: () => Promise<Response>) => Promise<Response>;
    telegramActionsEnabled: () => boolean;
    platformOrigin: () => string | undefined;
    encryptPlatformSecret: (value: string) => string;
    parsePackageBody: (request: Request) => Promise<{
        body: unknown;
        upload?: File;
    }>;
    savePackageImage: (file: File) => Promise<{
        url: string;
        remove: () => Promise<void>;
    }>;
    serviceErrorResponse: (error: unknown) => Response | null;
};
export declare function createPremiumOrderApi(host: PremiumAdminHost): (request: Request) => Promise<Response>;
export declare function createPremiumTradeApi(host: PremiumAdminHost): (request: Request) => Promise<Response>;
export declare function createPremiumPlatformApi(host: PremiumAdminHost): (request: Request) => Promise<Response>;
export declare function createPremiumPackagesApi(host: PremiumAdminHost): (request: Request) => Promise<Response>;
