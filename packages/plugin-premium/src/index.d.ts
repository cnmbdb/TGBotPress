import type { PluginManifest, TgbotpressPlugin } from './host-types.js'

export declare function priceUnits(value: unknown): bigint | null
export declare function priceText(units: bigint): string
export declare function telegramPremiumStarPrice(months: unknown): number | null
export declare const lifecycleBlockerSql: string
export type PremiumAdminMenuItem = { id: string; label: string; path: string; consolePath: string; permissions: string[] }
export type PremiumAdminMenu = { id: string; label: string; icon: string; items: PremiumAdminMenuItem[] }
export declare const adminMenu: PremiumAdminMenu
export type PremiumPluginManifest = PluginManifest & {
  id: 'premium'
  dependencies: []
  menuRoutes: string[]
  apiRoutes: string[]
  tasks: string[]
  drainTasks: string[]
  configTypes: NonNullable<PluginManifest['configTypes']>
  lifecycleBlockerSql: string
  adminMenu: PremiumAdminMenu
  automaticConfigLinks: {
    commands: Record<string, string[]>
    keyreplyOptions: Record<number, string[]>
  }
}
export declare const manifest: PremiumPluginManifest
export declare const plugin: TgbotpressPlugin & { manifest: PremiumPluginManifest }
