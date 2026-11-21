import { Link } from '@tanstack/react-router'

const tabs = [
  { to: '/console/cloneproxy-basic', label: '基础设置', route: 'admin.telegram.cloneproxy.basic' },
  { to: '/console/cloneproxy-merchants', label: '商户管理', route: 'admin.telegram.cloneproxy.merchants' },
] as const

export function CloneProxyTabs({ active }: { active: (typeof tabs)[number]['route'] }) {
  return (
    <nav aria-label="克隆/代理页面" className="grid h-11 w-full grid-cols-2 rounded-xl bg-muted p-1">
      {tabs.map(tab => {
        const selected = active === tab.route
        return (
          <Link
            key={tab.route}
            to={tab.to}
            aria-current={selected ? 'page' : undefined}
            className={[
              'flex h-full items-center justify-center rounded-lg px-4 text-sm font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              selected
                ? 'bg-white text-foreground shadow-sm ring-1 ring-border/40 dark:bg-input/30'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
