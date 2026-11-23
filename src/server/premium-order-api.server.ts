import { createPremiumOrderApi } from '@tgbotpress/plugin-premium/admin-api'
import { premiumPluginHost } from './premium-plugin-host.server'

export const premiumOrderApi = createPremiumOrderApi(premiumPluginHost)
