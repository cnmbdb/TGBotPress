export { cloneProxyRevenueCommission } from './revenue.js'
export type CloneProxyRevenueResult = {
  merchants: number; scanned: number; credited: number; duplicates: number; skipped: number; failed: number; stopped: boolean
}
export declare function syncCloneProxyRevenue(
  pool: { query: (...args: any[]) => Promise<any>; connect: () => Promise<any> },
  logger?: { info: (...args: any[]) => void; error: (...args: any[]) => void },
  shouldContinue?: () => boolean,
): Promise<CloneProxyRevenueResult>
