import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { api, ApiError } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

type BotOption = { rid: number; bot_firstname: string | null; bot_username: string | null }
type Row = { rid: number; bot_rid: number | null; bot_firstname: string | null; bot_username: string | null; token_configured: boolean; chain_type: string; monitor_wallet: string; status: number; tg_notice_obj: string | null; balance_alert: string; balance_amount: string; monitor_usdt_transaction: string; monitor_trx_transaction: string; monitor_approve_transaction: string; monitor_multi_transaction: string; monitor_pledge_transaction: string; comments: string | null; create_time: string | null; update_time: string | null }
type Permissions = { add: boolean; batchadd: boolean; update: boolean; delete: boolean; status: boolean }
type Data = { rows: Row[]; total: number; page: number; pageSize: number; permissions: Permissions }
type EventKey = typeof eventNames[number][1]
type Form = { bot_rid: string; chain_type: string; monitor_wallet: string; tg_notice_obj: string; balance_alert: string; comments: string; monitor_usdt_transaction: string; monitor_trx_transaction: string; monitor_approve_transaction: string; monitor_multi_transaction: string; monitor_pledge_transaction: string }
type Confirm = { action: 'delete'; row: Row } | { action: 'status'; row: Row; enabled: boolean }
const empty: Form = { bot_rid: '', chain_type: 'trc', monitor_wallet: '', tg_notice_obj: '', balance_alert: '0', comments: '', monitor_usdt_transaction: 'YY', monitor_trx_transaction: 'NN', monitor_approve_transaction: 'NN', monitor_multi_transaction: 'NN', monitor_pledge_transaction: 'NN' }
const eventNames = [['USDT', 'monitor_usdt_transaction', ['转入', '转出']], ['TRX', 'monitor_trx_transaction', ['转入', '转出']], ['授权', 'monitor_approve_transaction', ['授权', '取消授权']], ['多签', 'monitor_multi_transaction', ['钱包变更', '关联权限']], ['质押', 'monitor_pledge_transaction', ['代理', '回收']]] as const
function normalizeFlags(value: unknown) {
  const raw = String(value ?? 'NN').trim().toUpperCase()
  return raw.slice(0, 2).padEnd(2, 'N').replace(/[^YN]/g, 'N')
}

export function MonitorWalletsPage() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [bot, setBot] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'add' | Row | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [form, setForm] = useState<Form>(empty)
  const [batchText, setBatchText] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [feedback, setFeedback] = useState('')
  const query = useQuery({ queryKey: ['monitor-wallets', page, pageSize, search, bot], queryFn: () => api<Data>('/api/monitor-wallets?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, bot })), enabled: !!me.data, retry: false })
  const options = useQuery({ queryKey: ['monitor-wallet-options'], queryFn: () => api<{ bots: BotOption[] }>('/api/monitor-wallets?action=options'), enabled: !!me.data, staleTime: 60_000 })
  const mutation = useMutation({ mutationFn: (body: Record<string, unknown>) => api<{ message: string }>('/api/monitor-wallets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), onSuccess: async result => { setFeedback(result.message); setEditor(null); setBatchOpen(false); setConfirm(null); await client.invalidateQueries({ queryKey: ['monitor-wallets'] }) } })
  const rows = query.data?.rows || []
  const bots = options.data?.bots || []
  const pages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize))
  const permitted = query.data?.permissions
  const botLabel = (row: Pick<Row, 'bot_firstname' | 'bot_username' | 'bot_rid' | 'token_configured'>) => row.bot_firstname || (row.bot_username ? '@' + row.bot_username : row.bot_rid ? '机器人 #' + row.bot_rid : '未指定机器人')
  const openAdd = () => { setForm(empty); setEditor('add'); mutation.reset() }
  const openEdit = (row: Row) => { setForm({ bot_rid: row.bot_rid ? String(row.bot_rid) : '', chain_type: row.chain_type, monitor_wallet: row.monitor_wallet, tg_notice_obj: row.tg_notice_obj || '', balance_alert: row.balance_alert || '0', comments: row.comments || '', monitor_usdt_transaction: normalizeFlags(row.monitor_usdt_transaction), monitor_trx_transaction: normalizeFlags(row.monitor_trx_transaction), monitor_approve_transaction: normalizeFlags(row.monitor_approve_transaction), monitor_multi_transaction: normalizeFlags(row.monitor_multi_transaction), monitor_pledge_transaction: normalizeFlags(row.monitor_pledge_transaction) }); setEditor(row); mutation.reset() }
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); setPage(1) }
  const submit = (event: FormEvent) => { event.preventDefault(); const body = { ...form, bot_rid: form.bot_rid || null, action: editor === 'add' ? 'add' : 'update', ...(editor !== 'add' && editor ? { rid: editor.rid } : {}) }; mutation.mutate(body) }
  const apiError = (error: unknown) => error instanceof ApiError ? error.message : '请求失败，请稍后重试'
  const enabled = (status: number) => Number(status) === 0
  const flag = (value: string) => normalizeFlags(value).includes('Y')
  const setEventFlag = (key: EventKey, index: 0 | 1, checked: boolean) => setForm(current => { const pair = normalizeFlags(current[key]).split(''); pair[index] = checked ? 'Y' : 'N'; return { ...current, [key]: pair.join('') } })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-5 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" />TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=monitorWallets">管理员登录</a></Button></div></main>
  const error = query.error || options.error || mutation.error
  return <AdminShell user={me.data} title="监控钱包" activeRoute="admin.monitor.wallet.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={submitSearch}>
        <Select value={bot} onValueChange={value => { setBot(value); setPage(1) }}><SelectTrigger className="h-9 w-full text-xs sm:w-52"><SelectValue placeholder="全部机器人" /></SelectTrigger><SelectContent><SelectItem value="all">全部机器人</SelectItem>{bots.map(item => <SelectItem key={item.rid} value={String(item.rid)}>{item.bot_firstname || (item.bot_username ? '@' + item.bot_username : '机器人') + ' · #' + item.rid}</SelectItem>)}</SelectContent></Select>
        <div className="relative min-w-40 flex-1"><Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" /><Input aria-label="搜索监控钱包" placeholder="搜索钱包地址、ID 或备注" value={draft} onChange={event => setDraft(event.target.value)} className="h-9 pl-8 text-xs" maxLength={200} /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {permitted?.add && <Button type="button" size="sm" className="h-9" onClick={openAdd}><Plus className="mr-1 size-3.5" />添加</Button>}
        {permitted?.batchadd && <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => { setForm(empty); setBatchText(''); setBatchOpen(true); mutation.reset() }}>批量导入</Button>}
      </form>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{apiError(error)}</div>}
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-muted-foreground" />监控钱包</h1><span className="text-xs text-muted-foreground">共 {query.data?.total || 0} 条</span></header>
        <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1450px]"><TableHeader><TableRow>{['ID','通知机器人','链','监控地址','余额预警 / 当前余额','状态',...eventNames.map(item => item[0] + '监控'),'备注','通知对象','创建时间','修改时间','操作'].map(label => <TableHead key={label} className="h-9 px-3 text-xs">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{query.isPending ? <TableRow><TableCell colSpan={16} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow> : rows.length ? rows.map(row => <TableRow key={row.rid}>
            <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs"><div>{botLabel(row)}</div><div className="text-muted-foreground">{row.token_configured ? '令牌已配置' : '未配置令牌'}</div></TableCell><TableCell className="px-3 py-2 text-xs">{row.chain_type}</TableCell>
            <TableCell className="max-w-64 break-all px-3 py-2 font-mono text-[11px]">{row.monitor_wallet}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs"><div>{row.balance_alert} / {row.balance_amount}</div></TableCell>
            <TableCell className="px-3 py-2">{permitted?.status ? <Switch checked={enabled(row.status)} aria-label={'启用监控钱包 ' + row.rid} onCheckedChange={value => setConfirm({ action: 'status', row, enabled: value })} /> : <Badge variant="outline" className="text-[10px]">{enabled(row.status) ? '开启' : '关闭'}</Badge>}</TableCell>
            {eventNames.map(([label,key]) => <TableCell key={key} className="px-3 py-2"><Badge variant="outline" className={flag(row[key]) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'text-muted-foreground'}>{flag(row[key]) ? '开启' : '关闭'}</Badge></TableCell>)}
            <TableCell className="max-w-40 truncate px-3 py-2 text-xs" title={row.comments || ''}>{row.comments || '—'}</TableCell><TableCell className="max-w-40 truncate px-3 py-2 text-xs" title={row.tg_notice_obj || ''}>{row.tg_notice_obj || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-[11px]">{row.create_time || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-[11px]">{row.update_time || '—'}</TableCell>
            <TableCell className="px-3 py-2"><div className="flex gap-1">{permitted?.update && <Button variant="outline" size="icon" className="size-7" aria-label={'编辑钱包 ' + row.rid} onClick={() => openEdit(row)}><Pencil className="size-3.5" /></Button>}{permitted?.delete && <Button variant="outline" size="icon" className="size-7 text-destructive" aria-label={'删除钱包 ' + row.rid} onClick={() => { setConfirm({ action: 'delete', row }); mutation.reset() }}><Trash2 className="size-3.5" /></Button>}</div></TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={16} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}</TableBody>
        </Table></div>
        <div className="divide-y md:hidden">{query.isPending ? <p className="p-4 text-center text-xs text-muted-foreground">加载中…</p> : rows.length ? rows.map(row => <article key={row.rid} className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{botLabel(row)} <span className="font-mono text-[11px] text-muted-foreground">· #{row.rid}</span></p><p className="break-all font-mono text-[11px] text-muted-foreground">{row.chain_type} · {row.monitor_wallet}</p></div><div className="flex shrink-0 items-center gap-2">{permitted?.status ? <Switch checked={enabled(row.status)} aria-label={'启用监控钱包 ' + row.rid} onCheckedChange={value => setConfirm({ action: 'status', row, enabled: value })} /> : <Badge variant="outline">{enabled(row.status) ? '开启' : '关闭'}</Badge>}</div></div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">余额预警 / 当前余额</dt><dd>{row.balance_alert} / {row.balance_amount}</dd></div><div><dt className="text-muted-foreground">通知对象</dt><dd className="break-all">{row.tg_notice_obj || '—'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">交易监控</dt><dd className="mt-1 flex flex-wrap gap-1">{eventNames.map(([label,key]) => <Badge key={key} variant="outline" className="text-[10px]">{label} {flag(row[key]) ? '开' : '关'}</Badge>)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">备注</dt><dd className="break-words">{row.comments || '—'}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd>{row.create_time || '—'}</dd></div><div><dt className="text-muted-foreground">修改时间</dt><dd>{row.update_time || '—'}</dd></div></dl>
          <div className="flex justify-end gap-1">{permitted?.update && <Button size="sm" variant="outline" className="h-8" onClick={() => openEdit(row)}><Pencil className="mr-1 size-3.5" />编辑</Button>}{permitted?.delete && <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={() => { setConfirm({ action: 'delete', row }); mutation.reset() }}><Trash2 className="mr-1 size-3.5" />删除</Button>}</div>
        </article>) : <p className="p-5 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
        <footer className="flex items-center justify-between gap-2 border-t px-3 py-2"><span className="text-[11px] text-muted-foreground">第 {page}/{pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10,15,20,30,50,100].map(size => <SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) setEditor(null) }}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle className="text-base">{editor === 'add' ? '添加监控钱包' : '编辑监控钱包'}</DialogTitle></DialogHeader>
      <form id="monitor-wallet-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label className="space-y-1 text-xs"><span>通知机器人</span><Select value={form.bot_rid || 'none'} onValueChange={value => setForm({ ...form, bot_rid: value === 'none' ? '' : value })}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="不指定" /></SelectTrigger><SelectContent><SelectItem value="none">不指定</SelectItem>{bots.map(item => <SelectItem key={item.rid} value={String(item.rid)}>{item.bot_firstname || (item.bot_username ? '@' + item.bot_username : '机器人') + ' · #' + item.rid}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1 text-xs"><span>链类型</span><Select value={form.chain_type} onValueChange={value => setForm({ ...form, chain_type: value })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="trc">TRC</SelectItem></SelectContent></Select></label>
        <label className="space-y-1 text-xs sm:col-span-2"><span>监控钱包地址</span><Input value={form.monitor_wallet} onChange={event => setForm({ ...form, monitor_wallet: event.target.value })} maxLength={200} className="h-9 font-mono text-xs" required /></label>
        <label className="space-y-1 text-xs"><span>余额预警金额</span><Input type="number" min="0" step="0.01" value={form.balance_alert} onChange={event => setForm({ ...form, balance_alert: event.target.value })} className="h-9 text-xs" required /></label>
        <label className="space-y-1 text-xs"><span>TG 通知对象</span><Input value={form.tg_notice_obj} onChange={event => setForm({ ...form, tg_notice_obj: event.target.value })} maxLength={200} placeholder="多个对象用英文逗号分隔" className="h-9 text-xs" /></label>
        <div className="space-y-2 rounded-lg border p-3 text-xs sm:col-span-2"><div className="font-medium">交易提醒</div>{eventNames.map(([label, key, choices]) => <div key={key} className="flex flex-wrap items-center justify-between gap-3 border-t py-2 first:border-0 first:pt-0 last:pb-0"><span>{label}</span><div className="flex gap-4">{choices.map((choice, index) => <label key={choice} className="flex items-center gap-2 text-muted-foreground"><Switch checked={normalizeFlags(form[key])[index] === 'Y'} onCheckedChange={checked => setEventFlag(key, index as 0 | 1, checked)} aria-label={label + choice} /><span>{choice}</span></label>)}</div></div>)}</div>
        <label className="space-y-1 text-xs sm:col-span-2"><span>备注</span><Input value={form.comments} onChange={event => setForm({ ...form, comments: event.target.value })} maxLength={100} className="h-9 text-xs" /></label>
        {mutation.error && <p role="alert" className="text-xs text-destructive sm:col-span-2">{apiError(mutation.error)}</p>}
      </form><DialogFooter><Button size="sm" variant="outline" onClick={() => setEditor(null)}>取消</Button><Button size="sm" type="submit" form="monitor-wallet-form" disabled={mutation.isPending}>{mutation.isPending ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={batchOpen} onOpenChange={setBatchOpen}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle className="text-base">批量导入监控钱包</DialogTitle></DialogHeader>
      <form id="monitor-wallet-batch-form" className="space-y-3" onSubmit={event => { event.preventDefault(); mutation.mutate({ action: 'batchadd', bot_rid: form.bot_rid || null, chain_type: form.chain_type || 'trc', tg_notice_obj: form.tg_notice_obj, balance_alert: form.balance_alert || '0', monitor_wallet: batchText }) }}>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>通知机器人</span><Select value={form.bot_rid || 'none'} onValueChange={value => setForm({ ...form, bot_rid: value === 'none' ? '' : value })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不指定</SelectItem>{bots.map(item => <SelectItem key={item.rid} value={String(item.rid)}>{item.bot_firstname || (item.bot_username ? '@' + item.bot_username : '机器人') + ' · #' + item.rid}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1 text-xs"><span>余额预警金额</span><Input type="number" min="0" step="0.01" value={form.balance_alert} onChange={event => setForm({ ...form, balance_alert: event.target.value })} className="h-9 text-xs" /></label><label className="space-y-1 text-xs sm:col-span-2"><span>TG 通知对象</span><Input value={form.tg_notice_obj} onChange={event => setForm({ ...form, tg_notice_obj: event.target.value })} maxLength={200} className="h-9 text-xs" /></label></div>
        <label className="block space-y-1 text-xs"><span>钱包地址，每行一条；备注可写在英文逗号后</span><Textarea value={batchText} onChange={event => setBatchText(event.target.value)} maxLength={500000} className="min-h-40 font-mono text-xs" placeholder={'T...地址,备注\nT...地址,备注'} required /></label>
        {mutation.error && <p role="alert" className="text-xs text-destructive">{apiError(mutation.error)}</p>}
      </form><DialogFooter><Button size="sm" variant="outline" onClick={() => setBatchOpen(false)}>取消</Button><Button size="sm" type="submit" form="monitor-wallet-batch-form" disabled={mutation.isPending || !batchText.trim()}>{mutation.isPending ? '导入中…' : '开始导入'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{confirm?.action === 'delete' ? '删除监控钱包？' : '修改监控状态？'}</DialogTitle></DialogHeader><p className="break-all font-mono text-xs text-muted-foreground">{confirm?.row.monitor_wallet}{confirm?.action === 'status' ? (confirm.enabled ? ' · 确认开启' : ' · 确认关闭') : ' · 删除后不可恢复'}</p>{mutation.error && <p role="alert" className="text-xs text-destructive">{apiError(mutation.error)}</p>}<DialogFooter><Button size="sm" variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button size="sm" variant={confirm?.action === 'delete' ? 'destructive' : 'default'} disabled={mutation.isPending} onClick={() => confirm && mutation.mutate(confirm.action === 'delete' ? { action: 'delete', rid: confirm.row.rid } : { action: 'status', rid: confirm.row.rid, enabled: confirm.enabled })}>{mutation.isPending ? '处理中…' : '确认'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
