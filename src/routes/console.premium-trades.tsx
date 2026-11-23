import { createFileRoute } from '@tanstack/react-router'
import { PremiumAdminProvider, PremiumTradesPage } from '@tgbotpress/plugin-premium/admin-pages'
import { premiumAdminRuntime } from '@/lib/premium-admin-runtime'

function PremiumTradesRoute() {
  return <PremiumAdminProvider runtime={premiumAdminRuntime}><PremiumTradesPage /></PremiumAdminProvider>
}

export const Route = createFileRoute('/console/premium-trades')({ component: PremiumTradesRoute })
