import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'

type Row = { rid: number; wallet_addr: string; collection_wallet_addr: string; coin_name: string; collection_amount: string; collection_time: string | null; collection_hash: string | null; create_time: string | null }
type PageData = { rows: Row[]; total: number; page: number; pageSize: number }
export const Route = createFileRoute('/console/collection-list')({ component: CollectionList })

function CollectionList() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const data = useQuery({ queryKey: ['collection-list', page, pageSize, search], queryFn: () => api<PageData>(`/api/collection-list?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), search })}`), enabled: !!me.data, retry: false })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" />TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=collection"><KeyRound className="size-4" />管理员登录</a></Button></section></main>
  const total = data.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  return <AdminShell user={me.data} title="归集记录" activeRoute="admin.collection.list.index" onRefresh={() => data.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <section className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3">
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1) }}>
          <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} placeholder="搜索来源钱包或归集钱包" className="h-9 pl-8 text-xs" /></div>
          <Button type="submit" size="sm" className="h-9">搜索</Button>
        </form>
        <Button variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={data.isFetching} onClick={() => data.refetch()}><RefreshCw className={`size-3.5 ${data.isFetching ? 'animate-spin' : ''}`} /></Button>
      </section>
      <section className="overflow-hidden rounded-xl bg-card">
        <div className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-muted-foreground" />归集记录</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></div>
        {data.error && <div role="alert" className="px-3 py-4 text-xs text-destructive">{data.error instanceof ApiError ? data.error.message : '加载失败，请重试'}</div>}
        <div className="hidden overflow-x-auto md:block">
          <Table className="min-w-[900px]"><TableHeader><TableRow><TableHead className="h-9 px-3">来源钱包</TableHead><TableHead className="h-9 px-3">归集钱包</TableHead><TableHead className="h-9 px-3">币种</TableHead><TableHead className="h-9 px-3 text-right">归集数量</TableHead><TableHead className="h-9 px-3">归集时间</TableHead><TableHead className="h-9 px-3">交易哈希</TableHead><TableHead className="h-9 px-3">创建时间</TableHead></TableRow></TableHeader>
            <TableBody>{data.isPending ? <TableRow><TableCell colSpan={7} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow> : data.data?.rows.length ? data.data.rows.map(row => <TableRow key={row.rid}><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[11px]" title={row.wallet_addr}>{row.wallet_addr}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[11px]" title={row.collection_wallet_addr}>{row.collection_wallet_addr}</TableCell><TableCell className="px-3 py-2 text-xs">{row.coin_name}</TableCell><TableCell className="px-3 py-2 text-right font-mono text-xs">{row.collection_amount}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.collection_time || '—'}</TableCell><TableCell className="max-w-52 truncate px-3 py-2 font-mono text-[11px]" title={row.collection_hash || ''}>{row.collection_hash || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.create_time || '—'}</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}</TableBody>
          </Table>
        </div>
        <div className="divide-y md:hidden">
          {data.isPending ? <p className="py-10 text-center text-xs text-muted-foreground">加载中…</p> : data.data?.rows.length ? data.data.rows.map(row => <article key={row.rid} className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{row.coin_name}</span><span className="font-mono text-xs">{row.collection_amount}</span></div>
            <dl className="space-y-2 text-xs"><div className="min-w-0"><dt className="text-muted-foreground">来源钱包</dt><dd className="break-all font-mono text-[11px]">{row.wallet_addr}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">归集钱包</dt><dd className="break-all font-mono text-[11px]">{row.collection_wallet_addr}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">交易哈希</dt><dd className="break-all font-mono text-[11px]">{row.collection_hash || '—'}</dd></div><div className="grid grid-cols-2 gap-2"><div><dt className="text-muted-foreground">归集时间</dt><dd>{row.collection_time || '—'}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd>{row.create_time || '—'}</dd></div></div></dl>
          </article>) : <p className="py-10 text-center text-xs text-muted-foreground">暂无记录</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">第 {page} / {pageCount} 页</span>
          <div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10,20,30,50,100].map(value => <SelectItem key={value} value={String(value)} className="text-xs">{value} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || data.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pageCount || data.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div>
        </footer>
      </section>
    </main>
  </AdminShell>
}
