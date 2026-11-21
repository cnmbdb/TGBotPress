import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ChevronLeft, ChevronRight, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'

type Row = {
  rid: number; bot_rid: number | null; bot_firstname: string | null; bot_username: string | null; chain_type: string
  receive_wallet: string; send_wallet: string; show_notes: string | null; status: number; enabled: boolean
  private_key_configured: boolean; tg_notice_obj_receive: string | null; tg_notice_obj_send: string | null
  get_tx_time: string | null; create_time: string | null; update_time: string | null
}
type Bot = { rid: number; bot_firstname: string | null; bot_username: string | null }
type Data = { rows: Row[]; total: number; page: number; pageSize: number; canAdd: boolean; canEdit: boolean; canManageKey: boolean; canDelete: boolean; canChangeStatus: boolean }
type Form = { botRid: string; receiveWallet: string; sendWallet: string; showNotes: string; receiveNotice: string; sendNotice: string; getTxTime: string }
type Payload = { action: 'create' | 'update'; rid?: number; bot_rid: number | null; chain_type: 'trc'; receive_wallet: string; send_wallet: string; show_notes: string; tg_notice_obj_receive: string; tg_notice_obj_send: string; get_tx_time: string }
type Intent = { kind: 'status'; row: Row; enabled: boolean } | { kind: 'delete'; row: Row }
const empty: Form = { botRid: '', receiveWallet: '', sendWallet: '', showNotes: '', receiveNotice: '', sendNotice: '', getTxTime: '' }
export const Route = createFileRoute('/console/transit-wallet')({ component: TransitWalletPage })

function TransitWalletPage() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me'), retry: false, staleTime: 60_000 })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  const [receiveDraft, setReceiveDraft] = useState(''), [sendDraft, setSendDraft] = useState(''), [receiveFilter, setReceiveFilter] = useState(''), [sendFilter, setSendFilter] = useState('')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15)
  const [editor, setEditor] = useState<'create' | Row | null>(null), [form, setForm] = useState<Form>(empty)
  const [intent, setIntent] = useState<Intent | null>(null), [keyRow, setKeyRow] = useState<Row | null>(null), [privateKey, setPrivateKey] = useState(''), [feedback, setFeedback] = useState('')
  const query = useQuery({
    queryKey: ['transit-wallet', page, pageSize, receiveFilter, sendFilter],
    queryFn: () => api<Data>('/api/transit-wallet?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), receive: receiveFilter, send: sendFilter })),
    enabled: !!me.data, retry: false,
  })
  const bots = useQuery({ queryKey: ['transit-wallet-bot-options'], queryFn: () => api<{ bots: Bot[] }>('/api/transit-wallet?action=options'), enabled: !!me.data, retry: false, staleTime: 60_000 })
  const mutation = useMutation({
    mutationFn: (body: Payload | { action: 'status'; rid: number; enabled: boolean } | { action: 'delete'; rid: number } | { action: 'private-key'; rid: number; send_wallet_privatekey: string }) => api<{ message: string }>('/api/transit-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: async result => { setFeedback(result.message); setEditor(null); setIntent(null); setKeyRow(null); setPrivateKey(''); await client.invalidateQueries({ queryKey: ['transit-wallet'] }) },
  })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" />TG Ultra</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=transitWallet">管理员登录</a></Button></section></main>
  const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize))
  const openEditor = (row?: Row) => { setForm(row ? { botRid: row.bot_rid ? String(row.bot_rid) : '', receiveWallet: row.receive_wallet, sendWallet: row.send_wallet, showNotes: row.show_notes || '', receiveNotice: row.tg_notice_obj_receive || '', sendNotice: row.tg_notice_obj_send || '', getTxTime: row.get_tx_time || '' } : { ...empty }); setEditor(row || 'create'); mutation.reset() }
  const closeEditor = () => { setEditor(null); mutation.reset() }
  const save = () => {
    if (!form.receiveWallet.trim() || !form.sendWallet.trim()) return
    mutation.mutate({ action: editor === 'create' ? 'create' : 'update', ...(editor && editor !== 'create' ? { rid: editor.rid } : {}), bot_rid: form.botRid ? Number(form.botRid) : null, chain_type: 'trc', receive_wallet: form.receiveWallet.trim(), send_wallet: form.sendWallet.trim(), show_notes: form.showNotes.trim(), tg_notice_obj_receive: form.receiveNotice.trim(), tg_notice_obj_send: form.sendNotice.trim(), get_tx_time: form.getTxTime })
  }
  const applyIntent = () => { if (!intent) return; mutation.mutate(intent.kind === 'status' ? { action: 'status', rid: intent.row.rid, enabled: intent.enabled } : { action: 'delete', rid: intent.row.rid }) }
  return <AdminShell user={me.data} title="闪兑钱包" activeRoute="admin.transit.wallet.index" onRefresh={() => query.refetch()} onLogout={() => logout.mutate()}>
    <main className="space-y-3 p-3 sm:p-4">
      <form className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3" onSubmit={event => { event.preventDefault(); setReceiveFilter(receiveDraft.trim()); setSendFilter(sendDraft.trim()); setPage(1) }}>
        <div className="relative min-w-44 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={receiveDraft} onChange={event => setReceiveDraft(event.target.value)} maxLength={200} placeholder="收款钱包地址" className="h-9 pl-8 text-xs" /></div>
        <div className="relative min-w-44 flex-1"><Wallet className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={sendDraft} onChange={event => setSendDraft(event.target.value)} maxLength={200} placeholder="出款钱包地址" className="h-9 pl-8 text-xs" /></div>
        <Button size="sm" className="h-9"><Search className="mr-1 size-3.5" />搜索</Button>
        <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
        {query.data?.canAdd && <Button type="button" size="sm" className="h-9" onClick={() => openEditor()}><Plus className="mr-1 size-3.5" />添加钱包</Button>}
      </form>
      {query.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{query.error instanceof ApiError ? query.error.message : '加载失败，请重试'}</div>}
      <section className="overflow-hidden rounded-xl bg-card">
        <header className="flex h-11 items-center justify-between border-b px-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-muted-foreground" />闪兑钱包</h1><span className="text-xs text-muted-foreground">共 {total} 条</span></header>
        <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1180px]">
          <TableHeader><TableRow>{['ID', '通知机器人', '收款钱包', '出款钱包', '说明', '私钥', '状态', '拉取起始时间', '创建时间', '修改时间', '操作'].map(label => <TableHead key={label} className="h-9 px-3">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{query.isPending ? <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>
            : query.data?.rows.length ? query.data.rows.map(row => <TableRow key={row.rid}>
              <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell>
              <TableCell className="max-w-36 px-3 py-2 text-xs"><div className="truncate">{row.bot_firstname || '—'}</div><div className="truncate text-muted-foreground">{row.bot_username ? `@${row.bot_username}` : '未绑定'}</div></TableCell>
              <TableCell className="max-w-56 break-all px-3 py-2 font-mono text-[11px]">{row.receive_wallet}</TableCell><TableCell className="max-w-56 break-all px-3 py-2 font-mono text-[11px]">{row.send_wallet}</TableCell>
              <TableCell className="max-w-36 truncate px-3 py-2 text-xs" title={row.show_notes || ''}>{row.show_notes || '—'}</TableCell>
              <TableCell className="px-3 py-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${row.private_key_configured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{row.private_key_configured && <BadgeCheck className="size-3" />}{row.private_key_configured ? '已配置' : '未配置'}</span></TableCell>
              <TableCell className="px-3 py-2">{query.data.canChangeStatus ? <div className="flex items-center gap-2"><Switch checked={row.enabled} aria-label={`钱包 ${row.rid} 状态`} onCheckedChange={enabled => { mutation.reset(); setIntent({ kind: 'status', row, enabled }) }} /><span className={`text-[11px] ${row.enabled ? 'text-emerald-700' : 'text-muted-foreground'}`}>{row.enabled ? '开启' : '关闭'}</span></div> : <span className="text-xs">{row.enabled ? '开启' : '关闭'}</span>}</TableCell>
              <TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.get_tx_time?.replace('T', ' ') || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.create_time || '—'}</TableCell><TableCell className="whitespace-nowrap px-3 py-2 text-xs">{row.update_time || '—'}</TableCell>
              <TableCell className="px-3 py-2"><div className="flex items-center gap-1">{query.data.canEdit && <Button size="icon" variant="ghost" className="size-7" aria-label="编辑闪兑钱包" onClick={() => openEditor(row)}><Pencil className="size-3.5" /></Button>}{query.data.canManageKey && <Button size="icon" variant="ghost" className="size-7" aria-label="更新出款私钥" onClick={() => { mutation.reset(); setPrivateKey(''); setKeyRow(row) }}><KeyRound className="size-3.5" /></Button>}{query.data.canDelete && <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" aria-label="删除闪兑钱包" onClick={() => { mutation.reset(); setIntent({ kind: 'delete', row }) }}><Trash2 className="size-3.5" /></Button>}</div></TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">暂无闪兑钱包</TableCell></TableRow>}</TableBody>
        </Table></div>
        <div className="divide-y md:hidden">
          {query.isPending ? <p className="py-10 text-center text-xs text-muted-foreground">加载中…</p> : query.data?.rows.length ? query.data.rows.map(row => <article key={row.rid} className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-semibold">钱包 #{row.rid}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.bot_firstname || '未绑定'}{row.bot_username ? ` · @${row.bot_username}` : ''}</p></div>
              {query.data.canChangeStatus ? <div className="flex shrink-0 items-center gap-2"><Switch checked={row.enabled} aria-label={`钱包 ${row.rid} 状态`} onCheckedChange={enabled => { mutation.reset(); setIntent({ kind: 'status', row, enabled }) }} /><span className={`text-[11px] ${row.enabled ? 'text-emerald-700' : 'text-muted-foreground'}`}>{row.enabled ? '开启' : '关闭'}</span></div> : <span className="text-xs text-muted-foreground">{row.enabled ? '开启' : '关闭'}</span>}
            </div>
            <dl className="grid gap-x-3 gap-y-2 text-xs sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">收款钱包</dt><dd className="break-all font-mono text-[11px]">{row.receive_wallet}</dd></div>
              <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">出款钱包</dt><dd className="break-all font-mono text-[11px]">{row.send_wallet}</dd></div>
              <div><dt className="text-muted-foreground">私钥</dt><dd>{row.private_key_configured ? '已配置' : '未配置'}</dd></div>
              <div><dt className="text-muted-foreground">拉取起始时间</dt><dd>{row.get_tx_time?.replace('T', ' ') || '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">说明</dt><dd className="break-words">{row.show_notes || '—'}</dd></div>
              <div><dt className="text-muted-foreground">创建时间</dt><dd>{row.create_time || '—'}</dd></div>
              <div><dt className="text-muted-foreground">修改时间</dt><dd>{row.update_time || '—'}</dd></div>
            </dl>
            {(query.data.canEdit || query.data.canManageKey || query.data.canDelete) && <div className="flex flex-wrap gap-1.5 border-t pt-2">
              {query.data.canEdit && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEditor(row)}><Pencil className="mr-1 size-3.5" />编辑</Button>}
              {query.data.canManageKey && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { mutation.reset(); setPrivateKey(''); setKeyRow(row) }}><KeyRound className="mr-1 size-3.5" />更新私钥</Button>}
              {query.data.canDelete && <Button size="sm" variant="outline" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => { mutation.reset(); setIntent({ kind: 'delete', row }) }}><Trash2 className="mr-1 size-3.5" />删除</Button>}
            </div>}
          </article>) : <p className="py-10 text-center text-xs text-muted-foreground">暂无闪兑钱包</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 50, 100].map(size => <SelectItem key={size} value={String(size)} className="text-xs">{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-3.5" /></Button></div></footer>
      </section>
    </main>
    <Dialog open={!!editor} onOpenChange={open => { if (!open) closeEditor() }}><DialogContent aria-describedby={undefined} className="max-w-xl"><DialogHeader><DialogTitle className="text-base">{editor === 'create' ? '添加闪兑钱包' : '编辑闪兑钱包'}</DialogTitle></DialogHeader>
      <form id="transit-wallet-form" className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); save() }}>
        <label className="space-y-1 text-xs"><span>通知机器人</span><Select value={form.botRid || 'none'} onValueChange={value => setForm({ ...form, botRid: value === 'none' ? '' : value })}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="不绑定" /></SelectTrigger><SelectContent><SelectItem value="none">不绑定</SelectItem>{bots.data?.bots.map(bot => <SelectItem key={bot.rid} value={String(bot.rid)}>{bot.bot_firstname || `机器人 #${bot.rid}`} {bot.bot_username ? `(@${bot.bot_username})` : ''}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1 text-xs"><span>链类型</span><Input value="TRC" disabled className="h-9 text-xs" /></label>
        <label className="space-y-1 text-xs"><span>收款钱包地址</span><Input required maxLength={200} value={form.receiveWallet} onChange={event => setForm({ ...form, receiveWallet: event.target.value })} className="h-9 font-mono text-xs" /></label>
        <label className="space-y-1 text-xs"><span>出款钱包地址</span><Input required maxLength={200} value={form.sendWallet} onChange={event => setForm({ ...form, sendWallet: event.target.value })} className="h-9 font-mono text-xs" /></label>
        <label className="space-y-1 text-xs"><span>显示说明</span><Input maxLength={500} value={form.showNotes} onChange={event => setForm({ ...form, showNotes: event.target.value })} className="h-9 text-xs" /></label>
        <label className="space-y-1 text-xs"><span>开始拉取交易时间</span><Input type="datetime-local" step="60" value={form.getTxTime || ''} onChange={event => setForm({ ...form, getTxTime: event.target.value })} className="h-9 text-xs" /></label>
        <label className="space-y-1 text-xs"><span>TG 收款通知对象</span><Input maxLength={200} value={form.receiveNotice} onChange={event => setForm({ ...form, receiveNotice: event.target.value })} className="h-9 text-xs" /></label>
        <label className="space-y-1 text-xs"><span>TG 出款通知对象</span><Input maxLength={200} value={form.sendNotice} onChange={event => setForm({ ...form, sendNotice: event.target.value })} className="h-9 text-xs" /></label>
        {mutation.error && editor && <p role="alert" className="text-xs text-destructive sm:col-span-2">{mutation.error instanceof ApiError ? mutation.error.message : '保存失败，请重试'}</p>}
      </form><DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={closeEditor}>取消</Button><Button size="sm" type="submit" form="transit-wallet-form" disabled={mutation.isPending || !form.receiveWallet.trim() || !form.sendWallet.trim()}>{mutation.isPending ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!keyRow} onOpenChange={open => { if (!open) { setKeyRow(null); setPrivateKey(''); mutation.reset() } }}><DialogContent aria-describedby={undefined} className="max-w-md"><DialogHeader><DialogTitle className="text-base">更新出款私钥</DialogTitle></DialogHeader><div className="space-y-3"><p className="break-all font-mono text-[11px] text-muted-foreground">{keyRow?.send_wallet}</p><label className="block space-y-1 text-xs"><span>新私钥</span><Input autoComplete="new-password" type="password" value={privateKey} onChange={event => setPrivateKey(event.target.value)} maxLength={4000} className="h-9 font-mono text-xs" /></label><p className="text-[11px] text-muted-foreground">私钥在服务端使用 RSA 加密保存，已保存的私钥不会显示。</p>{mutation.error && keyRow && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '更新失败，请重试'}</p>}</div><DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { setKeyRow(null); setPrivateKey(''); mutation.reset() }}>取消</Button><Button size="sm" disabled={mutation.isPending || !privateKey.trim()} onClick={() => keyRow && mutation.mutate({ action: 'private-key', rid: keyRow.rid, send_wallet_privatekey: privateKey })}>{mutation.isPending ? '加密保存中…' : '保存新私钥'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!intent} onOpenChange={open => { if (!open) { setIntent(null); mutation.reset() } }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{intent?.kind === 'delete' ? '删除闪兑钱包' : intent?.enabled ? '启用闪兑钱包' : '关闭闪兑钱包'}</DialogTitle></DialogHeader><p className="break-all font-mono text-xs text-muted-foreground">{intent?.row.receive_wallet}</p>{intent?.kind === 'delete' && <p className="text-xs text-muted-foreground">仍关联闪兑币种时无法删除。</p>}{mutation.error && intent && <p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError ? mutation.error.message : '操作失败，请重试'}</p>}<DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { setIntent(null); mutation.reset() }}>取消</Button><Button size="sm" variant={intent?.kind === 'delete' ? 'destructive' : 'default'} disabled={mutation.isPending} onClick={applyIntent}>{mutation.isPending ? '处理中…' : '确认'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!feedback} onOpenChange={open => { if (!open) setFeedback('') }}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={() => setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
