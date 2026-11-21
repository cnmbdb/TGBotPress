import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, Check, CircleAlert, Clock3, Laptop, LoaderCircle, Mail, MonitorSmartphone, RefreshCw, Shield, ShieldCheck, Smartphone, X } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { CloudflareSettingsPanel } from "@/components/cloudflare-settings-panel"
import { PasskeyPanel } from "@/components/passkey-panel"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api"

type Method = "captcha" | "email" | "claw" | "turnstile"
type LoginSettings = { ip_whitelist_enabled: boolean; ip_whitelist: string; verification_enabled: boolean; verification_methods: Method[]; verification_method: Method; session_lifetime_minutes: number }
type SecurityData = { settings: LoginSettings; logs: { rid: number; time: string | null; location: string; deviceIp: string; publicIp: string; deviceType: string }[]; devices: { rid: string; ip: string; loginTime: string; lastSeenAt: string; expiresAt: string; deviceType: string; userAgent: string; current: boolean }[]; email: { address: string; verified: boolean; mailReady: boolean; allAdminsVerified: boolean }; passkey: { settings: Record<string, unknown>; credentials: { rid: string; name: string; rp_id: string; created_at: string; last_used_at: string | null }[]; available: boolean }; currentIp: string | null; clientIpTrusted: boolean; canManage: boolean }
type Identity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
type Notice = { text: string; error: boolean }
const methodOptions: { id: Method; label: string }[] = [
  { id: "captcha", label: "图形验证码" }, { id: "email", label: "邮箱验证码" }, { id: "claw", label: "抓娃娃验证" }, { id: "turnstile", label: "Turnstile" },
]
const lifetimeOptions = [{ value: 30, label: "30 分钟" }, { value: 120, label: "2 小时" }, { value: 480, label: "8 小时" }, { value: 1440, label: "24 小时" }, { value: 10080, label: "7 天" }, { value: 43200, label: "30 天" }]
export const Route = createFileRoute("/console/settings-security")({ component: SecuritySettingsPage })

function SecuritySettingsPage() {
  useLocale()
  const client = useQueryClient()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [activityId, setActivityId] = useState<number | null>(null)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Identity>("/api/me/"), retry: false, staleTime: 60_000 })
  const data = useQuery({ queryKey: ["security-settings"], queryFn: () => api<SecurityData>("/api/settings-security"), enabled: !!me.data, retry: false, staleTime: 15_000 })
  const [form, setForm] = useState<LoginSettings | null>(null)
  const [whitelistOpen, setWhitelistOpen] = useState(false)
  const [emailAddress, setEmailAddress] = useState<string | null>(null)
  const [emailPassword, setEmailPassword] = useState("")
  const [emailCode, setEmailCode] = useState("")
  useEffect(() => { if (data.data?.settings) setForm(data.data.settings) }, [data.data?.settings])
  const activity = useQuery({ queryKey: ["security-activity", activityId], queryFn: () => api<{ login: Record<string, string>; operations: { opt_time: string; opt_module: string; opt_content: string }[] }>(`/api/settings-security?activity=${activityId}`), enabled: activityId !== null })
  const save = useMutation({
    mutationFn: (settings: Partial<LoginSettings>) => api<{ message: string }>("/api/settings-security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-settings", ...settings }) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); await client.invalidateQueries({ queryKey: ["security-settings"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "保存失败", error: true }),
  })
  const sendEmailCode = useMutation({
    mutationFn: () => api<{ message: string }>("/api/settings-security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send-email-code", email: emailAddress ?? "", password: emailPassword }) }),
    onSuccess: result => setNotice({ text: result.message, error: false }),
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "验证码发送失败", error: true }),
  })
  const confirmEmail = useMutation({
    mutationFn: () => api<{ message: string }>("/api/settings-security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm-email", code: emailCode }) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); setEmailPassword(""); setEmailCode(""); await client.invalidateQueries({ queryKey: ["security-settings"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "邮箱验证失败", error: true }),
  })
  const revoke = useMutation({
    mutationFn: (rid: string) => api<{ message: string; isCurrent: boolean }>("/api/settings-security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke-device", rid }) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); if (result.isCurrent) { client.clear(); location.assign("/console/home"); return } await client.invalidateQueries({ queryKey: ["security-settings"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "设备下线失败", error: true }),
  })
  const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => { client.clear(); location.assign("/console/home") } })
  const refresh = () => { setNotice(null); void data.refetch() }
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><LoaderCircle className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm rounded-xl border bg-card p-5"><h1 className="mb-3 text-sm font-semibold">登录管理后台</h1><Button asChild size="sm"><a href="/api/auth/start?destination=settingsSecurity">管理员登录</a></Button></section></main>
  const settings = form || data.data?.settings
  const patch = (values: Partial<LoginSettings>) => setForm(current => current ? { ...current, ...values } : current)
  const persist = (values: Partial<LoginSettings>) => { setNotice(null); save.mutate(values) }
  return <AdminShell user={me.data} title="安全设置" activeRoute="admin.setting.security.index" onRefresh={refresh} onLogout={() => logout.mutate()}>
    <main className="mx-auto grid max-w-6xl gap-3 p-3 sm:p-5">
      {(notice || data.isError) && <div role={notice?.error || data.isError ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice?.error || data.isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}>
        {notice?.error || data.isError ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />}{notice?.text || (data.error instanceof ApiError ? data.error.message : "安全设置读取失败")}<Button className="ml-auto" size="icon" variant="ghost" onClick={refresh} aria-label="重新加载"><RefreshCw className="size-3.5" /></Button>
      </div>}
      {data.isPending && <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载安全设置…</div>}
      {settings && <>
        <section className="grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Shield className="size-4 text-muted-foreground" />登录白名单 IP</h2><div className="flex items-center gap-2"><Switch checked={settings.ip_whitelist_enabled} disabled={!data.data?.canManage || save.isPending} onCheckedChange={checked => { setWhitelistOpen(checked); if (checked && !settings.ip_whitelist.trim()) { setNotice({ text: "请填写并保存 IP 后再开启白名单", error: true }); return } persist({ ip_whitelist_enabled: checked, ip_whitelist: settings.ip_whitelist }) }} aria-label="登录白名单 IP 限制" /></div></div>
            {(settings.ip_whitelist_enabled || whitelistOpen) && <div className="mt-3 space-y-2 border-t pt-3"><Textarea className="min-h-20 text-xs" value={settings.ip_whitelist} onChange={event => patch({ ip_whitelist: event.target.value })} onBlur={() => { if (settings.ip_whitelist !== data.data?.settings.ip_whitelist && !save.isPending) persist({ ip_whitelist: settings.ip_whitelist }) }} placeholder="每行一个 IP 地址" disabled={!data.data?.canManage} /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">当前 IP：{data.data?.currentIp || "未识别"}</span></div></div>}
          </article>
          <article className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-muted-foreground" />登录验证</h2><div className="flex items-center gap-2"><Switch checked={settings.verification_enabled} disabled={!data.data?.canManage || save.isPending} onCheckedChange={checked => persist({ verification_enabled: checked })} aria-label="登录验证" /></div></div>
            {settings.verification_enabled && <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">{methodOptions.map(option => <label key={option.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${settings.verification_methods.includes(option.id) ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"}`}><Checkbox checked={settings.verification_methods.includes(option.id)} disabled={!data.data?.canManage || save.isPending || (option.id === "email" && !data.data?.email.mailReady)} onCheckedChange={checked => { const current = settings.verification_methods; const next = checked ? [...current, option.id] : current.filter(method => method !== option.id); if (next.length) persist({ verification_methods: next }) }} /><span className="font-medium">{option.label}</span>{option.id === "email" && !data.data?.email.mailReady && <span className="ml-auto text-[10px] text-muted-foreground">邮件未配置</span>}</label>)}<div className="flex items-center justify-between gap-2 sm:col-span-2"><span className="text-[11px] text-muted-foreground">{settings.verification_methods.map(method => methodOptions.find(item => item.id === method)?.label).join("、") || "请选择验证方式"}</span></div></div>}
          </article>
        </section>
        <CloudflareSettingsPanel />
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Mail className="size-4 text-muted-foreground" />安全邮箱</h2><span className={`rounded-full px-2 py-1 text-[11px] ${data.data?.email.verified ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{data.data?.email.verified ? "已验证" : "未验证"}</span></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input className="h-9 text-xs" type="email" autoComplete="email" value={emailAddress ?? data.data?.email.address ?? ""} onChange={event => setEmailAddress(event.target.value)} placeholder={data.data?.email.address || "管理员邮箱"} aria-label="管理员邮箱" />
            <Input className="h-9 text-xs" type="password" autoComplete="current-password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} placeholder="当前管理员密码" aria-label="当前管理员密码" />
            <Button size="sm" className="h-9" disabled={!data.data?.email.mailReady || !(emailAddress ?? data.data?.email.address ?? "").trim() || !emailPassword || sendEmailCode.isPending} onClick={() => sendEmailCode.mutate()}>{sendEmailCode.isPending ? "发送中" : "发送验证码"}</Button>
            <Input className="h-9 text-xs sm:col-start-1" inputMode="numeric" maxLength={6} value={emailCode} onChange={event => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位验证码" aria-label="6 位验证码" />
            <Button size="sm" variant="outline" className="h-9 sm:col-start-2" disabled={emailCode.length !== 6 || confirmEmail.isPending} onClick={() => confirmEmail.mutate()}>{confirmEmail.isPending ? "验证中" : "确认绑定"}</Button>
            {!data.data?.email.mailReady && <span className="self-center text-[11px] text-muted-foreground sm:col-start-3">邮件服务未配置</span>}
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-muted-foreground" />登录日志</h2><span className="text-xs text-muted-foreground">{data.data?.logs.length || 0} 条</span></div>
          <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr>{["时间", "地点", "设备 IP", "公网 IP", "设备类型", ""].map(label => <th key={label} className="px-3 py-2.5 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y">{data.data?.logs.map(log => <tr key={log.rid} className="hover:bg-muted/30"><td className="whitespace-nowrap px-3 py-2.5">{formatDate(log.time)}</td><td className="px-3 py-2.5">{log.location}</td><td className="px-3 py-2.5 font-mono">{log.deviceIp}</td><td className="px-3 py-2.5 font-mono">{log.publicIp}</td><td className="px-3 py-2.5">{log.deviceType}</td><td className="px-3 py-2.5 text-right"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setActivityId(log.rid)}>操作日志</Button></td></tr>)}{!data.data?.logs.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">暂无登录记录</td></tr>}</tbody></table></div>
          <div className="divide-y sm:hidden">{data.data?.logs.map(log => <article key={log.rid} className="space-y-2.5 p-3"><div className="flex items-center justify-between gap-2"><time className="text-xs font-medium">{formatDate(log.time)}</time><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setActivityId(log.rid)}>操作日志</Button></div><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div className="min-w-0"><dt className="text-[10px] text-muted-foreground">地点</dt><dd className="mt-0.5 truncate">{log.location}</dd></div><div className="min-w-0"><dt className="text-[10px] text-muted-foreground">设备类型</dt><dd className="mt-0.5 truncate">{log.deviceType}</dd></div><div className="min-w-0"><dt className="text-[10px] text-muted-foreground">设备 IP</dt><dd className="mt-0.5 break-all font-mono">{log.deviceIp}</dd></div><div className="min-w-0"><dt className="text-[10px] text-muted-foreground">公网 IP</dt><dd className="mt-0.5 break-all font-mono">{log.publicIp}</dd></div></dl></article>)}{!data.data?.logs.length && <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无登录记录</div>}</div>
        </section>
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><MonitorSmartphone className="size-4 text-muted-foreground" />在线设备 <span className="font-normal text-muted-foreground">{data.data?.devices.length || 0}</span></h2><label className="flex items-center gap-2 text-xs text-muted-foreground">保持登录<Select value={String(settings.session_lifetime_minutes)} onValueChange={value => persist({ session_lifetime_minutes: Number(value) })} disabled={!data.data?.canManage || save.isPending}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent>{lifetimeOptions.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select></label></div>
          <div className="divide-y">{data.data?.devices.map(device => <div key={device.rid} className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{device.deviceType.includes("手机") ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs font-medium">{device.deviceType}{device.current && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">当前设备</span>}</div><div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground"><span>IP {device.ip}</span><span>登录 {formatDate(device.loginTime)}</span><span>最近活动 {formatDate(device.lastSeenAt)}</span><span>到期 {formatDate(device.expiresAt)}</span></div></div><Button variant="outline" size="sm" className="h-8 text-destructive hover:text-destructive" disabled={revoke.isPending} onClick={() => { if (window.confirm("确认强制下线此设备？")) revoke.mutate(device.rid) }}><X className="mr-1 size-3.5" />强制下线</Button></div>)}{!data.data?.devices.length && <div className="px-4 py-8 text-center text-xs text-muted-foreground">暂无在线设备</div>}</div>
        </section>
        <PasskeyPanel canManage={Boolean(data.data?.canManage)} />
      </>}
      <Dialog open={activityId !== null} onOpenChange={open => { if (!open) setActivityId(null) }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2 text-sm"><Clock3 className="size-4" />登录操作记录</DialogTitle></DialogHeader>{activity.isPending ? <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />读取中</div> : activity.data ? <div className="space-y-3"><div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-3">{Object.entries(activity.data.login).map(([key, value]) => <div key={key}><div className="text-[10px] text-muted-foreground">{activityLabel(key)}</div><div className="mt-1 break-words">{value || "—"}</div></div>)}</div><div className="divide-y rounded-lg border">{activity.data.operations.map((entry, index) => <div key={`${entry.opt_time}-${index}`} className="flex flex-wrap justify-between gap-2 px-3 py-2.5 text-xs"><span>{entry.opt_content}</span><span className="text-muted-foreground">{entry.opt_module} · {formatDate(entry.opt_time)}</span></div>)}{!activity.data.operations.length && <div className="px-3 py-6 text-center text-xs text-muted-foreground">此登录时段没有操作记录</div>}</div></div> : <p role="alert" className="text-xs text-destructive">{activity.error instanceof ApiError ? activity.error.message : "操作记录读取失败"}</p>}</DialogContent></Dialog>
    </main>
  </AdminShell>
}
function formatDate(value: unknown) { return formatLocaleDateTime(value) }
function activityLabel(value: string) { return ({ time: "时间", location: "地点", deviceIp: "设备 IP", publicIp: "公网 IP", deviceType: "设备类型", userAgent: "设备信息" } as Record<string, string>)[value] || value }
