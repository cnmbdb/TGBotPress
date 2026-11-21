import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRoundCog } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, ApiError } from "@/lib/api"

export const Route = createFileRoute("/console/system-admins")({ component: AdminManagementPage })
type AdminRole = { id: string; name: string }
type AdminRow = { id: string; name: string; status: number | string; white_ip: string | null; created_at: string | null; role_ids: string[]; roles: AdminRole[] }
type PermissionSet = { create: boolean; status: boolean; update: boolean; delete: boolean }
type AdminData = { rows: AdminRow[]; total: number; page: number; pageSize: number; roles: AdminRole[]; permissions: PermissionSet; currentAdminId: string }
type Identity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
type Draft = { id?: string; name: string; password: string; whiteIp: string; status: boolean; roleIds: string[] }
type DialogMode = "create" | "update"
type Notice = { text: string; error: boolean }
type MutationPayload =
  | { action: "create"; name: string; password: string; whiteIp: string; status: boolean }
  | { action: "update"; id: string; name: string; password: string; whiteIp: string; roleIds: string[] }
  | { action: "set-status"; id: string; enabled: boolean }
  | { action: "delete"; id: string }
const pageSizes = [10, 20, 30, 50, 100]
const emptyDraft = (): Draft => ({ name: "", password: "", whiteIp: "", status: true, roleIds: [] })

function AdminManagementPage() {
  useLocale()
  const client = useQueryClient()
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [mode, setMode] = useState<DialogMode>("create")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [deleteTarget, setDeleteTarget] = useState<AdminRow | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" })
  const [notice, setNotice] = useState<Notice | null>(null)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Identity>("/api/me/"), retry: false, staleTime: 60_000 })
  const data = useQuery({
    queryKey: ["admin-management", page, pageSize, search],
    queryFn: () => api<AdminData>(`/api/admin-management?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), name: search })}`),
    enabled: !!me.data, retry: false,
  })
  const mutate = useMutation({
    mutationFn: (payload: MutationPayload) => api<{ message: string }>("/api/admin-management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); setDialogOpen(false); setDeleteTarget(null); await client.invalidateQueries({ queryKey: ["admin-management"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "操作失败，请重试", error: true }),
  })
  const changePassword = useMutation({
    mutationFn: () => api<{ message: string }>("/api/admin-management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "change-password", ...password }) }),
    onSuccess: result => { setNotice({ text: result.message, error: false }); setPasswordOpen(false); setPassword({ oldPassword: "", newPassword: "", confirmPassword: "" }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "密码修改失败", error: true }),
  })
  const totalPages = Math.max(1, Math.ceil((data.data?.total || 0) / pageSize))
  const startEdit = (row: AdminRow) => { setMode("update"); setDraft({ id: row.id, name: row.name, password: "", whiteIp: row.white_ip || "", status: Number(row.status) === 1, roleIds: row.role_ids.map(String) }); setDialogOpen(true) }
  const startCreate = () => { setMode("create"); setDraft(emptyDraft()); setDialogOpen(true) }
  const refresh = () => { setNotice(null); void data.refetch() }
  const submit = () => {
    setNotice(null)
    if (mode === "create") mutate.mutate({ action: "create", name: draft.name, password: draft.password, whiteIp: draft.whiteIp, status: draft.status })
    else if (draft.id) mutate.mutate({ action: "update", id: draft.id, name: draft.name, password: draft.password, whiteIp: draft.whiteIp, roleIds: draft.roleIds })
  }
  const fromTo = useMemo(() => {
    const total = data.data?.total || 0
    return total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}` : "0 条"
  }, [data.data?.total, page, pageSize])
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><LoaderCircle className="size-4 animate-spin" aria-label="加载中" /></div>
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm rounded-xl border bg-card p-5"><h1 className="mb-3 text-sm font-semibold">登录管理后台</h1><Button asChild size="sm"><a href="/api/auth/start?destination=home">管理员登录</a></Button></section></main>
  return <AdminShell user={me.data} title="管理员管理" activeRoute="admin.system.admin.index" onRefresh={refresh} onLogout={() => { void api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}).finally(() => { client.clear(); location.assign("/console/home") }) }}>
    <main className="mx-auto grid max-w-6xl gap-3 p-3 sm:p-5">
      {(notice || data.isError) && <div role={notice?.error || data.isError ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice?.error || data.isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}>
        {notice?.text || (data.error instanceof ApiError ? data.error.message : "管理员数据读取失败")}<Button className="ml-auto" variant="ghost" size="icon-sm" onClick={refresh} aria-label="重新加载"><RefreshCw className="size-3.5" /></Button>
      </div>}
      <section className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(searchText.trim()) }}>
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={searchText} onChange={event => setSearchText(event.target.value)} className="pl-9" placeholder="搜索管理员账号" aria-label="搜索管理员账号" /></div>
          <Button type="submit" size="sm">搜索</Button>
        </form>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="icon-sm" onClick={() => void data.refetch()} aria-label="刷新"><RefreshCw className="size-4" /></Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPasswordOpen(true)}><KeyRound className="mr-1.5 size-4" />修改本人密码</Button>
          {data.data?.permissions.create && <Button type="button" size="sm" onClick={startCreate}><Plus className="mr-1.5 size-4" />添加管理员</Button>}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2.5"><div className="flex items-center gap-2 text-sm font-semibold"><UserRoundCog className="size-4 text-muted-foreground" />管理员列表</div><Badge variant="secondary">{data.data?.total ?? 0} 位</Badge></div>
        {data.isPending ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</div> : <>
        <div className="hidden overflow-x-auto md:block"><Table>
          <TableHeader><TableRow><TableHead className="w-16">ID</TableHead><TableHead>账号</TableHead><TableHead>角色</TableHead><TableHead>白名单 IP</TableHead><TableHead>创建时间</TableHead><TableHead>状态</TableHead><TableHead className="w-24 text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data.data?.rows || []).map(row => <TableRow key={row.id}>
              <TableCell className="font-mono text-xs text-muted-foreground">{row.id}</TableCell><TableCell className="font-medium">{row.name}{row.id === data.data?.currentAdminId && <Badge className="ml-2" variant="outline">当前账号</Badge>}</TableCell>
              <TableCell><div className="flex max-w-56 flex-wrap gap-1">{row.roles.length ? row.roles.map(role => <Badge key={role.id} variant={role.name === "超级管理员" ? "default" : "secondary"}>{role.name}</Badge>) : <span className="text-xs text-muted-foreground">未分配</span>}</div></TableCell>
              <TableCell className="max-w-52 truncate text-xs text-muted-foreground" title={row.white_ip || "—"}>{row.white_ip || "—"}</TableCell><TableCell className="text-xs text-muted-foreground">{row.created_at ? formatLocaleDateTime(row.created_at) : "—"}</TableCell>
              <TableCell>{data.data?.permissions.status ? <Switch checked={Number(row.status) === 1} disabled={row.id === data.data?.currentAdminId || mutate.isPending} aria-label={`切换 ${row.name} 状态`} onCheckedChange={enabled => { setNotice(null); mutate.mutate({ action: "set-status", id: row.id, enabled }) }} /> : <Badge variant={Number(row.status) === 1 ? "default" : "secondary"}>{Number(row.status) === 1 ? "启用" : "禁用"}</Badge>}</TableCell>
              <TableCell><div className="flex justify-end gap-1">{data.data?.permissions.update && <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${row.name}`} onClick={() => startEdit(row)}><Pencil className="size-4" /></Button>}{data.data?.permissions.delete && row.id !== data.data?.currentAdminId && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`删除 ${row.name}`} onClick={() => setDeleteTarget(row)}><Trash2 className="size-4" /></Button>}</div></TableCell>
            </TableRow>)}
            {!data.data?.rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">暂无管理员</TableCell></TableRow>}
          </TableBody>
        </Table></div>
        <div className="divide-y md:hidden">
          {(data.data?.rows || []).map(row => <article key={row.id} className="space-y-3 p-3">
            <header className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{row.name}{row.id === data.data?.currentAdminId && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">当前账号</Badge>}</div><div className="mt-1 font-mono text-[11px] text-muted-foreground">#{row.id}</div></div>
              {data.data?.permissions.status ? <Switch checked={Number(row.status) === 1} disabled={row.id === data.data?.currentAdminId || mutate.isPending} aria-label={`切换 ${row.name} 状态`} onCheckedChange={enabled => { setNotice(null); mutate.mutate({ action: "set-status", id: row.id, enabled }) }} /> : <Badge variant={Number(row.status) === 1 ? "default" : "secondary"}>{Number(row.status) === 1 ? "启用" : "禁用"}</Badge>}
            </header>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">角色</dt><dd className="mt-1 flex flex-wrap gap-1">{row.roles.length ? row.roles.map(role => <Badge key={role.id} variant={role.name === "超级管理员" ? "default" : "secondary"}>{role.name}</Badge>) : <span className="text-muted-foreground">未分配</span>}</dd></div>
              <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">白名单 IP</dt><dd className="mt-0.5 break-all font-mono text-[11px]">{row.white_ip || "—"}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">创建时间</dt><dd className="mt-0.5">{row.created_at ? formatLocaleDateTime(row.created_at) : "—"}</dd></div>
            </dl>
            {(data.data?.permissions.update || data.data?.permissions.delete && row.id !== data.data?.currentAdminId) && <div className="flex items-center justify-end gap-1 border-t pt-2">{data.data?.permissions.update && <Button variant="ghost" size="icon" className="size-8" aria-label={`编辑 ${row.name}`} onClick={() => startEdit(row)}><Pencil className="size-4" /></Button>}{data.data?.permissions.delete && row.id !== data.data?.currentAdminId && <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" aria-label={`删除 ${row.name}`} onClick={() => setDeleteTarget(row)}><Trash2 className="size-4" /></Button>}</div>}
          </article>)}
          {!data.data?.rows.length && <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无管理员</div>}
        </div></>}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground"><span>{fromTo}</span><div className="flex items-center gap-2"><label className="flex items-center gap-1.5">每页 <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{pageSizes.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></label><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page} / {totalPages}</span><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</Button></div></footer>
      </section>
    </main>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{mode === "create" ? "添加管理员" : "编辑管理员"}</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs font-medium">账号<Input maxLength={30} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} autoComplete="username" /></label>
        <label className="grid gap-1.5 text-xs font-medium">{mode === "create" ? "初始密码" : "重设密码（留空保持不变）"}<Input type="password" maxLength={128} value={draft.password} onChange={event => setDraft(current => ({ ...current, password: event.target.value }))} autoComplete="new-password" /></label>
        <label className="grid gap-1.5 text-xs font-medium">白名单 IP<Input maxLength={3000} value={draft.whiteIp} onChange={event => setDraft(current => ({ ...current, whiteIp: event.target.value }))} placeholder="留空不限制；多个 IP 用英文逗号分隔" /></label>
        {mode === "create" ? <div className="flex items-center justify-between rounded-lg border px-3 py-2"><span className="text-sm">账号状态</span><Switch checked={draft.status} onCheckedChange={status => setDraft(current => ({ ...current, status }))} /></div> : <fieldset className="grid gap-2"><legend className="mb-1 text-xs font-medium">管理员角色</legend><div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">{(data.data?.roles || []).map(role => <label key={role.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"><Checkbox checked={draft.roleIds.includes(role.id)} onCheckedChange={checked => setDraft(current => ({ ...current, roleIds: checked ? [...new Set([...current.roleIds, role.id])] : current.roleIds.filter(id => id !== role.id) }))} /><span>{role.name}{role.name === "超级管理员" && <ShieldCheck className="ml-1 inline size-3.5 text-amber-600" />}</span></label>)}</div></fieldset>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button><Button disabled={mutate.isPending || !draft.name.trim() || (mode === "create" && !draft.password)} onClick={submit}>{mutate.isPending && <LoaderCircle className="mr-1.5 size-4 animate-spin" />}保存</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>删除管理员</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">确定删除「{deleteTarget?.name}」？该账号的登录会话和通行密钥也会立即失效。</p><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="destructive" disabled={mutate.isPending} onClick={() => deleteTarget && mutate.mutate({ action: "delete", id: deleteTarget.id })}>确认删除</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>修改本人密码</DialogTitle></DialogHeader><div className="grid gap-3"><label className="grid gap-1.5 text-xs font-medium">当前密码<Input type="password" autoComplete="current-password" value={password.oldPassword} onChange={event => setPassword(value => ({ ...value, oldPassword: event.target.value }))} /></label><label className="grid gap-1.5 text-xs font-medium">新密码<Input type="password" autoComplete="new-password" value={password.newPassword} onChange={event => setPassword(value => ({ ...value, newPassword: event.target.value }))} /></label><label className="grid gap-1.5 text-xs font-medium">确认新密码<Input type="password" autoComplete="new-password" value={password.confirmPassword} onChange={event => setPassword(value => ({ ...value, confirmPassword: event.target.value }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setPasswordOpen(false)}>取消</Button><Button disabled={changePassword.isPending || !password.oldPassword || !password.newPassword || !password.confirmPassword} onClick={() => changePassword.mutate()}>{changePassword.isPending && <LoaderCircle className="mr-1.5 size-4 animate-spin" />}保存</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
