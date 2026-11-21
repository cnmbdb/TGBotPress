import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, CircleAlert, Download, Package, RefreshCw, ShieldCheck } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { api, ApiError } from "@/lib/api"

type CheckState = { ok: boolean; message: string; disk_ok?: boolean; source_ok?: boolean }
type Commit = { sha: string; subject: string; date: string | null; author: string; url: string }
type VersionStatus = {
  checked_at: string | null
  repository: {
    name: string; branch: string; url: string; current_sha: string | null; remote_sha: string | null;
    commit_subject: string | null; commit_date: string | null; checkout_repository: string | null;
    source_matches: boolean | null; remote_source: string | null; recent_commits: Commit[]; state: string;
  }
  images: Record<"admin", {
    label: string; name: string; service: string; current_sha: string | null; build_date: string | null; checked_at: string | null;
    estimated: boolean; latest_digest: string | null; latest_build_sha: string | null; registry_error: string | null;
    status_error: string | null; state: string; driver: string;
  }>
  disk: { path: string; free_gb: number | null; total_bytes: number | null; minimum_gb: number; sufficient: boolean }
  update_checks: { repository: CheckState; images: Record<"admin", CheckState> }
  auto_update: { enabled: boolean; token_configured: boolean }
}
type UpdateTarget = "repository" | "images" | "admin"
type UpdateResult = { ok: boolean; message: string }
type AdminIdentity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
const targetLabels: Record<UpdateTarget, string> = { repository: "项目源码", images: "更新版本", admin: "更新版本" }

export const Route = createFileRoute("/console/settings-version")({ component: SettingsVersionPage })


function stateClass(value?: string) {
  if (value === "current") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
  if (value === "update_available") return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
  if (value === "source_mismatch") return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
  return "bg-muted text-muted-foreground"
}
function short(value?: string | null) {
  return value ? value.slice(0, 12) : "未获取"
}
function formatDate(value?: string | null) {
  if (!value) return "—"
  return value.replace("T", " ").replace("Z", "")
}
function canUpdate(user?: AdminIdentity) {
  return Boolean(user?.roles?.includes("超级管理员") || user?.permissions?.includes("应用升级") || user?.routes?.includes("admin.setting.app_version.update"))
}
function SettingsVersionPage() {
  const client = useQueryClient()
  const [selected, setSelected] = useState<UpdateTarget | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [unavailableAttempt, setUnavailableAttempt] = useState(false)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<AdminIdentity>("/api/me/"), retry: false, staleTime: 60_000 })
  const status = useQuery({ queryKey: ["settings-version"], queryFn: () => api<VersionStatus>("/api/settings-version?refresh=1"), enabled: Boolean(me.data), retry: false, staleTime: 30_000, refetchInterval: 3 * 24 * 60 * 60 * 1000, refetchIntervalInBackground: true, refetchOnMount: "always" })
  const refresh = () => { setNotice(""); setError(""); void status.refetch() }
  const autoUpdate = useMutation({
    mutationFn: (enabled: boolean) => api<UpdateResult>("/api/settings-version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "auto_update", enabled }) }),
    onSuccess: async result => { setNotice(result.message); setError(""); await client.invalidateQueries({ queryKey: ["settings-version"] }) },
    onError: reason => { setError(reason instanceof ApiError ? reason.message : "自动更新设置失败"); setNotice("") },
  })
  const update = useMutation({
    mutationFn: (target: UpdateTarget) => api<UpdateResult>("/api/settings-version", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }),
    }),
    onSuccess: async result => {
      setSelected(null)
      setNotice(result.message)
      setError(result.ok ? "" : result.message)
      await client.invalidateQueries({ queryKey: ["settings-version"] })
    },
    onError: reason => {
      setSelected(null)
      setError(reason instanceof ApiError ? reason.message : "更新操作失败")
      setNotice("")
    },
  })
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    onSuccess: () => { client.clear(); location.assign("/console/home") },
  })
  const user = me.data
  const data = status.data
  const canDeploy = canUpdate(user)
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!user) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-5"><h1 className="font-semibold">登录管理后台</h1><p className="text-sm text-muted-foreground">登录后查看版本状态和更新权限。</p><Button asChild size="sm"><a href="/api/auth/start?destination=settingsVersion">前往登录</a></Button></section></main>
  return <AdminShell user={user} title="版本更新" activeRoute="admin.setting.app_version.index" onRefresh={refresh} onLogout={() => logout.mutate()}>
    <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
      {(error || notice) && <div role={error ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}>{error ? <CircleAlert className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}{error || notice}</div>}
      {status.isError && <section role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="size-4" />{status.error instanceof ApiError ? status.error.message : "版本状态读取失败"}<Button className="ml-auto" variant="outline" size="sm" onClick={refresh}>重试</Button></section>}
      {status.isPending && <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />正在读取版本状态…</div>}
      {data && <>
        <section className="grid gap-4">
          {(["admin"] as const).map(key => {
            const image = data.images[key]
            const check = data.update_checks.images[key]
            return <article key={key} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Package className="size-4 text-muted-foreground" />更新版本</h2>
                <Button variant="outline" size="sm" className="ml-auto h-8 gap-1.5" aria-label="刷新镜像状态" onClick={refresh} disabled={status.isFetching}><RefreshCw className={"size-3.5 "+(status.isFetching ? "animate-spin" : "")}/>刷新</Button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
                <Metric label="当前构建" value={short(image.current_sha)} />
                <Metric label="最新构建" value={short(image.latest_build_sha)} />
                <Metric label="构建时间" value={formatDate(image.build_date)} />
                <Metric label="最近检查" value={formatDate(image.checked_at)} />
                {(image.status_error || image.registry_error) && <div className="col-span-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3.5 shrink-0" />{image.status_error || image.registry_error}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
                <Button size="sm" disabled={!canDeploy || !check?.ok || image.state !== "update_available" || update.isPending} onClick={() => setSelected(key)}><Download className="mr-1.5 size-3.5" />立即更新</Button>
                <div className="ml-auto flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5">
                  <span className="text-xs font-medium">自动更新</span>
                  <Switch checked={unavailableAttempt || data.auto_update.enabled} disabled={autoUpdate.isPending} onCheckedChange={enabled => { if (enabled && !data.auto_update.token_configured) { setUnavailableAttempt(true); setError("未配置 RAILWAY_API_TOKEN，无法开启自动更新"); window.setTimeout(() => setUnavailableAttempt(false), 400); return } autoUpdate.mutate(enabled) }} aria-label="开启自动更新" />
                </div>
              </div>
            </article>
          })}
        </section>
      </>}
      <Dialog open={selected !== null} onOpenChange={open => { if (!open && !update.isPending) setSelected(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认执行更新</DialogTitle><DialogDescription>即将更新{selected ? targetLabels[selected] : ""}。服务可能短暂重启，请确认来源和检查结果后继续。</DialogDescription></DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm"><div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-emerald-600" />已通过更新前检查</div><p className="mt-1 text-xs text-muted-foreground">此操作会在服务器端拉取代码或镜像，并可能触发服务重建。</p></div>
          <DialogFooter><Button variant="outline" disabled={update.isPending} onClick={() => setSelected(null)}>取消</Button><Button disabled={!selected || update.isPending} onClick={() => selected && update.mutate(selected)}>{update.isPending ? <><RefreshCw className="mr-1.5 size-3.5 animate-spin" />执行中</> : "确认更新"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  </AdminShell>
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-medium" title={value}>{value}</div></div>
}
