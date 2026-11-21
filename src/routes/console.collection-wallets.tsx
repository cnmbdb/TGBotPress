import { createFileRoute } from '@tanstack/react-router'
import { CollectionWalletsPage } from '@/components/collection-wallets-page'
export const Route = createFileRoute('/console/collection-wallets')({ component: CollectionWalletsPage })
