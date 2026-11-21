import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Eye, RefreshCw, Search, Trash2 } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { CloneProxyTabs } from '@/components/cloneproxy-tabs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'

type Merchant = { rid: number; serial: number; owner_tg_uid: string; owner_tg_username: string | null; owner_tg_name: string | null; owner_label: string; bot_label: string; bot_username: string | null; bot_firstname: string | null; revenue_ratio: number; status: number; status_text: string; webhook_status_text: string; total_revenue_usdt: number; total_revenue_trx: number; create_time: string }
type PageData = { rows: Merchant[]; total: number; page: number; pageSize: number }
type Detail = { rid: number; owner_tg_uid: string; owner_tg_username: string | null; owner_tg_name: string | null; bot_username: string | null; bot_firstname: string | null; bot_token_masked: string; revenue_ratio: number; status: number; status_text: string; webhook_status_text: string; webhook_error: string | null; total_revenue_usdt: number; total_revenue_trx: number; master_cash_usdt: number; master_cash_trx: number; created_at: string | null }
type Order = { rid: number; serial: number; source_type: string; source_order_rid: number | null; pay_user_tg_uid: string; pay_user_tg_username: string | null; amount: number; need_pay_amount: number; coin_name: string; payment_method_text: string; status_text: string; revenue_ratio: number; revenue_amount: number; tx_hash_masked: string; comments: string | null; create_time: string | null; paid_time: string | null }
const amount = (v: number | string | null | undefined) => formatLocaleNumber(Number(v || 0), { maximumFractionDigits: 6 })
export const Route = createFileRoute('/console/cloneproxy-merchants')({ component: CloneProxyMerchants })
function CloneProxyMerchants() {
  useLocale()
  const client = useQueryClient(), [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15), [orderPage, setOrderPage] = useState(1), [orderPageSize, setOrderPageSize] = useState(15)
  const [selected, setSelected] = useState<Merchant | null>(null), [tab, setTab] = useState('detail'), [ratio, setRatio] = useState('0'), [picked, setPicked] = useState<number[]>([]), [confirmDelete, setConfirmDelete] = useState(false), [feedback, setFeedback] = useState(''), [failure, setFailure] = useState('')
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const list = useQuery({ queryKey: ['cloneproxy', 'merchants', page, pageSize, search], queryFn: () => api<PageData>('/api/cloneproxy/?' + new URLSearchParams({ action: 'merchants', page: String(page), pageSize: String(pageSize), keyword: search })), enabled: !!me.data, retry: false })
  const detail = useQuery({ queryKey: ['cloneproxy', 'detail', selected?.rid], queryFn: () => api<{ merchant: Detail }>('/api/cloneproxy/?' + new URLSearchParams({ action: 'detail', rid: String(selected?.rid) })), enabled: !!me.data && !!selected, retry: false })
  const orders = useQuery({ queryKey: ['cloneproxy', 'orders', selected?.rid, tab], queryFn: () => api<{ rows: Order[]; total: number }>('/api/cloneproxy/?' + new URLSearchParams({ action: 'orders', rid: String(selected?.rid), type: tab === 'opening' ? 'opening' : 'revenue', page: String(orderPage), pageSize: String(orderPageSize) })), enabled: !!me.data && !!selected && (tab === 'opening' || tab === 'revenue' || tab === 'proxy'), retry: false })
  const mutation = useMutation({
    mutationFn: (body: object) => api<{ message: string }>('/api/cloneproxy/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: async result => { setFailure(''); setFeedback(result.message); setConfirmDelete(false); setPicked([]); await client.invalidateQueries({ queryKey: ['cloneproxy'] }) },
    onError: error => setFailure(error instanceof ApiError ? error.message : '操作失败，请重试'),
  })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); location.assign('/console/home') } })
  const refresh = () => { void list.refetch(); if (selected) void detail.refetch() }
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6"><h1 className="font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=cloneProxyMerchants">管理员登录</a></Button></section></main>
  const d = detail.data?.merchant, rows = list.data?.rows || [], total = list.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize)), orderTotal = orders.data?.total || 0, orderPages = Math.max(1, Math.ceil(orderTotal / orderPageSize))
  const select = (rid: number, checked: boolean) => setPicked(current => checked ? [...new Set([...current, rid])] : current.filter(id => id !== rid))
  const applySearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(keyword.trim()) }
  const open = (row: Merchant) => { setSelected(row); setTab('detail'); setRatio(String(row.revenue_ratio)); setPicked([]); setOrderPage(1); setOrderPageSize(15); setFailure(''); setFeedback('') }
  const fmtUser = (u: Order) => (u.pay_user_tg_username ? '@' + u.pay_user_tg_username.replace(/^@/, '') : '未设置') + ' · ' + u.pay_user_tg_uid
  const doDelete = () => selected && mutation.mutate({ action: 'orders_soft_delete', rid: selected.rid, type: tab === 'opening' ? 'opening' : 'revenue', rids: picked })
  const head = tab === 'opening' ? ['序号', '用户', '开户费用', '支付方式', '状态', '创建时间', '支付时间', '选择'] : ['序号', '来源', '订单号', '用户', '金额', '收益比例', '收益', '支付方式', '状态', '交易哈希', '选择']
  const fmtCell = (order: Order, index: number) => tab === 'opening'
    ? [order.serial ?? index + 1, fmtUser(order), amount(order.need_pay_amount) + ' USDT', order.payment_method_text, order.status_text, order.create_time || '—', order.paid_time || '—']
    : [order.serial ?? index + 1, order.source_type || '—', order.source_order_rid || '—', fmtUser(order), amount(order.amount) + ' ' + (order.coin_name || '').toUpperCase(), amount(order.revenue_ratio) + '%', amount(order.revenue_amount) + ' ' + (order.coin_name || '').toUpperCase(), order.payment_method_text, order.status_text, order.tx_hash_masked || '—']
  return <AdminShell user={me.data} title="克隆/代理商户管理" activeRoute="admin.telegram.cloneproxy.merchants" onRefresh={refresh} onLogout={() => logout.mutate()}>
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <CloneProxyTabs active="admin.telegram.cloneproxy.merchants" />
      <section className="rounded-xl border bg-card p-3">
        <form onSubmit={applySearch} className="flex flex-wrap gap-2"><div className="relative min-w-56 flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-8 text-xs" placeholder="搜索用户名、HFTGID 或机器人" value={keyword} onChange={event => setKeyword(event.target.value)} /></div><Button size="sm" type="submit"><Search className="mr-1.5 size-3.5" />搜索</Button><Button size="sm" type="button" variant="outline" onClick={refresh} aria-label="刷新商户列表"><RefreshCw className="size-3.5" /></Button></form>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3"><h1 className="text-sm font-semibold">商户 <span className="ml-1 text-xs font-normal text-muted-foreground">{total}</span></h1></div>
        <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>管理员 / HFTGID</TableHead><TableHead>TG 名称</TableHead><TableHead>机器人</TableHead><TableHead className="text-right">比例</TableHead><TableHead className="text-right">USDT 收益</TableHead><TableHead className="text-right">TRX 收益</TableHead><TableHead>状态</TableHead><TableHead>开户时间</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.rid}><TableCell className="whitespace-nowrap text-xs">{row.owner_label}</TableCell><TableCell className="max-w-36 truncate text-xs">{row.owner_tg_name || '—'}</TableCell><TableCell className="text-xs">{row.bot_label}</TableCell><TableCell className="text-right text-xs">{amount(row.revenue_ratio)}%</TableCell><TableCell className="text-right text-xs">{amount(row.total_revenue_usdt)}</TableCell><TableCell className="text-right text-xs">{amount(row.total_revenue_trx)}</TableCell><TableCell><span className={`rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{row.status_text}</span></TableCell><TableCell className="whitespace-nowrap text-xs">{row.create_time || '—'}</TableCell><TableCell><Button size="icon" variant="ghost" className="size-7" aria-label="查看商户详情" onClick={() => open(row)}><Eye className="size-3.5" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={9} className="h-24 text-center text-xs text-muted-foreground">{list.isLoading ? '加载中…' : '暂无商户'}</TableCell></TableRow>}</TableBody></Table></div>
        <div className="divide-y md:hidden">
          {list.isLoading ? <p className="py-10 text-center text-xs text-muted-foreground">加载中…</p> : rows.length ? rows.map(row => <article key={row.rid} className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold">{row.owner_tg_name || row.owner_tg_username || `用户 ${row.owner_tg_uid}`}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.owner_tg_username ? `@${row.owner_tg_username.replace(/^@/, '')}` : '未设置用户名'} · {row.bot_label}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{row.status_text}</span></div>
            <div className="grid grid-cols-2 gap-2 text-xs"><div><span className="text-muted-foreground">HFTGID</span><p className="break-all">{row.owner_tg_uid}</p></div><div><span className="text-muted-foreground">分润比例</span><p>{amount(row.revenue_ratio)}%</p></div><div><span className="text-muted-foreground">开户时间</span><p>{row.create_time || '—'}</p></div><div><span className="text-muted-foreground">USDT 收益</span><p className="font-mono">{amount(row.total_revenue_usdt)}</p></div><div><span className="text-muted-foreground">TRX 收益</span><p className="font-mono">{amount(row.total_revenue_trx)}</p></div></div>
            <div className="flex justify-end border-t pt-2"><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => open(row)}><Eye className="mr-1.5 size-3.5" />查看商户</Button></div>
          </article>) : <p className="py-10 text-center text-xs text-muted-foreground">暂无商户</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground"><span>共 {total} 条</span><div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(v => <SelectItem key={v} value={String(v)}>{v} 条/页</SelectItem>)}</SelectContent></Select><span>{page}/{pages}</span><Button size="icon" variant="outline" className="size-8" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(v => v - 1)}><ChevronLeft className="size-4" /></Button><Button size="icon" variant="outline" className="size-8" aria-label="下一页" disabled={page >= pages} onClick={() => setPage(v => v + 1)}><ChevronRight className="size-4" /></Button></div></div>
      </section>
    </main>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setPicked([]); setFailure('') } }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>商户详情 {selected && <span className="text-xs font-normal text-muted-foreground">#{selected.rid}</span>}</DialogTitle></DialogHeader>
        {!d ? <div className="flex h-24 items-center justify-center"><RefreshCw className="size-4 animate-spin" /></div> : <Tabs value={tab} onValueChange={value => { setTab(value); setPicked([]); setOrderPage(1) }}>
          <TabsList className="grid w-full grid-cols-4"><TabsTrigger value="detail">信息</TabsTrigger><TabsTrigger value="revenue">收益账本</TabsTrigger><TabsTrigger value="proxy">代理订单</TabsTrigger><TabsTrigger value="opening">开户订单</TabsTrigger></TabsList>
          <TabsContent value="detail" className="space-y-4 pt-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[
              ['管理员', d.owner_tg_username ? '@' + d.owner_tg_username.replace(/^@/, '') : '未设置'], ['TG 名称', d.owner_tg_name || '—'], ['HFTGID', d.owner_tg_uid],
              ['机器人', d.bot_firstname || (d.bot_username ? '@' + d.bot_username : '—')], ['机器人 Token', d.bot_token_masked || '—'], ['Webhook', d.webhook_status_text],
              ['累计 USDT', amount(d.total_revenue_usdt)], ['累计 TRX', amount(d.total_revenue_trx)], ['开户时间', d.created_at || '—'],
              ['主机器人 USDT 余额', amount(d.master_cash_usdt)], ['主机器人 TRX 余额', amount(d.master_cash_trx)], ['Webhook 错误', d.webhook_error || '—'],
            ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border p-3"><div className="mb-1 text-[10px] text-muted-foreground">{label}</div><div className="break-all text-xs font-medium">{value}</div></div>)}</div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3"><label className="space-y-1 text-xs"><span className="font-medium">收益比例（0%–150%）</span><Input className="h-8 w-36" type="number" min="0" max="150" step="0.01" value={ratio} onChange={event => setRatio(event.target.value)} /></label><Button size="sm" disabled={mutation.isPending} onClick={() => selected && mutation.mutate({ action: 'merchant_update', rid: selected.rid, revenue_ratio: ratio })}>保存比例</Button><div className="ml-auto flex items-center gap-2 text-xs"><span>{d.status_text}</span><Switch checked={d.status === 1} disabled={mutation.isPending} onCheckedChange={checked => selected && mutation.mutate({ action: 'merchant_status', rid: selected.rid, status: checked ? 1 : 2 })} aria-label="切换商户状态" /></div></div>
          </TabsContent>
          {(['revenue', 'proxy', 'opening'] as const).map(orderTab => <TabsContent key={orderTab} value={orderTab} className="pt-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">{tab === 'proxy' ? '代理订单与收益账本共用记录' : tab === 'opening' ? '开户记录' : '分润与结算记录'}</span><Button size="sm" variant="destructive" disabled={!picked.length || mutation.isPending} onClick={() => setConfirmDelete(true)}><Trash2 className="mr-1.5 size-3.5" />软删除 {picked.length || ''}</Button></div>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>{head.map(h => <TableHead key={h} className="whitespace-nowrap text-[10px]">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{(orders.data?.rows || []).map((order, index) => <TableRow key={order.rid}>{fmtCell(order, index).map((cell, i) => <TableCell key={i} className="max-w-44 whitespace-nowrap text-[11px]">{cell}</TableCell>)}<TableCell><Checkbox checked={picked.includes(order.rid)} onCheckedChange={checked => select(order.rid, checked === true)} aria-label={`选择订单 ${order.rid}`} /></TableCell></TableRow>)}{!orders.data?.rows?.length && <TableRow><TableCell colSpan={head.length} className="h-20 text-center text-xs text-muted-foreground">{orders.isLoading ? '加载中…' : '暂无订单'}</TableCell></TableRow>}</TableBody></Table></div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>共 {orderTotal} 条</span><div className="flex items-center gap-2"><Select value={String(orderPageSize)} onValueChange={value => { setOrderPageSize(Number(value)); setOrderPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[15, 30, 50, 100].map(value => <SelectItem key={value} value={String(value)}>{value} 条/页</SelectItem>)}</SelectContent></Select><span>{orderPage}/{orderPages}</span><Button size="icon" variant="outline" className="size-8" aria-label="上一页订单" disabled={orderPage <= 1} onClick={() => setOrderPage(value => value - 1)}><ChevronLeft className="size-4" /></Button><Button size="icon" variant="outline" className="size-8" aria-label="下一页订单" disabled={orderPage >= orderPages} onClick={() => setOrderPage(value => value + 1)}><ChevronRight className="size-4" /></Button></div></div>
          </TabsContent>)}
        </Tabs>}
        {failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}
        <DialogFooter><Button size="sm" variant="outline" onClick={() => setSelected(null)}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>软删除所选订单？</DialogTitle></DialogHeader><p className="text-xs text-muted-foreground">订单账本记录会保留，避免后续同步重复入账。</p>{failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}<DialogFooter><Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button><Button size="sm" variant="destructive" disabled={mutation.isPending} onClick={doDelete}>确认软删除</Button></DialogFooter></DialogContent></Dialog>
    {feedback && <div role="status" className="fixed bottom-4 right-4 z-50 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">{feedback}<Button size="sm" variant="ghost" className="ml-2 h-7" onClick={() => setFeedback('')}>关闭</Button></div>}
  </AdminShell>
}
