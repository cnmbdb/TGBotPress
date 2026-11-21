import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type WalletOption = { rid: number; receive_wallet: string; send_wallet: string; status: number }
type Row = {
  rid: number; transit_wallet_id: number; receive_wallet: string; send_wallet: string
  in_coin_name: string; out_coin_name: string; is_realtime_rate: number; is_realtime_rate_label: string
  profit_rate: string; exchange_rate: string; kou_out_amount: string
  min_transit_amount: number; max_transit_amount: number; comments: string
  create_time: string | null; update_time: string | null
}
type Data = { rows: Row[]; total: number; page: number; pageSize: number; canAdd: boolean; canEdit: boolean; canDelete: boolean }
type Form = {
  walletId: string; inCoin: string; outCoin: string; mode: string
  profitRate: string; exchangeRate: string; fee: string; minimum: string; maximum: string; comments: string
}
const emptyForm: Form = { walletId: '', inCoin: 'usdt', outCoin: 'trx', mode: '3', profitRate: '0.10', exchangeRate: '1', fee: '0', minimum: '1', maximum: '1000', comments: '' }
export const Route = createFileRoute('/console/transit-walletcoins')({ component: TransitWalletCoins })

function TransitWalletCoins() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState(''), [filter, setFilter] = useState(''), [walletFilter, setWalletFilter] = useState('all')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'create' | Row | null>(null), [form, setForm] = useState<Form>(emptyForm)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null), [feedback, setFeedback] = useState('')
  const options = useQuery({ queryKey: ['transit-walletcoins', 'options'], queryFn: () => api<{ wallets: WalletOption[] }>('/api/transit-walletcoins?action=options'), enabled: !!me.data, retry: false })
  const query = useQuery({
    queryKey: ['transit-walletcoins', page, pageSize, filter, walletFilter],
    queryFn: () => api<Data>('/api/transit-walletcoins?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), search: filter, walletId: walletFilter })),
    enabled: !!me.data, retry: false,
  })
  const save = useMutation({
    mutationFn: () => api<{ message: string }>('/api/transit-walletcoins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: editor === 'create' ? 'create' : 'update',
        ...(editor === 'create' ? {} : { rid: editor?.rid }),
        transit_wallet_id: Number(form.walletId), in_coin_name: form.inCoin, out_coin_name: form.outCoin,
        is_realtime_rate: Number(form.mode), profit_rate: form.profitRate || '0',
        exchange_rate: form.exchangeRate || '0', kou_out_amount: form.fee || '0',
        min_transit_amount: Number(form.minimum), max_transit_amount: Number(form.maximum), comments: form.comments,
      }),
    }),
    onSuccess: async result => { setEditor(null); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['transit-walletcoins'] }) },
  })
  const remove = useMutation({
    mutationFn: () => api<{ message: string }>('/api/transit-walletcoins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', rid: deleteRow?.rid }) }),
    onSuccess: async result => { setDeleteRow(null); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['transit-walletcoins'] }) },
  })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" />TG Ultra</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=transitWalletCoins">管理员登录</a></Button></section></main>
  const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize))
  const openEditor = (row?: Row) => {
    setForm(row ? {
      walletId: String(row.transit_wallet_id), inCoin: row.in_coin_name, outCoin: row.out_coin_name,
      mode: String(row.is_realtime_rate), profitRate: row.profit_rate, exchangeRate: row.exchange_rate,
      fee: row.kou_out_amount, minimum: String(row.min_transit_amount), maximum: String(row.max_transit_amount), comments: row.comments || '',
    } : { ...emptyForm, walletId: options.data?.wallets[0] ? String(options.data.wallets[0].rid) : '' })
    setEditor(row || 'create'); save.reset()
  }
  const closeEditor = () => { setEditor(null); save.reset() }
  return <AdminShell user={me.data} title="闪兑币种" activeRoute="admin.transit.walletcoin.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setFilter(draft.trim()); setPage(1) }}>
        <Select value={walletFilter} onValueChange={value => { setWalletFilter(value); setPage(1) }}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-56"><SelectValue placeholder="全部收款钱包" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">全部收款钱包</SelectItem>
            {options.data?.wallets.map(wallet => <SelectItem key={wallet.rid} value={String(wallet.rid)} className="text-xs">#{wallet.rid} · {wallet.receive_wallet}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative min-w-40 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={120} placeholder="搜索收款 / 发送钱包" className="h-9 pl-8 text-xs" /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {query.data?.canAdd && <Button type="button" size="sm" className="h-9" onClick={() => openEditor()}><Plus className="mr-1 size-3.5" />添加币种</Button>}
      </form>
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><ArrowDownUp className="size-4 text-muted-foreground" />闪兑币种</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></header>
        {query.error && <div role="alert" className="px-3 py-3 text-xs text-destructive">{query.error instanceof ApiError ? query.error.message : '加载失败，请重试'}</div>}
        <div className="space-y-2 p-2 md:hidden">{query.isPending ? <div className="py-8 text-center text-xs text-muted-foreground">加载中…</div> : query.data?.rows.length ? query.data.rows.map(row => <article key={row.rid} className="space-y-3 rounded-lg border p-3"><header className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-sm font-medium">{row.in_coin_name.toUpperCase()} <span className="text-muted-foreground">→</span> {row.out_coin_name.toUpperCase()}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{row.receive_wallet}</div></div><span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px]">#{row.rid}</span></header><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div className="col-span-2"><dt className="text-muted-foreground">发送钱包</dt><dd className="break-all font-mono text-[10px]">{row.send_wallet}</dd></div><div><dt className="text-muted-foreground">汇率方式</dt><dd>{row.is_realtime_rate_label}</dd></div><div><dt className="text-muted-foreground">实时利润</dt><dd className="font-mono">{row.profit_rate}</dd></div><div><dt className="text-muted-foreground">固定汇率</dt><dd className="font-mono">{row.exchange_rate}</dd></div><div><dt className="text-muted-foreground">手续费扣除</dt><dd className="font-mono">{row.kou_out_amount}</dd></div><div><dt className="text-muted-foreground">限额</dt><dd className="font-mono">{row.min_transit_amount} – {row.max_transit_amount}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd>{row.create_time || '—'}{row.update_time && <span className="block text-muted-foreground">更新 {row.update_time}</span>}</dd></div><div className="col-span-2 min-w-0"><dt className="text-muted-foreground">备注</dt><dd className="break-words">{row.comments || '—'}</dd></div></dl>{(query.data.canEdit || query.data.canDelete) && <div className="flex gap-1 border-t pt-2">{query.data.canEdit && <Button size="icon" variant="ghost" className="size-8" aria-label="修改币种" onClick={() => openEditor(row)}><Pencil className="size-4" /></Button>}{query.data.canDelete && <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label="删除币种" onClick={() => { remove.reset(); setDeleteRow(row) }}><Trash2 className="size-4" /></Button>}</div>}</article>) : <div className="py-8 text-center text-xs text-muted-foreground">暂无币种配置</div>}</div>
        <div className="hidden overflow-x-auto md:block">
          <Table className="min-w-[1120px]">
            <TableHeader><TableRow>{['ID', '钱包', '兑换方向', '汇率方式', '实时利润', '固定汇率', '手续费扣除', '限额', '备注', '创建时间', '操作'].map(label => <TableHead key={label} className="h-9 px-3">{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {query.isPending ? <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>
                : query.data?.rows.length ? query.data.rows.map(row => <TableRow key={row.rid}>
                  <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell>
                  <TableCell className="max-w-48 px-3 py-2 text-xs"><div className="truncate" title={row.receive_wallet}>{row.receive_wallet}</div><div className="truncate text-muted-foreground" title={row.send_wallet}>发送：{row.send_wallet}</div></TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-xs font-medium">{row.in_coin_name.toUpperCase()} <span className="text-muted-foreground">→</span> {row.out_coin_name.toUpperCase()}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.is_realtime_rate_label}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs">{row.profit_rate}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs">{row.exchange_rate}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs">{row.kou_out_amount}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.min_transit_amount} – {row.max_transit_amount}</TableCell>
                  <TableCell className="max-w-40 truncate px-3 py-2 text-xs" title={row.comments}>{row.comments || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.create_time || '—'}{row.update_time && <div className="text-muted-foreground">更新 {row.update_time}</div>}</TableCell>
                  <TableCell className="px-3 py-2"><div className="flex items-center gap-1">
                    {query.data.canEdit && <Button size="icon" variant="ghost" className="size-7" aria-label="修改币种" onClick={() => openEditor(row)}><Pencil className="size-3.5" /></Button>}
                    {query.data.canDelete && <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" aria-label="删除币种" onClick={() => { remove.reset(); setDeleteRow(row) }}><Trash2 className="size-3.5" /></Button>}
                  </div></TableCell>
                </TableRow>) : <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">暂无币种配置</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5">
          <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)} className="text-xs">{size} 条/页</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button>
        </div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) closeEditor() }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] max-w-xl gap-4 overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">{editor === 'create' ? '添加闪兑币种' : '修改闪兑币种'}</DialogTitle></DialogHeader>
        <form id="transit-walletcoin-form" className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate() }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs"><span>收款钱包</span><Select value={form.walletId} disabled={editor !== 'create'} onValueChange={value => setForm({ ...form, walletId: value })}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="选择钱包" /></SelectTrigger><SelectContent>{options.data?.wallets.map(wallet => <SelectItem key={wallet.rid} value={String(wallet.rid)} className="text-xs">#{wallet.rid} · {wallet.receive_wallet}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1 text-xs"><span>汇率方式</span><Select value={form.mode} onValueChange={value => setForm({ ...form, mode: value })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1" className="text-xs">实时 · 直减</SelectItem><SelectItem value="2" className="text-xs">固定汇率</SelectItem><SelectItem value="3" className="text-xs">实时 · 百分比</SelectItem></SelectContent></Select></label>
            <label className="space-y-1 text-xs"><span>转入币名</span><Select value={form.inCoin} onValueChange={value => setForm({ ...form, inCoin: value })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="trx" className="text-xs">TRX</SelectItem><SelectItem value="usdt" className="text-xs">USDT</SelectItem></SelectContent></Select></label>
            <label className="space-y-1 text-xs"><span>回款币名</span><Select value={form.outCoin} onValueChange={value => setForm({ ...form, outCoin: value })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="trx" className="text-xs">TRX</SelectItem><SelectItem value="usdt" className="text-xs">USDT</SelectItem></SelectContent></Select></label>
            <label className="space-y-1 text-xs"><span>实时汇率利润</span><Input inputMode="decimal" value={form.profitRate} onChange={event => setForm({ ...form, profitRate: event.target.value })} className="h-9 text-xs" /><span className="text-[10px] text-muted-foreground">比例值，例如 0.15 表示 15%</span></label>
            <label className="space-y-1 text-xs"><span>固定汇率</span><Input inputMode="decimal" value={form.exchangeRate} onChange={event => setForm({ ...form, exchangeRate: event.target.value })} className="h-9 text-xs" /></label>
            <label className="space-y-1 text-xs"><span>回款扣除手续费</span><Input inputMode="decimal" value={form.fee} onChange={event => setForm({ ...form, fee: event.target.value })} className="h-9 text-xs" /></label>
            <label className="space-y-1 text-xs"><span>最低转入</span><Input type="number" min="1" step="1" value={form.minimum} onChange={event => setForm({ ...form, minimum: event.target.value })} className="h-9 text-xs" /></label>
            <label className="space-y-1 text-xs"><span>最高转入</span><Input type="number" min="1" step="1" value={form.maximum} onChange={event => setForm({ ...form, maximum: event.target.value })} className="h-9 text-xs" /></label>
            <label className="space-y-1 text-xs sm:col-span-2"><span>备注</span><Textarea rows={2} maxLength={255} value={form.comments} onChange={event => setForm({ ...form, comments: event.target.value })} className="text-xs" /></label>
          </div>
          {save.error && <p role="alert" className="text-xs text-destructive">{save.error instanceof ApiError ? save.error.message : '保存失败，请重试'}</p>}
        </form>
        <DialogFooter><Button size="sm" variant="outline" disabled={save.isPending} onClick={closeEditor}>取消</Button><Button size="sm" type="submit" form="transit-walletcoin-form" disabled={save.isPending || !form.walletId}>{save.isPending ? '保存中…' : '保存'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!deleteRow} onOpenChange={open => { if (!open) { setDeleteRow(null); remove.reset() } }}>
      <DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">删除闪兑币种</DialogTitle></DialogHeader>
        <p className="text-xs">确定删除 {deleteRow?.in_coin_name.toUpperCase()} → {deleteRow?.out_coin_name.toUpperCase()} 配置吗？</p>
        {remove.error && <p role="alert" className="text-xs text-destructive">{remove.error instanceof ApiError ? remove.error.message : '删除失败，请重试'}</p>}
        <DialogFooter><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => setDeleteRow(null)}>取消</Button><Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? '删除中…' : '确认删除'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}>
      <DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent>
    </Dialog>
  </AdminShell>
}
