import { createFileRoute } from '@tanstack/react-router'
import { MonitorWalletsPage } from '@/components/monitor-wallets-page'
export const Route = createFileRoute('/console/monitor-wallets')({ component: MonitorWalletsPage })
