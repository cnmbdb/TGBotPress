import { createFileRoute } from '@tanstack/react-router'
import { MonitorBotsPage } from '@/components/monitor-bots-page'
export const Route = createFileRoute('/console/monitor-bots')({ component: MonitorBotsPage })
