import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, RefreshCw, Save, Users, Wallet, Pause, Play, Trash2, RotateCcw } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { CloneProxyTabs } from '@/components/cloneproxy-tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api, ApiError } from '@/lib/api'

type BotOption = { rid: number; bot_username: string | null; bot_firstname: string | null; recharge_wallet_configured: boolean }
type Config = { rid: number; master_bot_rid: number; is_enable: number; charge_enable: number; merchant_limit: number; open_price: number; default_revenue_ratio: number; active_count: number; idle_quantity: number | null }
type Data = { config: Config | null; bots: BotOption[] }
type Lifecycle = { state: 'active' | 'draining' | 'uninstalled' }
type Form = { master_bot_rid: string; is_enable: boolean; charge_enable: boolean; merchant_limit: string; open_price: string; default_revenue_ratio: string }
const blank: Form = { master_bot_rid: '', is_enable: false, charge_enable: false, merchant_limit: '0', open_price: '0', default_revenue_ratio: '0' }
const money = (value: number) => formatLocaleNumber(Number(value || 0), { maximumFractionDigits: 6 })

export const Route = createFileRoute('/console/cloneproxy-basic')({ component: CloneProxyBasic })
function CloneProxyBasic() {
  useLocale()
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me/'), retry: false, staleTime: 60_000 })
  const data = useQuery({ queryKey: ['cloneproxy', 'config'], queryFn: () => api<Data>('/api/cloneproxy', { headers: { 'x-cloneproxy-action': 'config' } }), enabled: !!me.data, retry: false })
  const lifecycle = useQuery({ queryKey: ['cloneproxy', 'lifecycle'], queryFn: () => api<Lifecycle>('/api/cloneproxy', { headers: { 'x-cloneproxy-action': 'lifecycle' } }), enabled: !!me.data, retry: false })
  const [form, setForm] = useState<Form>(blank), [feedback, setFeedback] = useState(''), [failure, setFailure] = useState('')
  useEffect(() => {
    const c = data.data?.config
    if (!c) return
    setForm({ master_bot_rid: String(c.master_bot_rid), is_enable: !!c.is_enable, charge_enable: !!c.charge_enable, merchant_limit: String(c.merchant_limit), open_price: String(c.open_price), default_revenue_ratio: String(c.default_revenue_ratio) })
  }, [data.data?.config])
  const save = useMutation({
    mutationFn: (body: object) => api<{ message: string }>('/api/cloneproxy/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: async result => { setFailure(''); setFeedback(result.message); await client.invalidateQueries({ queryKey: ['cloneproxy'] }) },
    onError: error => setFailure(error instanceof ApiError ? error.message : '保存失败，请重试'),
  })
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); location.assign('/console/home') } })
  const refresh = () => { void data.refetch() }
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6"><h1 className="font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=cloneProxyBasic">管理员登录</a></Button></section></main>
  const selected = data.data?.bots.find(bot => String(bot.rid) === form.master_bot_rid)
  const lifecycleAction = (action: 'lifecycle_disable'|'lifecycle_resume'|'lifecycle_uninstall'|'lifecycle_install') => {
    if (action === 'lifecycle_uninstall' && !window.confirm('卸载会保留业务数据，但需确认在途开户和收益已处理。继续检查并卸载？')) return
    save.mutate({ action })
  }
  const c = data.data?.config
  const name = (bot: BotOption) => bot.bot_firstname || (bot.bot_username ? '@' + bot.bot_username.replace(/^@/, '') : '机器人 #' + bot.rid)
  const submit = (event: FormEvent) => {
    event.preventDefault(); setFailure('')
    save.mutate({ action: 'config_save', master_bot_rid: Number(form.master_bot_rid), is_enable: form.is_enable, charge_enable: form.charge_enable, merchant_limit: form.merchant_limit, open_price: form.open_price, default_revenue_ratio: form.default_revenue_ratio })
  }
  return <AdminShell user={me.data} title="克隆/代理基础设置" activeRoute="admin.telegram.cloneproxy.basic" onRefresh={refresh} onLogout={() => logout.mutate()}>
    <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <CloneProxyTabs active="admin.telegram.cloneproxy.basic" />
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div><div className="text-sm font-semibold">插件生命周期</div><div className="mt-1 text-xs text-muted-foreground">状态：{lifecycle.data?.state === 'active' ? '运行中' : lifecycle.data?.state === 'draining' ? '排空中（收益继续结算）' : lifecycle.data?.state === 'uninstalled' ? '已卸载' : '读取中'}</div></div>
        <div className="flex flex-wrap gap-2">
          {lifecycle.data?.state === 'active' && <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => lifecycleAction('lifecycle_disable')}><Pause className="mr-1.5 size-3.5"/>停用并排空</Button>}
          {lifecycle.data?.state === 'draining' && <><Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => lifecycleAction('lifecycle_resume')}><Play className="mr-1.5 size-3.5"/>恢复</Button><Button type="button" size="sm" variant="destructive" disabled={save.isPending} onClick={() => lifecycleAction('lifecycle_uninstall')}><Trash2 className="mr-1.5 size-3.5"/>安全卸载</Button></>}
          {lifecycle.data?.state === 'uninstalled' && <Button type="button" size="sm" disabled={save.isPending} onClick={() => lifecycleAction('lifecycle_install')}><RotateCcw className="mr-1.5 size-3.5"/>重新安装</Button>}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><Users className="size-4 text-muted-foreground" /><div><div className="text-[11px] text-muted-foreground">正常商户</div><div className="text-lg font-semibold">{c?.active_count ?? 0}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><Bot className="size-4 text-muted-foreground" /><div><div className="text-[11px] text-muted-foreground">剩余名额</div><div className="text-lg font-semibold">{c?.idle_quantity == null ? '不限' : c.idle_quantity}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><Wallet className="size-4 text-muted-foreground" /><div><div className="text-[11px] text-muted-foreground">主机器人充值地址</div><div className="text-sm font-medium">{selected ? (selected.recharge_wallet_configured ? '已配置' : '未配置') : '未选择'}</div></div></div>
      </section>
      <form onSubmit={submit} className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3"><h1 className="text-sm font-semibold">基础设置</h1><Button size="sm" disabled={save.isPending || !form.master_bot_rid}><Save className="mr-1.5 size-3.5" />{save.isPending ? '保存中' : '保存'}</Button></div>
        <div className="grid gap-x-6 gap-y-5 p-4 md:grid-cols-2">
          <label className="space-y-1.5 text-xs"><span className="font-medium">主机器人</span><Select value={form.master_bot_rid} onValueChange={value => setForm(current => ({ ...current, master_bot_rid: value }))}><SelectTrigger className="h-9"><SelectValue placeholder="选择主机器人" /></SelectTrigger><SelectContent>{(data.data?.bots || []).map(bot => <SelectItem key={bot.rid} value={String(bot.rid)}>{name(bot)}</SelectItem>)}</SelectContent></Select></label>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2"><div><div className="text-xs font-medium">启用克隆/代理</div><div className="text-[11px] text-muted-foreground">{form.is_enable ? '已启用' : '已关闭'}</div></div><Switch checked={form.is_enable} onCheckedChange={value => setForm(current => ({ ...current, is_enable: value }))} aria-label="启用克隆代理" /></div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2"><div><div className="text-xs font-medium">开户收费</div><div className="text-[11px] text-muted-foreground">{form.charge_enable ? '启用支付流程' : '直接提交 Token'}</div></div><Switch checked={form.charge_enable} onCheckedChange={value => setForm(current => ({ ...current, charge_enable: value }))} aria-label="启用开户收费" /></div>
          <label className="space-y-1.5 text-xs"><span className="font-medium">开户价格（USDT）</span><Input className="h-9" type="number" min="0" step="0.000001" value={form.open_price} disabled={!form.charge_enable} onChange={event => setForm(current => ({ ...current, open_price: event.target.value }))} /></label>
          <label className="space-y-1.5 text-xs"><span className="font-medium">默认收益比例（0%–150%）</span><Input className="h-9" type="number" min="0" max="150" step="0.01" value={form.default_revenue_ratio} onChange={event => setForm(current => ({ ...current, default_revenue_ratio: event.target.value }))} /></label>
          <label className="space-y-1.5 text-xs"><span className="font-medium">商户名额（0 为不限）</span><Input className="h-9" type="number" min="0" step="1" value={form.merchant_limit} onChange={event => setForm(current => ({ ...current, merchant_limit: event.target.value }))} /></label>
          <div className="self-end text-[11px] text-muted-foreground">当前开户价：{money(Number(form.open_price || 0))} USDT</div>
        </div>
        {failure && <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">{failure}</p>}
      </form>
      {feedback && <div role="status" className="rounded-lg border bg-card px-3 py-2 text-xs">{feedback}<Button variant="ghost" size="sm" className="ml-2 h-7" onClick={() => setFeedback('')}>关闭</Button></div>}
    </main>
  </AdminShell>
}
