import { cloneProxyApi } from '../../server/cloneproxy-api.server'
import { handleCloneProxyTokenUpdate } from '../../server/cloneproxy-token-intake.server'
import { syncCloneProxyRevenue } from '../../server/cloneproxy-revenue.server'
import { appendCloneProxyButton, handleTelegramCloneProxyUpdate, telegramCloneProxyClaimPredicate } from '../../server/telegram-cloneproxy-onboarding.server'
import { manifest } from '@tgbotpress/plugin-cloneproxy'

/** Built-in plugin: preserves the existing data and handler contracts. */
export const cloneProxyPlugin = {
  id: 'cloneproxy',
  version: 1,
  manifest,
  admin: { api: cloneProxyApi },
  telegram: { handleToken: handleCloneProxyTokenUpdate, handleUpdate: handleTelegramCloneProxyUpdate, claimPredicate: telegramCloneProxyClaimPredicate, appendButton: appendCloneProxyButton },
  jobs: { revenue: { name: 'synctelegramcloneproxyrevenue', intervalMs: 10_000, run: syncCloneProxyRevenue } },
} as const
