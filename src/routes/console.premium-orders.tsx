import { createFileRoute } from '@tanstack/react-router'
import { PremiumAdminProvider, PremiumOrdersPage } from '@tgbotpress/plugin-premium/admin-pages'
import { premiumAdminRuntime } from '@/lib/premium-admin-runtime'

function PremiumOrdersRoute() {
  return <PremiumAdminProvider runtime={premiumAdminRuntime}><PremiumOrdersPage /></PremiumAdminProvider>
}

export const Route = createFileRoute('/console/premium-orders')({ component: PremiumOrdersRoute })
