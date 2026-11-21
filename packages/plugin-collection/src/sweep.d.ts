export type CollectionCoin = 'trx' | 'usdt'
export type CollectionSweepPlan = { coin: CollectionCoin; amount: bigint }
export declare function collectionWalletSweepPlan(input: { coin: CollectionCoin; balance: string; threshold: string; reserve: string }): CollectionSweepPlan | null

export declare function decimalUnits(value: unknown, decimals?: number): bigint
export declare function formatUnits(value: bigint): string
export declare function amountPlan(coin: CollectionCoin, balance: bigint, threshold: bigint, reserve: bigint): CollectionSweepPlan | null
