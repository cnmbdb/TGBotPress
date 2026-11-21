import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search, ShoppingBag } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type Bot = { rid: number; bot_firstname: string | null; bot_username: string | null }
type Order = { rid: number; bot_rid: number; tg_uid: string; tg_username: string | null; cdkey_no: string | null; pay_type_label: string; pay_price: string | null; pay_time: string | null; comments: string | null; bot_firstname: string | null; bot_username: string | null; bot_token_configured: boolean }
type PageData = { rows: Order[]; total: number; page: number; pageSize: number; canUpdate: boolean }
export const Route = createFileRoute('/console/shop-orders')({ component: ShopOrders })

function ShopOrders() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState(''), [filter, setFilter] = useState(''), [botRid, setBotRid] = useState('all')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15), [selected, setSelected] = useState<Order | null>(null)
  const [comments, setComments] = useState(''), [feedback, setFeedback] = useState('')
  const bots = useQuery({ queryKey: ['shop-orders', 'bots'], queryFn: () => api<{ bots: Bot[] }>('/api/shop-orders?action=options'), enabled: !!me.data, retry: false })
  const query = useQuery({
    queryKey: ['shop-orders', page, pageSize, filter, botRid],
    queryFn: () => api<PageData>(`/api/shop-orders?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), cdkey: filter, botRid })}`),
    enabled: !!me.data,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: () => api<{ message: string }>('/api/shop-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_comments', rid: selected?.rid, comments }) }),
    onSuccess: async result => { setSelected(null); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['shop-orders'] }) },
  })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><ShoppingBag className="size-4" />TG Ultra</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=shopOrders"><KeyRound className="size-4" />管理员登录</a></Button></section></main>
  const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize))
  const closeEditor = () => { setSelected(null); mutation.reset() }
  return <AdminShell user={me.data} title="商品订单" activeRoute="admin.shop.order.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}><main className="space-y-3 p-3 sm:p-4">
    <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setFilter(draft.trim()); setPage(1) }}>
      <Select value={botRid} onValueChange={value => { setBotRid(value); setPage(1) }}><SelectTrigger className="h-9 w-full text-xs sm:w-52"><SelectValue placeholder="全部机器人" /></SelectTrigger><SelectContent><SelectItem value="all" className="text-xs">全部机器人</SelectItem>{bots.data?.bots.map(bot => <SelectItem key={bot.rid} value={String(bot.rid)} className="text-xs">{bot.bot_firstname || bot.bot_username || `机器人 #${bot.rid}`}</SelectItem>)}</SelectContent></Select>
      <div className="relative min-w-40 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} placeholder="搜索卡号" className="h-9 pl-8 text-xs" /></div>
      <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button><Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`} /></Button>
    </form>
    <section className="overflow-hidden rounded-xl bg-card"><header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><ShoppingBag className="size-4 text-muted-foreground" />商品订单</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></header>
      {query.error && <div role="alert" className="px-3 py-3 text-xs text-destructive">{query.error instanceof ApiError ? query.error.message : '加载失败，请重试'}</div>}
      <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1260px]"><TableHeader><TableRow>{['订单', '机器人 Token', '机器人', '机器人用户名', '下单 TG ID', '下单用户名', '卡号', '支付方式', '支付金额', '支付时间', '备注', '操作'].map(label => <TableHead key={label} className="h-9 px-3">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {query.isPending ? <TableRow><TableCell colSpan={12} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow> : query.data?.rows.length ? query.data.rows.map(row => <TableRow key={row.rid}>
          <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${row.bot_token_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{row.bot_token_configured && <BadgeCheck className="size-3" />}{row.bot_token_configured ? '已配置' : '未配置'}</span></TableCell>
          <TableCell className="max-w-40 truncate px-3 py-2 text-xs">{row.bot_firstname || '—'}</TableCell><TableCell className="px-3 py-2 text-xs">{row.bot_username ? `@${row.bot_username}` : '—'}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.tg_uid}</TableCell><TableCell className="px-3 py-2 text-xs">{row.tg_username ? `@${row.tg_username}` : '—'}</TableCell><TableCell className="max-w-40 truncate px-3 py-2 font-mono text-xs" title={row.cdkey_no || ''}>{row.cdkey_no || '—'}</TableCell><TableCell className="px-3 py-2 text-xs">{row.pay_type_label}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.pay_price || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.pay_time || '—'}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 text-xs" title={row.comments || ''}>{row.comments || '—'}</TableCell>
          <TableCell className="px-3 py-2">{query.data.canUpdate && <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { setSelected(row); setComments(row.comments || ''); mutation.reset() }}>修改备注</Button>}</TableCell>
        </TableRow>) : <TableRow><TableCell colSpan={12} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}
      </TableBody></Table></div>
      <div className="divide-y md:hidden">{query.isPending?<p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>:query.data?.rows.length?query.data.rows.map(row=><ShopOrderMobileCard key={row.rid} row={row} canUpdate={!!query.data?.canUpdate} onUpdate={()=>{setSelected(row);setComments(row.comments||'');mutation.reset()}}/>):<p className="py-8 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)} className="text-xs">{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div></footer>
    </section>
  </main>
  <Dialog open={!!selected} onOpenChange={open => { if (!open) closeEditor() }}><DialogContent aria-describedby={undefined} className="max-w-md gap-4"><DialogHeader><DialogTitle className="text-base">修改订单备注</DialogTitle></DialogHeader>{selected && <div className="space-y-3"><div className="rounded-lg bg-muted px-3 py-2 text-xs">订单 #{selected.rid} · 卡号 {selected.cdkey_no || '—'}</div><Textarea rows={4} maxLength={3000} value={comments} onChange={event => setComments(event.target.value)} placeholder="输入备注" className="text-xs" />{mutation.error && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '保存失败，请重试'}</p>}</div>}<DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={closeEditor}>取消</Button><Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? '保存中…' : '保存备注'}</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}

function ShopOrderMobileCard({row,canUpdate,onUpdate}:{row:Order;canUpdate:boolean;onUpdate:()=>void}) {
 return <article className="space-y-3 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium">商城订单 #{row.rid}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.bot_firstname||`机器人 #${row.bot_rid}`} · {row.bot_username?`@${row.bot_username}`:'—'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${row.bot_token_configured?'bg-emerald-50 text-emerald-700':'bg-muted text-muted-foreground'}`}>{row.bot_token_configured?'已配置 Token':'未配置 Token'}</span></div><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">下单用户</dt><dd className="mt-0.5">{row.tg_username?`@${row.tg_username}`:'—'} · <span className="font-mono">{row.tg_uid}</span></dd></div><div><dt className="text-muted-foreground">卡号</dt><dd className="mt-0.5 break-all font-mono text-[10px]">{row.cdkey_no||'—'}</dd></div><div><dt className="text-muted-foreground">支付方式 / 金额</dt><dd className="mt-0.5">{row.pay_type_label} · <span className="font-mono">{row.pay_price||'—'}</span></dd></div><div><dt className="text-muted-foreground">支付时间</dt><dd className="mt-0.5">{row.pay_time||'—'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">备注</dt><dd className="mt-0.5">{row.comments||'—'}</dd></div></dl>{canUpdate&&<Button size="sm" variant="outline" className="h-8 w-full" onClick={onUpdate}>修改备注</Button>}</article>
}
