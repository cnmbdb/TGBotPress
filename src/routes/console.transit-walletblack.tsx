import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'

type Row = { rid: number; chain_type: string; black_wallet: string; comments: string | null; create_time: string | null; update_time: string | null }
type Data = { rows: Row[]; total: number; page: number; pageSize: number; canAdd: boolean; canEdit: boolean; canDelete: boolean }
type Form = { blackWallet: string; comments: string }
const emptyForm: Form = { blackWallet: '', comments: '' }
export const Route = createFileRoute('/console/transit-walletblack')({ component: TransitWalletBlack })

function TransitWalletBlack() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState(''), [filter, setFilter] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'create' | Row | null>(null), [form, setForm] = useState<Form>(emptyForm)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null), [feedback, setFeedback] = useState('')
  const query = useQuery({
    queryKey: ['transit-walletblack', page, pageSize, filter],
    queryFn: () => api<Data>('/api/transit-walletblack?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), search: filter })),
    enabled: !!me.data, retry: false,
  })
  const save = useMutation({
    mutationFn: () => api<{ message: string }>('/api/transit-walletblack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: editor === 'create' ? 'create' : 'update', ...(editor === 'create' ? {} : { rid: editor?.rid }), chain_type: 'trc', black_wallet: form.blackWallet, comments: form.comments }),
    }),
    onSuccess: async result => { setEditor(null); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['transit-walletblack'] }) },
  })
  const remove = useMutation({
    mutationFn: () => api<{ message: string }>('/api/transit-walletblack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', rid: deleteRow?.rid }) }),
    onSuccess: async result => { setDeleteRow(null); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['transit-walletblack'] }) },
  })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4" />TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=transitWalletblack">管理员登录</a></Button></section></main>
  const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize))
  const openEditor = (row?: Row) => { setForm(row ? { blackWallet: row.black_wallet, comments: row.comments || '' } : { ...emptyForm }); setEditor(row || 'create'); save.reset() }
  const closeEditor = () => { setEditor(null); save.reset() }
  return <AdminShell user={me.data} title="闪兑黑钱包" activeRoute="admin.transit.walletblack.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setFilter(draft.trim()); setPage(1) }}>
        <div className="relative min-w-40 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} placeholder="搜索钱包地址" className="h-9 pl-8 text-xs" /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {query.data?.canAdd && <Button type="button" size="sm" className="h-9" onClick={() => openEditor()}><Plus className="mr-1 size-3.5" />添加黑名单</Button>}
      </form>
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"><AlertTriangle className="size-4 shrink-0" /><span>命中黑名单的钱包将跳过闪兑回款</span></div>
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-muted-foreground" />闪兑黑钱包</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></header>
        {query.error && <div role="alert" className="px-3 py-3 text-xs text-destructive">{query.error instanceof ApiError ? query.error.message : '加载失败，请重试'}</div>}
        <div className="space-y-2 p-2 md:hidden">{query.isPending ? <div className="py-8 text-center text-xs text-muted-foreground">加载中…</div> : query.data?.rows.length ? query.data.rows.map(row => <article key={row.rid} className="space-y-3 rounded-lg border p-3"><header className="flex items-center justify-between gap-2"><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{row.chain_type.toUpperCase()}</span><span className="font-mono text-[10px] text-muted-foreground">#{row.rid}</span></header><div className="break-all font-mono text-xs">{row.black_wallet}</div><dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-muted-foreground">备注</dt><dd className="break-words">{row.comments || '—'}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd>{row.create_time || '—'}</dd></div><div><dt className="text-muted-foreground">修改时间</dt><dd>{row.update_time || '—'}</dd></div></dl>{(query.data.canEdit || query.data.canDelete) && <div className="flex gap-1 border-t pt-2">{query.data.canEdit && <Button size="icon" variant="ghost" className="size-8" aria-label="修改黑钱包" onClick={() => openEditor(row)}><Pencil className="size-4" /></Button>}{query.data.canDelete && <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label="删除黑钱包" onClick={() => { remove.reset(); setDeleteRow(row) }}><Trash2 className="size-4" /></Button>}</div>}</article>) : <div className="py-8 text-center text-xs text-muted-foreground">暂无黑钱包记录</div>}</div>
        <div className="hidden overflow-x-auto md:block"><Table className="min-w-[780px]">
          <TableHeader><TableRow>{['ID', '链类型', '黑钱包地址', '备注', '创建时间', '修改时间', '操作'].map(label => <TableHead key={label} className="h-9 px-3">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {query.isPending ? <TableRow><TableCell colSpan={7} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>
              : query.data?.rows.length ? query.data.rows.map(row => <TableRow key={row.rid}>
                <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell>
                <TableCell className="px-3 py-2"><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{row.chain_type.toUpperCase()}</span></TableCell>
                <TableCell className="max-w-72 break-all px-3 py-2 font-mono text-xs">{row.black_wallet}</TableCell>
                <TableCell className="max-w-48 truncate px-3 py-2 text-xs" title={row.comments || ''}>{row.comments || '—'}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.create_time || '—'}</TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.update_time || '—'}</TableCell>
                <TableCell className="px-3 py-2"><div className="flex items-center gap-1">
                  {query.data.canEdit && <Button size="icon" variant="ghost" className="size-7" aria-label="修改黑钱包" onClick={() => openEditor(row)}><Pencil className="size-3.5" /></Button>}
                  {query.data.canDelete && <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" aria-label="删除黑钱包" onClick={() => { remove.reset(); setDeleteRow(row) }}><Trash2 className="size-3.5" /></Button>}
                </div></TableCell>
              </TableRow>) : <TableRow><TableCell colSpan={7} className="h-20 text-center text-xs text-muted-foreground">暂无黑钱包记录</TableCell></TableRow>}
          </TableBody>
        </Table></div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5">
          <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)} className="text-xs">{size} 条/页</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button>
        </div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) closeEditor() }}><DialogContent aria-describedby={undefined} className="max-w-md">
      <DialogHeader><DialogTitle className="text-base">{editor === 'create' ? '添加黑钱包' : '修改黑钱包'}</DialogTitle></DialogHeader>
      <form id="transit-walletblack-form" className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate() }}>
        <div className="grid gap-3"><label className="space-y-1 text-xs"><span>链类型</span><Select value="trc" disabled><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="trc">TRC20</SelectItem></SelectContent></Select></label>
          <label className="space-y-1 text-xs"><span>黑钱包地址</span><Input required maxLength={200} value={form.blackWallet} onChange={event => setForm({ ...form, blackWallet: event.target.value })} className="h-9 font-mono text-xs" /></label>
          <label className="space-y-1 text-xs"><span>备注</span><Input maxLength={255} value={form.comments} onChange={event => setForm({ ...form, comments: event.target.value })} className="h-9 text-xs" /></label></div>
        {save.error && <p role="alert" className="text-xs text-destructive">{save.error instanceof ApiError ? save.error.message : '保存失败，请重试'}</p>}
      </form>
      <DialogFooter><Button size="sm" variant="outline" disabled={save.isPending} onClick={closeEditor}>取消</Button><Button size="sm" type="submit" form="transit-walletblack-form" disabled={save.isPending || !form.blackWallet.trim()}>{save.isPending ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!deleteRow} onOpenChange={open => { if (!open) { setDeleteRow(null); remove.reset() } }}><DialogContent aria-describedby={undefined} className="max-w-sm">
      <DialogHeader><DialogTitle className="text-base">移除黑名单</DialogTitle></DialogHeader><p className="break-all font-mono text-xs">{deleteRow?.black_wallet}</p>
      {remove.error && <p role="alert" className="text-xs text-destructive">{remove.error instanceof ApiError ? remove.error.message : '删除失败，请重试'}</p>}
      <DialogFooter><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => setDeleteRow(null)}>取消</Button><Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? '移除中…' : '确认移除'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
