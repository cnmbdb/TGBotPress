import type { DatabaseClient as PoolClient } from '@tgbotpress/plugin-sdk';
type ChallengePolicy = {
    ad_verification_timeout_seconds: number;
};
type ChallengeMessage = {
    from?: {
        id?: number | string;
        username?: string;
        first_name?: string;
        last_name?: string;
    };
};
export declare function startAdVerificationChallenge(options: {
    client: PoolClient;
    fetcher?: typeof fetch;
    botRid: number;
    botToken: string;
    chatId: string;
    userId: string;
    message: ChallengeMessage;
    policy: ChallengePolicy;
}): Promise<boolean>;
export {};
