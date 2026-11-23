import { createPremiumPlatformApi } from '@tgbotpress/plugin-premium/admin-api'
import { premiumPluginHost } from './premium-plugin-host.server'

export const premiumPlatformApi = createPremiumPlatformApi(premiumPluginHost)
