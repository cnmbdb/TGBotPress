import { cloneBotConfiguration, configuredWebhookOrigin, configuredWebhookUrl, webhookSecret } from './bot-service.server'
import { handleCloneProxyTokenUpdate as runCloneProxyTokenUpdate } from '@tgbotpress/plugin-cloneproxy/token-intake.js'

const services = { cloneBotConfiguration, configuredWebhookOrigin, configuredWebhookUrl, webhookSecret }

/** Preserve the host entry point while supplying the plugin's explicit host capabilities. */
export function handleCloneProxyTokenUpdate(options: Omit<Parameters<typeof runCloneProxyTokenUpdate>[0], 'services'>) {
  return runCloneProxyTokenUpdate({ ...options, services })
}
