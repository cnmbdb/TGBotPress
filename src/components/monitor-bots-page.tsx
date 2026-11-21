import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type BotOption = { rid: number; bot_firstname: string | null; bot_username: string | null }
type Row = { rid: number; bot_rid: number; bot_firstname: string | null; bot_username: string | null; token_configured: boolean; status: number; free_monitor_wallet: number; price_usdt_5: string; price_usdt_10: string; price_usdt_20: string; price_usdt_50: string; price_usdt_100: string; price_usdt_200: string; comments: string | null; create_time: string; update_time: string | null }
type Data = { rows: Row[]; total: number; page: number; pageSize: number; permissions: { add: boolean; update: boolean; delete: boolean; status: boolean } }
type Form = { bot_rid: string; free_monitor_wallet: string; price_usdt_5: string; price_usdt_10: string; price_usdt_20: string; price_usdt_50: string; price_usdt_100: string; price_usdt_200: string; comments: string }
type Confirm = { action: 'delete'; row: Row } | { action: 'status'; row: Row; enabled: boolean }
const empty: Form = { bot_rid: '', free_monitor_wallet: '4', price_usdt_5: '0', price_usdt_10: '0', price_usdt_20: '0', price_usdt_50: '0', price_usdt_100: '0', price_usdt_200: '0', comments: '' }

export const Route = createFileRoute('/console/monitor-bots')({ component: MonitorBotsPage })
export function MonitorBotsPage() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'add' | Row | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [feedback, setFeedback] = useState('')
  const query = useQuery({ queryKey: ['monitor-bots', page, pageSize, search], queryFn: () => api<Data>('/api/monitor-bots?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), search })), enabled: !!me.data, retry: false })
  const options = useQuery({ queryKey: ['monitor-bot-options'], queryFn: () => api<{ bots: BotOption[] }>('/api/monitor-bots?action=options'), enabled: !!me.data, staleTime: 60_000 })
  const mutation = useMutation({ mutationFn: (body: Record<string, unknown>) => api<{ message: string }>('/api/monitor-bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), onSuccess: async result => { setFeedback(result.message); setEditor(null); setConfirm(null); await client.invalidateQueries({ queryKey: ['monitor-bots'] }) } })
  const pages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize))
  const rows = query.data?.rows || []
  const bots = options.data?.bots || []
  const botLabel = (bot: BotOption) => (bot.bot_firstname || bot.bot_username || '机器人') + ' · #' + bot.rid
  const openAdd = () => { setForm(empty); setEditor('add'); mutation.reset() }
  const openEdit = (row: Row) => { setForm({ bot_rid: String(row.bot_rid), free_monitor_wallet: String(row.free_monitor_wallet ?? 4), price_usdt_5: row.price_usdt_5 || '0', price_usdt_10: row.price_usdt_10 || '0', price_usdt_20: row.price_usdt_20 || '0', price_usdt_50: row.price_usdt_50 || '0', price_usdt_100: row.price_usdt_100 || '0', price_usdt_200: row.price_usdt_200 || '0', comments: row.comments || '' }); setEditor(row); mutation.reset() }
  const save = () => { const body = { ...form, bot_rid: Number(form.bot_rid), free_monitor_wallet: Number(form.free_monitor_wallet || 0), action: editor === 'add' ? 'add' : 'update', ...(editor !== 'add' && editor ? { rid: editor.rid } : {}) }; mutation.mutate(body) }
  const submit = (event: FormEvent) => { event.preventDefault(); save() }
  const prices = (row: Row) => [['5 个', row.price_usdt_5], ['10 个', row.price_usdt_10], ['20 个', row.price_usdt_20], ['50 个', row.price_usdt_50], ['100 个', row.price_usdt_100], ['200 个', row.price_usdt_200]] as const
  const priceText = (row: Row) => prices(row).map(([label, value]) => label + '：' + value + ' USDT').join(' · ')
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-5 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4" />TG Ultra</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=monitorBots">管理员登录</a></Button></div></main>
  const error = query.error || options.error || mutation.error
  return <AdminShell user={me.data} title="机器人监控" activeRoute="admin.monitor.bot.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1) }}>
        <div className="relative min-w-44 flex-1"><Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" /><Input aria-label="搜索机器人监控" placeholder="搜索机器人、ID 或备注" value={draft} onChange={event => setDraft(event.target.value)} className="h-9 pl-8 text-xs" maxLength={200} /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {query.data?.permissions.add && <Button type="button" size="sm" className="h-9" onClick={openAdd}><Plus className="mr-1 size-3.5" />添加监控</Button>}
      </form>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error instanceof ApiError ? error.message : '加载失败，请稍后重试'}</div>}
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-muted-foreground" />机器人监控</h1><span className="text-xs text-muted-foreground">共 {query.data?.total || 0} 条</span></header>
        <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1100px]">
          <TableHeader><TableRow>{['ID', '通知机器人', '免费监控数', '监控包价格（USDT）', '状态', '备注', '创建时间', '修改时间', '操作'].map(label => <TableHead key={label} className="h-9 px-3 text-xs">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{query.isPending ? <TableRow><TableCell colSpan={9} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow> : rows.length ? rows.map(row => <TableRow key={row.rid}>
            <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell>
            <TableCell className="px-3 py-2 text-xs"><div>{row.bot_firstname || '机器人 #' + row.bot_rid}</div><div className="text-muted-foreground">{row.bot_username ? '@' + row.bot_username : row.token_configured ? '令牌已配置' : '未配置令牌'}</div></TableCell>
            <TableCell className="px-3 py-2 text-xs">{row.free_monitor_wallet}</TableCell>
            <TableCell className="max-w-[310px] px-3 py-2 text-xs"><div className="line-clamp-2">{priceText(row)}</div></TableCell>
            <TableCell className="px-3 py-2"><div className="flex items-center gap-2"><Switch checked={Number(row.status) === 0} disabled={!query.data?.permissions.status} aria-label={'启用机器人监控 ' + row.rid} onCheckedChange={enabled => { if (query.data?.permissions.status) setConfirm({ action: 'status', row, enabled }) }} /><span className="text-[11px] text-muted-foreground">{Number(row.status) === 0 ? '开启' : '关闭'}</span></div></TableCell>
            <TableCell className="max-w-44 truncate px-3 py-2 text-xs" title={row.comments || ''}>{row.comments || '—'}</TableCell>
            <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.create_time || '—'}</TableCell>
            <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.update_time || '—'}</TableCell>
            <TableCell className="px-3 py-2"><div className="flex items-center gap-1">{query.data?.permissions.update && <Button size="icon" variant="ghost" className="size-7" aria-label="编辑机器人监控" onClick={() => openEdit(row)}><Pencil className="size-3.5" /></Button>}{query.data?.permissions.delete && <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="删除机器人监控" onClick={() => { setConfirm({ action: 'delete', row }); mutation.reset() }}><Trash2 className="size-3.5" /></Button>}</div></TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={9} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}</TableBody>
        </Table></div>
        <div className="divide-y md:hidden">{query.isPending ? <p className="p-4 text-center text-xs text-muted-foreground">加载中…</p> : rows.length ? rows.map(row => <article key={row.rid} className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{row.bot_firstname || '机器人 #' + row.bot_rid}</p><p className="text-[11px] text-muted-foreground">{row.bot_username ? '@' + row.bot_username : '机器人 ID ' + row.bot_rid} · #{row.rid}</p></div><div className="flex items-center gap-2">{query.data?.permissions.status && <Switch checked={Number(row.status) === 0} aria-label={'启用机器人监控 ' + row.rid} onCheckedChange={enabled => setConfirm({ action: 'status', row, enabled })} />}<span className="text-[11px] text-muted-foreground">{Number(row.status) === 0 ? '开启' : '关闭'}</span></div></div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">免费监控数</dt><dd className="mt-0.5">{row.free_monitor_wallet}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd className="mt-0.5">{row.create_time || '—'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">套餐价格</dt><dd className="mt-0.5 break-words">{priceText(row)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">备注</dt><dd className="mt-0.5 break-words">{row.comments || '—'}</dd></div></dl>
          <div className="flex justify-end gap-1">{query.data?.permissions.update && <Button size="sm" variant="outline" className="h-8" onClick={() => openEdit(row)}><Pencil className="mr-1 size-3.5" />编辑</Button>}{query.data?.permissions.delete && <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={() => { setConfirm({ action: 'delete', row }); mutation.reset() }}><Trash2 className="mr-1 size-3.5" />删除</Button>}</div>
        </article>) : <p className="p-5 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
        <footer className="flex items-center justify-between gap-2 border-t px-3 py-2"><span className="text-[11px] text-muted-foreground">第 {page}/{pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) setEditor(null) }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle className="text-base">{editor === 'add' ? '添加机器人监控' : '修改机器人监控'}</DialogTitle></DialogHeader>
      <form id="monitor-bot-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label className="space-y-1 text-xs sm:col-span-2"><span>通知机器人</span><Select value={form.bot_rid} onValueChange={value => setForm({ ...form, bot_rid: value })}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="选择机器人" /></SelectTrigger><SelectContent>{bots.map(bot => <SelectItem key={bot.rid} value={String(bot.rid)}>{botLabel(bot)}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1 text-xs"><span>免费监控钱包数量</span><Input type="number" min="0" max="100000" value={form.free_monitor_wallet} onChange={event => setForm({ ...form, free_monitor_wallet: event.target.value })} className="h-9 text-xs" required /></label>
        {([['price_usdt_5', '5 个监控包'], ['price_usdt_10', '10 个监控包'], ['price_usdt_20', '20 个监控包'], ['price_usdt_50', '50 个监控包'], ['price_usdt_100', '100 个监控包'], ['price_usdt_200', '200 个监控包']] as const).map(([key, label]) => <label key={key} className="space-y-1 text-xs"><span>{label}（USDT）</span><Input type="number" min="0" step="0.0001" value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} className="h-9 font-mono text-xs" required /></label>)}
        <label className="space-y-1 text-xs sm:col-span-2"><span>备注</span><Textarea maxLength={3000} value={form.comments} onChange={event => setForm({ ...form, comments: event.target.value })} className="min-h-16 text-xs" /></label>
        {mutation.error && <p role="alert" className="text-xs text-destructive sm:col-span-2">{mutation.error instanceof ApiError ? mutation.error.message : '保存失败'}</p>}
      </form><DialogFooter><Button size="sm" variant="outline" onClick={() => setEditor(null)}>取消</Button><Button size="sm" form="monitor-bot-form" disabled={mutation.isPending || !form.bot_rid}>{mutation.isPending ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{confirm?.action === 'delete' ? '删除机器人监控？' : '修改监控状态？'}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{confirm?.row.bot_firstname || '机器人 #' + (confirm?.row.bot_rid || '')}{confirm?.action === 'status' ? (confirm.enabled ? ' · 确认开启' : ' · 确认关闭') : ' · 删除后不可恢复'}</p>{mutation.error && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '操作失败'}</p>}<DialogFooter><Button size="sm" variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button size="sm" variant={confirm?.action === 'delete' ? 'destructive' : 'default'} disabled={mutation.isPending} onClick={() => confirm && mutation.mutate(confirm.action === 'delete' ? { action: 'delete', rid: confirm.row.rid } : { action: 'status', rid: confirm.row.rid, enabled: confirm.enabled })}>{mutation.isPending ? '处理中…' : '确认'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
