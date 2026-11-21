export declare function decodeTronAddress(hex: unknown): string | null
export declare function parseMonitorBlock(payload: unknown, expected?: number): { number: number; id: string; timestamp: number; transactions: Record<string, unknown>[] }
