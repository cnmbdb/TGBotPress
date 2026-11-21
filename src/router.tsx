import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
export function getRouter() { return createRouter({ routeTree, scrollRestoration: true, defaultPreload: 'intent', defaultPreloadStaleTime: 30_000, defaultPendingMs: 120, defaultPendingMinMs: 180 }) }
declare module '@tanstack/react-router' { interface Register { router: ReturnType<typeof getRouter> } }
