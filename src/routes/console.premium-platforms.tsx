import { createFileRoute } from '@tanstack/react-router'
import { PremiumAdminProvider, PremiumPlatformsPage } from '@tgbotpress/plugin-premium/admin-pages'
import { premiumAdminRuntime } from '@/lib/premium-admin-runtime'

function PremiumPlatformsRoute() {
  return <PremiumAdminProvider runtime={premiumAdminRuntime}><PremiumPlatformsPage /></PremiumAdminProvider>
}

export const Route = createFileRoute('/console/premium-platforms')({ component: PremiumPlatformsRoute })
