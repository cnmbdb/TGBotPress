import type { Pool } from 'pg';
export type VerificationHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    cookie: (name: string, value: string, maxAge: number) => string;
    cookies: (request: Request) => Record<string, string>;
    digest: (value: string) => string;
    equalTokens: (left: string, right: string) => boolean;
    isToken: (value: unknown) => value is string;
    sendVerifiedJoinNotification: (...args: any[]) => Promise<any>;
};
export declare function createVerificationApi(host: VerificationHost): (request: Request) => Promise<Response>;
