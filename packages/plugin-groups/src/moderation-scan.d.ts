import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk';
export type ScanHost = {
    db: Pick<Pool, 'query' | 'connect'>;
    startAdVerificationChallenge: (...args: any[]) => Promise<any>;
    effectiveGroupAdKeywords: (...args: any[]) => string[];
};
export declare function createModerationScan(host: ScanHost): {
    analyzeMessage: (m: Record<string, any>, keywords: string[], blockForwarded: boolean, threshold: number) => {
        isAd: boolean;
        score: number;
        reasons: string[];
        preview: string;
        highConfidence: boolean;
    };
    scanRecentGroupMessages: (options: {
        botRid: number;
        chatId: string;
        minutes?: number;
        messageId?: string;
        pool?: Pick<Pool, "connect" | "query">;
        fetcher?: typeof fetch;
        logger?: Pick<Console, "error" | "info">;
    }) => Promise<{
        skipped: boolean;
        scanned: number;
        processed: number;
        failed: number;
        challengeFallbacks: number;
    }>;
};
