import { createFileRoute } from '@tanstack/react-router'
import { PremiumAdminProvider, PremiumPackagesPage } from '@tgbotpress/plugin-premium/admin-pages'
import { premiumAdminRuntime } from '@/lib/premium-admin-runtime'

function PremiumPackagesRoute() {
  return <PremiumAdminProvider runtime={premiumAdminRuntime}><PremiumPackagesPage /></PremiumAdminProvider>
}

export const Route = createFileRoute('/console/premium-packages')({ component: PremiumPackagesRoute })
