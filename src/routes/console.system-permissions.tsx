import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, FolderTree, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { AdminShell, type AdminUser } from "@/components/admin-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, ApiError } from "@/lib/api"

export const Route = createFileRoute("/console/system-permissions")({ component: PermissionsPage })
type Node = { id: string; pid: number | null; title: string; route: string | null; children: Node[] }
type TreeData = { tree: Node[] }
type Identity = AdminUser & { roles: string[]; permissions: string[]; routes?: string[] }
type Draft = { nodeId?: string; parentId: number; title: string; route: string }
type Notice = { text: string; error: boolean }
type AccessPayload = { action: "permission-add"; context: string; parentId: number; route: string } | { action: "permission-update"; nodeId: string; context: string; route: string } | { action: "permission-delete"; nodeId: string }
const blankDraft = (parentId = 0): Draft => ({ parentId, title: "", route: "" })

function PermissionsPage() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Node | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Identity>("/api/me/"), retry: false, staleTime: 60_000 })
  const data = useQuery({ queryKey: ["system-permission-tree"], queryFn: () => api<TreeData>("/api/system-access?action=permission-tree"), enabled: !!me.data, retry: false })
  const mutation = useMutation({
    mutationFn: (payload: AccessPayload) => api<{ message: string }>("/api/system-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: async result => { setNotice({ text: result.message, error: false }); setDraft(null); setDeleteTarget(null); await client.invalidateQueries({ queryKey: ["system-permission-tree"] }) },
    onError: error => setNotice({ text: error instanceof ApiError ? error.message : "操作失败", error: true }),
  })
  const refresh = () => { setNotice(null); void data.refetch() }
  if (me.isPending) return <Loading />
  if (!me.data) return <LoginCard />
  return <AdminShell user={me.data} title="权限设置" activeRoute="admin.system.permission.index" onRefresh={refresh} onLogout={() => logout(client)}>
    <main className="mx-auto grid max-w-6xl gap-3 p-3 sm:p-5">
      {(notice || data.isError) && <NoticeBox notice={notice} error={data.error} retry={refresh} />}
      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5"><div className="flex items-center gap-2 text-sm font-semibold"><FolderTree className="size-4 text-muted-foreground" />权限树</div><div className="flex items-center gap-2"><Badge variant="secondary">{countNodes(data.data?.tree || [])} 项</Badge><Button size="sm" onClick={() => setDraft(blankDraft())}><Plus className="mr-1.5 size-4" />添加根权限</Button><Button size="icon-sm" variant="outline" aria-label="刷新" onClick={refresh}><RefreshCw className="size-4" /></Button></div></header>
        {data.isPending ? <Loading /> : data.data?.tree.length ? <div className="p-2 sm:p-3"><PermissionNodes nodes={data.data.tree} depth={0} onAdd={node => setDraft(blankDraft(Number(node.id)))} onEdit={node => setDraft({ nodeId: node.id, parentId: Number(node.pid || 0), title: node.title, route: node.route || "" })} onDelete={setDeleteTarget} busy={mutation.isPending} /></div> : <div className="p-10 text-center text-sm text-muted-foreground">暂无权限</div>}
      </section>
    </main>
    <Dialog open={!!draft} onOpenChange={open => { if (!open) setDraft(null) }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{draft?.nodeId ? "编辑权限" : draft?.parentId ? "添加子权限" : "添加根权限"}</DialogTitle></DialogHeader><div className="grid gap-3"><label className="grid gap-1.5 text-xs font-medium">权限名称<Input autoFocus maxLength={255} value={draft?.title || ""} onChange={event => setDraft(value => value ? { ...value, title: event.target.value } : value)} /></label><label className="grid gap-1.5 text-xs font-medium">路由名称<Input maxLength={255} placeholder="admin.system.example.index" value={draft?.route || ""} onChange={event => setDraft(value => value ? { ...value, route: event.target.value } : value)} /></label></div><DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>取消</Button><Button disabled={mutation.isPending || !draft?.title.trim()} onClick={() => { if (!draft) return; setNotice(null); mutation.mutate(draft.nodeId ? { action: "permission-update", nodeId: draft.nodeId, context: draft.title.trim(), route: draft.route.trim() } : { action: "permission-add", context: draft.title.trim(), parentId: draft.parentId, route: draft.route.trim() }) }}>{mutation.isPending && <LoaderCircle className="mr-1.5 size-4 animate-spin" />}保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>删除权限</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">删除「{deleteTarget?.title}」？子权限需先单独删除。</p><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => deleteTarget && mutation.mutate({ action: "permission-delete", nodeId: deleteTarget.id })}>确认删除</Button></DialogFooter></DialogContent></Dialog>
  </AdminShell>
}

function PermissionNodes({ nodes, depth, onAdd, onEdit, onDelete, busy }: { nodes: Node[]; depth: number; onAdd: (node: Node) => void; onEdit: (node: Node) => void; onDelete: (node: Node) => void; busy: boolean }) {
  return <div className="grid gap-1">{nodes.map(node => <div key={node.id} className="min-w-0"><div className="group flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted" style={{ paddingLeft: 8 + depth * 18 }}><span className="min-w-0 flex-1 truncate text-sm">{node.title}</span>{node.route && <Badge variant="outline" className="max-w-[48%] truncate font-mono text-[10px] font-normal">{node.route}</Badge>}<span className="w-10 text-right font-mono text-[10px] text-muted-foreground">#{node.id}</span><div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`添加 ${node.title} 的子权限`} onClick={() => onAdd(node)}><Plus className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`编辑 ${node.title}`} onClick={() => onEdit(node)}><Pencil className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" disabled={busy || node.children.length > 0} className="text-destructive hover:text-destructive" aria-label={`删除 ${node.title}`} onClick={() => onDelete(node)}><Trash2 className="size-3.5" /></Button></div></div>{node.children.length > 0 && <PermissionNodes nodes={node.children} depth={depth + 1} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} busy={busy} />}</div>)}</div>
}
function countNodes(nodes: Node[]): number { return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0) }
function Loading() { return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</div> }
function LoginCard() { return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-sm rounded-xl border bg-card p-5"><h1 className="mb-3 text-sm font-semibold">登录管理后台</h1><Button asChild size="sm"><a href="/api/auth/start?destination=home">管理员登录</a></Button></section></main> }
function NoticeBox({ notice, error, retry }: { notice: Notice | null; error: unknown; retry: () => void }) { return <div role={notice?.error || error ? "alert" : "status"} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice?.error || error ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-card text-muted-foreground"}`}><CircleAlert className="size-3.5" />{notice?.text || (error instanceof ApiError ? error.message : "权限数据读取失败")}<Button className="ml-auto" variant="ghost" size="icon-sm" onClick={retry} aria-label="重新加载"><RefreshCw className="size-3.5" /></Button></div> }
function logout(client: ReturnType<typeof useQueryClient>) { void api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}).finally(() => { client.clear(); location.assign("/console/home") }) }
