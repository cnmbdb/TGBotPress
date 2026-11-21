import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useState } from 'react'
import css from '../styles.css?url'
import { LocaleProvider } from '@/components/locale-provider'
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'TG Ultra' }], links: [{ rel: 'stylesheet', href: css }] }),
  component: Root,
})
function Root() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchIntervalInBackground: false } } }))
  return <html lang="zh-CN"><head><HeadContent /></head><body><QueryClientProvider client={client}><LocaleProvider><Outlet />{import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}</LocaleProvider></QueryClientProvider><Scripts /></body></html>
}
