import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'

type Row = { rid: number; chain_type: string; wallet_addr: string; total_transit_usdt: string; total_transit_sxf: string; total_yuzhi_sxf: string; need_feedback_sxf: string; send_feedback_sxf: string; last_transit_time: string | null; last_yuzhi_time: string | null }
type Data = { rows: Row[]; total: number; page: number; pageSize: number; canAdd: boolean; canAdjust: boolean }
type Payload = { action: 'create'; chain_type: 'trc'; wallet_addr: string; yuzhi_sxf: string } | { action: 'adjust'; rid: number; yuzhi_sxf: string }
type Form = { wallet: string; amount: string }
export const Route = createFileRoute('/console/transit-userwallet')({ component: TransitUserWalletPage })

function TransitUserWalletPage() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState(''), [filter, setFilter] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'create' | Row | null>(null), [form, setForm] = useState<Form>({ wallet: '', amount: '' }), [confirm, setConfirm] = useState<Payload | null>(null), [feedback, setFeedback] = useState('')
  const query = useQuery({ queryKey: ['transit-userwallet', page, pageSize, filter], queryFn: () => api<Data>('/api/transit-userwallet?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), wallet: filter })), enabled: !!me.data, retry: false })
  const mutation = useMutation({
    mutationFn: (body: Payload) => api<{ message: string }>('/api/transit-userwallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: async result => { setFeedback(result.message); setConfirm(null); setEditor(null); setForm({ wallet: '', amount: '' }); await client.invalidateQueries({ queryKey: ['transit-userwallet'] }) },
  })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" />TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=transitUserwallet">管理员登录</a></Button></section></main>
  const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize))
  const openCreate = () => { mutation.reset(); setForm({ wallet: '', amount: '' }); setEditor('create') }
  const openAdjust = (row: Row) => { mutation.reset(); setForm({ wallet: row.wallet_addr, amount: '' }); setEditor(row) }
  const requestSave = () => {
    const amount = form.amount.trim()
    if (!amount) return
    setConfirm(editor === 'create' ? { action: 'create', chain_type: 'trc', wallet_addr: form.wallet.trim(), yuzhi_sxf: amount } : editor ? { action: 'adjust', rid: editor.rid, yuzhi_sxf: amount } : null)
  }
  return <AdminShell user={me.data} title="闪兑用户" activeRoute="admin.transit.userwallet.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setFilter(draft.trim()); setPage(1) }}>
        <div className="relative min-w-48 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} placeholder="搜索钱包地址" className="h-9 pl-8 text-xs" /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {query.data?.canAdd && <Button type="button" size="sm" className="h-9" onClick={openCreate}><Plus className="mr-1 size-3.5" />添加预支</Button>}
      </form>
      {query.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{query.error instanceof ApiError ? query.error.message : '加载失败，请重试'}</div>}
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-muted-foreground" />闪兑用户</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></header>
        <div className="space-y-2 p-2 md:hidden">{query.isPending ? <div className="py-8 text-center text-xs text-muted-foreground">加载中…</div> : query.data?.rows.length ? query.data.rows.map(row => <article key={row.rid} className="space-y-3 rounded-lg border p-3"><header className="flex items-center justify-between gap-2"><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{row.chain_type.toUpperCase()}</span><span className="font-mono text-[10px] text-muted-foreground">#{row.rid}</span></header><div className="break-all font-mono text-xs">{row.wallet_addr}</div><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">{[['总已闪兑 USDT', row.total_transit_usdt], ['总已闪兑手续费', row.total_transit_sxf], ['总预支手续费', row.total_yuzhi_sxf], ['未还预支', row.need_feedback_sxf], ['已还预支', row.send_feedback_sxf], ['最近闪兑', row.last_transit_time || '—'], ['最近预支', row.last_yuzhi_time || '—']].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-mono">{value}</dd></div>)}</dl>{query.data.canAdjust && <div className="border-t pt-2"><Button size="sm" variant="outline" className="h-8" onClick={() => openAdjust(row)}>修改预支</Button></div>}</article>) : <div className="py-8 text-center text-xs text-muted-foreground">暂无闪兑用户</div>}</div>
        <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1050px]">
          <TableHeader><TableRow>{['ID', '链类型', '钱包地址', '总已闪兑 USDT', '总已闪兑手续费', '总预支手续费', '未还预支', '已还预支', '最近闪兑', '最近预支', '操作'].map(label => <TableHead key={label} className="h-9 px-3">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{query.isPending ? <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>
            : query.data?.rows.length ? query.data.rows.map(row => <TableRow key={row.rid}>
              <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs"><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{row.chain_type.toUpperCase()}</span></TableCell>
              <TableCell className="max-w-60 break-all px-3 py-2 font-mono text-[11px]">{row.wallet_addr}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.total_transit_usdt}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.total_transit_sxf}</TableCell>
              <TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.total_yuzhi_sxf}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.need_feedback_sxf}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.send_feedback_sxf}</TableCell>
              <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.last_transit_time || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.last_yuzhi_time || '—'}</TableCell>
              <TableCell className="px-3 py-2">{query.data.canAdjust && <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openAdjust(row)}>修改预支</Button>}</TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">暂无闪兑用户</TableCell></TableRow>}</TableBody>
        </Table></div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)} className="text-xs">{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) { setEditor(null); setForm({ wallet: '', amount: '' }); mutation.reset() } }}><DialogContent aria-describedby={undefined} className="max-w-md"><DialogHeader><DialogTitle className="text-base">{editor === 'create' ? '添加预支' : '修改预支'}</DialogTitle></DialogHeader>
      <form id="transit-userwallet-form" className="space-y-3" onSubmit={event => { event.preventDefault(); requestSave() }}>
        {editor === 'create' ? <><label className="block space-y-1 text-xs"><span>链类型</span><Input value="TRC" disabled className="h-9 text-xs" /></label><label className="block space-y-1 text-xs"><span>钱包地址</span><Input required maxLength={200} value={form.wallet} onChange={event => setForm({ ...form, wallet: event.target.value })} className="h-9 font-mono text-xs" /></label></> : <label className="block space-y-1 text-xs"><span>钱包地址</span><Input value={form.wallet} readOnly className="h-9 font-mono text-xs" /></label>}
        {editor && editor !== 'create' && <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2 text-xs"><span className="text-muted-foreground">当前总预支</span><span className="text-right font-mono">{editor.total_yuzhi_sxf}</span><span className="text-muted-foreground">当前未还</span><span className="text-right font-mono">{editor.need_feedback_sxf}</span></div>}
        <label className="block space-y-1 text-xs"><span>本次预支手续费（TRX）</span><Input required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,4})?" maxLength={17} value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className="h-9 font-mono text-xs" /></label>
        {mutation.error && editor && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '保存失败，请重试'}</p>}
      </form><DialogFooter><Button size="sm" variant="outline" onClick={() => { setEditor(null); mutation.reset() }}>取消</Button><Button size="sm" type="submit" form="transit-userwallet-form" disabled={!form.amount.trim() || (editor === 'create' && !form.wallet.trim())}>继续</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) { setConfirm(null); mutation.reset() } }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">确认预支变更</DialogTitle></DialogHeader>
      <div className="space-y-2 text-xs"><p className="break-all font-mono">{confirm?.action === 'create' ? confirm.wallet_addr : editor && editor !== 'create' ? editor.wallet_addr : ''}</p><p>本次金额：<span className="font-mono">{confirm?.yuzhi_sxf} TRX</span></p><p className="text-muted-foreground">{confirm?.action === 'create' ? '此操作只登记预支账目，TRX 需另行人工转账。' : '保存后总预支会累加本次金额，未还预支更新为本次金额。'}</p></div>
      {mutation.error && confirm && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '操作失败，请重试'}</p>}
      <DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => setConfirm(null)}>返回修改</Button><Button size="sm" disabled={mutation.isPending} onClick={() => confirm && mutation.mutate(confirm)}>{mutation.isPending ? '保存中…' : '确认保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
