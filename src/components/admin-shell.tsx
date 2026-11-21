import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { Bot, LayoutDashboard, Network, Wallet, Zap, Gem, CircleCheck, Inbox, ShoppingBag, GitFork, Settings, Shield, ChevronDown, PanelLeft, Search, Sun, Moon, RefreshCw, UserRound, LogOut, Download, Puzzle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { adminMenuHref, visibleNavigation, type NavigationIdentity } from '@/lib/navigation'
import { pluginMenuVisible } from '@/lib/plugin-navigation'
import { LanguageSwitcher, useLocale } from '@/components/locale-provider'

const icons: Record<string, typeof Bot> = { Bot, LayoutDashboard, Network, Wallet, Zap, Gem, CircleCheck, Inbox, ShoppingBag, GitFork, Settings, Shield }
export type AdminUser = NavigationIdentity & { id: string; name: string }

const MenuLink = forwardRef<HTMLAnchorElement, Omit<ComponentPropsWithoutRef<'a'>, 'href'> & { route: string }>(function MenuLink({ route, ...props }, ref) {
  const href = adminMenuHref(route)
  return href.startsWith('/api/legacy?')
    ? <a ref={ref} href={href} {...props} />
    : <Link ref={ref} to={href} preload="intent" {...props} />
})

function SideNavigation({ user, activeRoute, onNavigate }: { user: AdminUser; activeRoute: string; onNavigate?: () => void }) {
  const branding = useQuery({queryKey:['system-config'],queryFn:()=>api<{branding?:{logoText:string;logoImageUrl:string;footerText:string}}>('/api/settings-config?action=config'),retry:false})
  const pluginState = useQuery({ queryKey: ['plugins'], queryFn: () => api<{ plugins: Array<{ id: string; state: string | null; menuRoutes?: string[] }> }>('/api/plugins'), retry: false, staleTime: 15_000 })
  const canViewVersion = visibleNavigation(user).some(group => group.items.some(item => item.id === 'admin.setting.app_version.index'))
  const versionStatus = useQuery({ queryKey: ['settings-version'], queryFn: () => api<{ images?: { admin?: { state?: string } } }>('/api/settings-version?refresh=1'), enabled: canViewVersion, retry: false, staleTime: 30_000, refetchInterval: 3 * 24 * 60 * 60 * 1000, refetchIntervalInBackground: true })
  const [search, setSearch] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(visibleNavigation(user).map(group => [group.id, group.items.some(item => item.id === activeRoute)])))
  const { t, locale } = useLocale()
  const groups = visibleNavigation(user).map(group => ({ ...group, label: t(group.label), items: group.items.filter(item => pluginMenuVisible(item.id, pluginState.data?.plugins)).map(item => ({ ...item, label: t(item.label) })) })).filter(group => group.items.length > 0)
  const term = search.trim().toLowerCase()
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus() }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <MenuLink route='admin.home' className="flex h-14 shrink-0 items-center justify-center px-5 text-base font-semibold tracking-tight" onClick={onNavigate}>{branding.data?.branding?.logoImageUrl && <img src={branding.data.branding.logoImageUrl} alt="" className="mr-2 size-6 rounded object-contain" />}{branding.data?.branding?.logoText ?? "TGBotPress"}</MenuLink>
    <div className="relative mx-3 mb-3"><Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground" /><Input ref={input} aria-label={t("搜索后台菜单")} placeholder={t("搜索菜单…  ⌘K")} value={search} onChange={event => setSearch(event.target.value)} className="h-11 md:h-9 pl-9 text-xs" /></div>
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:hidden"><nav aria-label={t("后台主导航")} className="space-y-1 px-3 pb-3">{groups.map(group => {
      const items = group.items.filter(item => !term || group.label.toLowerCase().includes(term) || item.label.toLowerCase().includes(term))
      if (!items.length) return null
      const Icon = icons[group.icon] || Bot
      if (group.id === 'dashboard') return <Button key={group.id} variant={activeRoute === 'admin.home' ? 'secondary' : 'ghost'} asChild className="h-11 md:h-9 w-full justify-start gap-3 px-3 text-[13px]"><MenuLink route='admin.home' onClick={onNavigate}><Icon className="size-4 text-muted-foreground" />{group.label}</MenuLink></Button>
      return <Collapsible key={group.id} open={!!term || !!expanded[group.id]} onOpenChange={open => setExpanded(current => ({ ...current, [group.id]: open }))}>
        <CollapsibleTrigger asChild><Button variant="ghost" className="h-11 md:h-9 w-full justify-start gap-3 px-3 text-[13px]"><Icon className="size-4 text-muted-foreground" /><span className="flex-1 text-left">{group.label}</span><ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${expanded[group.id] || term ? '' : '-rotate-90'}`} /></Button></CollapsibleTrigger>
        <CollapsibleContent><div className="mt-1 space-y-0.5 pl-7">{items.map(item => <Button key={item.id} asChild variant={item.id === activeRoute ? 'secondary' : 'ghost'} className="h-11 md:h-8 w-full justify-start px-3 text-xs font-normal"><MenuLink route={item.id} aria-current={item.id === activeRoute ? 'page' : undefined} onClick={onNavigate}>{item.label}</MenuLink></Button>)}</div></CollapsibleContent>
      </Collapsible>
    })}</nav></ScrollArea>
    <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t px-4"><span className="text-[11px] text-muted-foreground">{branding.data?.branding?.footerText ?? "TGBotPress"}</span>{canViewVersion && !versionStatus.isError && versionStatus.data?.images?.admin?.state === 'update_available' && <Tooltip><TooltipTrigger asChild><MenuLink route='admin.setting.app_version.index' aria-label={t("版本更新")} className="flex size-5 items-center justify-center rounded-full bg-sky-500 text-white" onClick={onNavigate}><Download className="size-3" /></MenuLink></TooltipTrigger><TooltipContent side="right">{t("版本更新")}</TooltipContent></Tooltip>}</div>
  </div>
}

export function AdminShell({ user, title, activeRoute, onRefresh, onLogout, children }: { user: AdminUser; title: string; activeRoute: string; onRefresh: () => void; onLogout: () => void; children: ReactNode }) {
  const { t } = useLocale()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const refreshPage = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { onRefresh(); await queryClient.invalidateQueries({ type: "active" }) } finally { setRefreshing(false) }
  }
  const hasSecurity = visibleNavigation(user).some(group => group.items.some(item => item.id === 'admin.setting.security.index'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(false)
  useEffect(() => { const enabled = localStorage.getItem('tg-platform-theme') === 'dark'; setDark(enabled); document.documentElement.classList.toggle('dark', enabled) }, [])
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem('tg-platform-theme', next ? 'dark' : 'light'); document.documentElement.classList.toggle('dark', next) }
  return <TooltipProvider><div className="min-h-screen min-w-0 bg-background md:pl-64">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r md:block"><SideNavigation user={user} activeRoute={activeRoute} /></aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent aria-describedby={undefined} side="left" className="w-64 p-0"><SheetTitle className="sr-only">后台导航</SheetTitle><SideNavigation user={user} activeRoute={activeRoute} onNavigate={() => setMobileOpen(false)} /></SheetContent></Sheet>
    <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center justify-between gap-3 border-b bg-card px-4">
      <div className="flex min-w-0 items-center gap-3"><Button variant="outline" size="icon" className="size-8 md:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}><PanelLeft className="size-4" /></Button><span className="truncate text-sm font-semibold">{t(title)}</span></div>
      <div className="flex shrink-0 items-center gap-2"><LanguageSwitcher /><Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" asChild><Link to="/console/plugins" preload="intent"><Puzzle className="size-3.5" /><span className="hidden sm:inline">{t("插件")}</span></Link></Button><div className="flex h-8 items-center rounded-full border bg-background"><button aria-label={t("刷新当前页面")} onClick={refreshPage} disabled={refreshing} className="flex size-8 items-center justify-center rounded-l-full transition-colors hover:bg-muted active:bg-foreground active:text-background disabled:opacity-50"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /></button><span className="h-4 w-px bg-border" /><button aria-label={t("切换日夜模式")} onClick={toggleTheme} className="flex size-8 items-center justify-center rounded-r-full transition-colors hover:bg-muted active:bg-foreground active:text-background">{dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}</button></div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-8 gap-2 px-2.5 text-xs"><UserRound className="size-3.5" /><span className="hidden sm:inline">{user.name}</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40"><DropdownMenuLabel className="text-xs">{user.name}</DropdownMenuLabel><DropdownMenuSeparator />{hasSecurity && <DropdownMenuItem asChild><MenuLink route='admin.setting.security.index'><Shield className="size-4" />{t("安全设置")}</MenuLink></DropdownMenuItem>}<DropdownMenuItem onClick={onLogout}><LogOut className="size-4" />{t("退出登录")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    <div className="min-w-0">{children}</div>
  </div></TooltipProvider>
}
