import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UsersRound } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, ApiError } from "@/lib/api"

export const Route = createFileRoute("/console/system-roles")({ component: RolesPage })
type RoleRow = { id: string; name: string; created_at: string | null }
type RoleData = { rows: RoleRow[]; total: number; page: number; pageSize: number; permissions: { create: boolean; update: boolean; delete: boolean; assign: boolean } }
type Identity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
type Notice = { text: string; error: boolean }
type RolePayload = { action: "role-add"; name: string } | { action: "role-update"; id: string; name: string } | { action: "role-delete"; id: string }

function RolesPage() {
  useLocale()
  const client = useQueryClient()
  const [dialog, setDialog] = useState<{ id?: string; name: string } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Identity>("/api/me/"), retry: false, staleTime: 60_000 })
  const data = useQuery({ queryKey: ["system-roles", page, pageSize], queryFn: () => api<RoleData>(`/api/system-access?${new URLSearchParams({ action: "roles", page: String(page), pageSize: String(pageSize) })}`), enabled: !!me.data, retry: false })
  const mutation = useMutation({
    mutationFn: (payload: RolePayload) => api<{ message: string }>("/api/system-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); setDialog(null); setDeleteTarget(null); await client.invalidateQueries({ queryKey: ["system-roles"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "操作失败", error: true }),
  })
  const refresh = () => { setNotice(null); void data.refetch() }
  if (me.isPending) return <Loading />
  if (!me.data) return <LoginCard />
  const totalPages = Math.max(1, Math.ceil((data.data?.total || 0) / pageSize))
  return <AdminShell user={me.data} title="角色管理" activeRoute="admin.system.role.index" onRefresh={refresh} onLogout={() => logout(client)}>
    <main className="mx-auto grid max-w-6xl gap-3 p-3 sm:p-5">
      {(notice || data.isError) && <div role={notice?.error || data.isError ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice?.error || data.isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}><CircleAlert className="size-3.5" />{notice?.text || (data.error instanceof ApiError ? data.error.message : "角色读取失败")}<Button className="ml-auto" variant="ghost" size="icon-sm" onClick={refresh} aria-label="重新加载"><RefreshCw className="size-3.5" /></Button></div>}
      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center justify-between border-b px-3 py-2.5"><div className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 text-muted-foreground" />角色列表</div><div className="flex items-center gap-2"><Badge variant="secondary">{data.data?.total ?? 0} 个</Badge>{data.data?.permissions.create && <Button size="sm" onClick={() => setDialog({ name: "" })}><Plus className="mr-1.5 size-4" />添加角色</Button>}</div></header>
        {data.isPending ? <Loading /> : <>
        <div className="hidden md:block"><Table><TableHeader><TableRow><TableHead className="w-16">ID</TableHead><TableHead>角色名称</TableHead><TableHead>创建时间</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
          {(data.data?.rows || []).map(role => <TableRow key={role.id}><TableCell className="font-mono text-xs text-muted-foreground">{role.id}</TableCell><TableCell className="font-medium">{role.name}{role.name === "超级管理员" && <Badge className="ml-2" variant="secondary"><ShieldCheck className="mr-1 size-3" />系统角色</Badge>}</TableCell><TableCell className="text-xs text-muted-foreground">{role.created_at ? formatLocaleDateTime(role.created_at) : "—"}</TableCell><TableCell><div className="flex justify-end gap-1">{role.name !== "超级管理员" && <>{data.data?.permissions.assign && <Button asChild size="sm" variant="outline"><Link to="/console/system-role-permissions/$id" params={{ id: role.id }}>编辑权限</Link></Button>}{data.data?.permissions.update && <Button variant="ghost" size="icon-sm" aria-label={`修改 ${role.name}`} onClick={() => setDialog({ id: role.id, name: role.name })}><Pencil className="size-4" /></Button>}{data.data?.permissions.delete && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`删除 ${role.name}`} onClick={() => setDeleteTarget(role)}><Trash2 className="size-4" /></Button>}</>}</div></TableCell></TableRow>)}
          {!data.data?.rows.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">暂无角色</TableCell></TableRow>}
        </TableBody></Table></div>
        <div className="divide-y md:hidden">
          {(data.data?.rows || []).map(role => <article key={role.id} className="space-y-2.5 p-3">
            <header className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{role.name}{role.name === "超级管理员" && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]"><ShieldCheck className="mr-1 size-3" />系统角色</Badge>}</div><div className="mt-1 font-mono text-[11px] text-muted-foreground">#{role.id}</div></div>
            </header>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
              <span className="text-[11px] text-muted-foreground">创建时间 · {role.created_at ? formatLocaleDateTime(role.created_at) : "—"}</span>
              {role.name !== "超级管理员" && <div className="flex flex-wrap items-center gap-1.5">{data.data?.permissions.assign && <Button asChild size="sm" variant="outline" className="h-8"><Link to="/console/system-role-permissions/$id" params={{ id: role.id }}>编辑权限</Link></Button>}{data.data?.permissions.update && <Button size="icon" variant="ghost" className="size-8" aria-label={`修改 ${role.name}`} onClick={() => setDialog({ id: role.id, name: role.name })}><Pencil className="size-4" /></Button>}{data.data?.permissions.delete && <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label={`删除 ${role.name}`} onClick={() => setDeleteTarget(role)}><Trash2 className="size-4" /></Button>}</div>}
            </div>
          </article>)}
          {!data.data?.rows.length && <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无角色</div>}
        </div></>}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground"><span>共 {data.data?.total ?? 0} 个角色</span><div className="flex items-center gap-2"><span>每页</span><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[10,20,30,50,100].map(size => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page} / {totalPages}</span><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</Button></div></footer>
      </section>
    </main>
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) setDialog(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{dialog?.id ? "修改角色名称" : "添加角色"}</DialogTitle></DialogHeader><label className="grid gap-1.5 text-xs font-medium">角色名称<Input autoFocus maxLength={255} value={dialog?.name || ""} onChange={event => setDialog(value => value ? { ...value, name: event.target.value } : value)} /></label><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>取消</Button><Button disabled={mutation.isPending || !dialog?.name.trim()} onClick={() => dialog && mutation.mutate(dialog.id ? { action: "role-update", id: dialog.id, name: dialog.name.trim() } : { action: "role-add", name: dialog.name.trim() })}>保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>删除角色</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">确定删除「{deleteTarget?.name}」？已分配此角色的管理员将失去该角色权限。</p><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => deleteTarget && mutation.mutate({ action: "role-delete", id: deleteTarget.id })}>确认删除</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}
function Loading() { return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</div> }
function LoginCard() { return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm rounded-xl border bg-card p-5"><h1 className="mb-3 text-sm font-semibold">登录管理后台</h1><Button asChild size="sm"><a href="/api/auth/start?destination=home">管理员登录</a></Button></section></main> }
function logout(client: ReturnType<typeof useQueryClient>) { void api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}).finally(() => { client.clear(); location.assign("/console/home") }) }
