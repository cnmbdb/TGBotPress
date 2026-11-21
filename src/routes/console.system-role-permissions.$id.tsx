import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CircleAlert, LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { api, ApiError } from "@/lib/api"

export const Route = createFileRoute("/console/system-role-permissions/$id")({ component: RolePermissionsPage })
type PermissionNode = { id: string; pid: number | null; title: string; route: string | null; checked: boolean; children: PermissionNode[] }
type RolePermissions = { role: { id: string; name: string }; tree: PermissionNode[] }
type Identity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
type Notice = { text: string; error: boolean }
function allIds(nodes: PermissionNode[]): string[] { return nodes.flatMap(node => [node.id, ...allIds(node.children)]) }
function checkedIds(nodes: PermissionNode[]): string[] { return nodes.flatMap(node => [...(node.checked ? [node.id] : []), ...checkedIds(node.children)]) }
function count(nodes: PermissionNode[]): number { return nodes.reduce((n,node) => n + 1 + count(node.children), 0) }

function RolePermissionsPage() {
  const { id } = Route.useParams()
  const client = useQueryClient()
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Identity>("/api/me/"), retry: false, staleTime: 60_000 })
  const queryKey = ["role-permissions", id]
  const data = useQuery({ queryKey, queryFn: () => api<RolePermissions>(`/api/system-access?action=role-permissions&id=${encodeURIComponent(id)}`), enabled: !!me.data, retry: false })
  useEffect(() => { if (data.data) setSelected(new Set(checkedIds(data.data.tree))) }, [data.data])
  const save = useMutation({
    mutationFn: () => api<{ message: string }>("/api/system-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role-change-permissions", id, permissionIds: [...(selected || [])].map(Number) }) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); await client.invalidateQueries({ queryKey }); await client.invalidateQueries({ queryKey: ["system-roles"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "保存失败", error: true }),
  })
  const refresh = () => { setNotice(null); void data.refetch() }
  if (me.isPending) return <Loading />
  if (!me.data) return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm rounded-xl border bg-card p-5"><h1 className="mb-3 text-sm font-semibold">登录管理后台</h1><Button asChild size="sm"><a href="/api/auth/start?destination=home">管理员登录</a></Button></section></main>
  const selectedCount = selected?.size ?? 0
  return <AdminShell user={me.data} title="角色权限" activeRoute="admin.system.role.index" onRefresh={refresh} onLogout={() => { void api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}).finally(() => { client.clear(); location.assign("/console/home") }) }}>
    <main className="mx-auto grid max-w-6xl gap-3 p-3 sm:p-5">
      {(notice || data.isError) && <div role={notice?.error || data.isError ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice?.error || data.isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}><CircleAlert className="size-3.5" />{notice?.text || (data.error instanceof ApiError ? data.error.message : "角色权限读取失败")}<Button className="ml-auto" variant="ghost" size="icon-sm" onClick={refresh} aria-label="重新加载"><RefreshCw className="size-3.5" /></Button></div>}
      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-muted-foreground" />{data.data?.role.name || "角色权限"}<Badge variant="secondary">{selectedCount} / {data.data ? count(data.data.tree) : 0}</Badge></div><div className="flex items-center gap-2"><Button asChild size="sm" variant="outline"><Link to="/console/system-roles"><ArrowLeft className="mr-1.5 size-4" />返回角色</Link></Button>{selected && data.data && <Button size="sm" disabled={save.isPending || data.data.role.name === "超级管理员"} onClick={() => { setNotice(null); save.mutate() }}><Save className="mr-1.5 size-4" />保存权限</Button>}</div></header>
        {data.isPending ? <Loading /> : data.data?.role.name === "超级管理员" ? <div className="p-8 text-center text-sm text-muted-foreground">超级管理员权限固定</div> : data.data?.tree.length && selected ? <div className="grid gap-1 p-2 sm:p-3"><PermissionNodes nodes={data.data.tree} selected={selected} onToggle={(node, checked) => setSelected(current => { const next = new Set(current || []); const setBranch = (item: PermissionNode) => { if (checked) next.add(item.id); else next.delete(item.id); item.children.forEach(setBranch) }; setBranch(node); return next })} /></div> : <div className="p-8 text-center text-sm text-muted-foreground">暂无权限</div>}
      </section>
    </main>
  </AdminShell>
}
function PermissionNodes({ nodes, selected, onToggle }: { nodes: PermissionNode[]; selected: Set<string>; onToggle: (node: PermissionNode, checked: boolean) => void }) {
  return <div className="grid gap-1">{nodes.map(node => <div key={node.id}><label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"><Checkbox checked={selected.has(node.id)} onCheckedChange={checked => onToggle(node, checked === true)} /><span className="min-w-0 flex-1 truncate text-sm">{node.title}</span>{node.route && <span className="max-w-[55%] truncate font-mono text-[10px] text-muted-foreground">{node.route}</span>}<span className="font-mono text-[10px] text-muted-foreground">#{node.id}</span></label>{node.children.length > 0 && <div className="ml-4 border-l pl-2 sm:ml-6 sm:pl-3"><PermissionNodes nodes={node.children} selected={selected} onToggle={onToggle} /></div>}</div>)}</div>
}
function Loading() { return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</div> }
