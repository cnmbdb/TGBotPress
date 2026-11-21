import { useEffect, useState, type FormEvent } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, CircleAlert, Database, RefreshCw, Save, ShieldCheck, ShieldX, Wallet } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api"

type LicenseInfo = { status: "active" | "unactivated"; maxBots: number; expiresAt: string | null; message: string; apiUser: { username: string; balance: string | null } | null }
type Config = { jobUrl: string; tronscanConfigured: boolean; trongridConfigured: boolean; apiSiteUrl: string; apiSiteUrlEditable: boolean; licenseInfo: LicenseInfo }
type Form = Config & { tronscanApiKeys: string; trongridApiKeys: string }
type ApiMessage = { message: string; ok?: boolean }
const empty: Form = { jobUrl: "", tronscanConfigured: false, trongridConfigured: false, apiSiteUrl: "", apiSiteUrlEditable: true, licenseInfo: { status: "unactivated", maxBots: 0, expiresAt: null, message: "", apiUser: null }, tronscanApiKeys: "", trongridApiKeys: "" }
export const Route = createFileRoute("/console/settings-config")({ component: SettingsConfigPage })
function SettingsConfigPage() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ["me", "config-activation"], queryFn: () => api<AdminUser>("/api/me/?allowUnlicensed=config"), retry: false, staleTime: 60_000 })
  const config = useQuery({ queryKey: ["system-config"], queryFn: () => api<Config>("/api/settings-config?action=config"), enabled: !!me.data, retry: false, staleTime: 30_000 })
  const [form, setForm] = useState<Form>(empty), [authCode, setAuthCode] = useState(""), [message, setMessage] = useState(""), [failure, setFailure] = useState("")
  useEffect(() => { if (config.data) setForm({ ...config.data, tronscanApiKeys: "", trongridApiKeys: "" }) }, [config.data])
  const feedback = (text: string, error = false) => { setFailure(error ? text : ""); setMessage(error ? "" : text) }
  const post = useMutation({ mutationFn: (body: object) => api<ApiMessage>("/api/settings-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), onSuccess: async r => { feedback(r.message); await client.invalidateQueries({ queryKey: ["system-config"] }) }, onError: e => feedback(e instanceof ApiError ? e.message : "请求失败", true) })
  const balance = useMutation({ mutationFn: () => api<{ ok: boolean; message: string; username: string; balance: string | null }>("/api/settings-config?action=license-balance"), onSuccess: async r => { feedback(r.message, !r.ok); await client.invalidateQueries({ queryKey: ["system-config"] }) }, onError: e => feedback(e instanceof ApiError ? e.message : "余额刷新失败", true) })
  const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => { client.clear(); location.assign("/console/home") } })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6"><h1 className="font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=settingsConfig">管理员登录</a></Button></section></main>
  const submit = (event: FormEvent) => { event.preventDefault(); feedback(""); post.mutate({ action: "save", jobUrl: form.jobUrl, tronscanApiKeys: form.tronscanApiKeys, trongridApiKeys: form.trongridApiKeys }) }
  const activate = () => { feedback(""); post.mutate({ action: "activate", authCode }) }
  const refresh = () => { void config.refetch() }
  const license = config.data?.licenseInfo
  return <AdminShell user={me.data} title="系统配置" activeRoute="admin.setting.config.index" onRefresh={refresh} onLogout={() => logout.mutate()}>
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <form onSubmit={submit} className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3"><h1 className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4" />系统配置</h1><Button size="sm" disabled={post.isPending || config.isLoading}><Save className="mr-1.5 size-3.5" />{post.isPending ? "保存中" : "保存"}</Button></div>
        <div className="grid gap-4 p-4">
          <label className="space-y-1.5 text-xs"><span className="font-medium">Tronscan API Keys <span className="text-muted-foreground">{config.data?.tronscanConfigured ? "· 已配置，留空保持" : "· 未配置"}</span></span><Textarea className="min-h-20 text-xs" value={form.tronscanApiKeys} onChange={e => setForm(v => ({ ...v, tronscanApiKeys: e.target.value }))} placeholder="输入新 key，多条用英文逗号分隔" /></label>
          <label className="space-y-1.5 text-xs"><span className="font-medium">Trongrid API Keys <span className="text-muted-foreground">{config.data?.trongridConfigured ? "· 已配置，留空保持" : "· 未配置"}</span></span><Textarea className="min-h-20 text-xs" value={form.trongridApiKeys} onChange={e => setForm(v => ({ ...v, trongridApiKeys: e.target.value }))} placeholder="输入新 key，多条用英文逗号分隔" /></label>
        </div>
      </form>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold">{license?.status === "active" ? <ShieldCheck className="size-4 text-emerald-600" /> : <ShieldX className="size-4 text-muted-foreground" />}授权激活</h2><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{license?.status === "active" ? "已激活" : "未激活"}</span></div>
        <div className="grid gap-4 p-4">
          <label className="space-y-1.5 text-xs"><span className="font-medium">激活码</span><Input className="h-9" type="password" autoComplete="off" value={authCode} onChange={e => setAuthCode(e.target.value)} placeholder={license?.status === "active" ? "已保存，不会回显" : "输入激活码"} /></label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{license?.message && <span>{license.message}</span>}{license?.status === "active" && <span>最大机器人：{license.maxBots || "—"} · 到期：{license.expiresAt || "永久"}</span>}{license?.apiUser && <span className="flex items-center gap-1"><Wallet className="size-3.5" />{license.apiUser.username} · 余额 {license.apiUser.balance ?? "—"}</span>}</div>
        </div>
        <div className="flex flex-wrap gap-2 border-t px-4 py-3"><Button type="button" size="sm" disabled={post.isPending || !authCode} onClick={activate}><ShieldCheck className="mr-1.5 size-3.5" />{post.isPending ? "处理中" : "激活"}</Button>{license?.status === "active" && <><Button type="button" size="sm" variant="outline" disabled={balance.isPending} onClick={() => balance.mutate()}><RefreshCw className="mr-1.5 size-3.5" />刷新余额</Button><Button type="button" size="sm" variant="outline" disabled={post.isPending} onClick={() => { if (window.confirm("确认解除授权？")) post.mutate({ action: "deactivate" }) }}>解除授权</Button></>}</div>
      </section>
      {(message || failure) && <div role={failure ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs ${failure ? "text-destructive" : "text-muted-foreground"}`}>{failure ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />}{failure || message}</div>}
    </main>
  </AdminShell>
}
