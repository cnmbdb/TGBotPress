import { z } from "zod"
import { can, identity, run, type Identity } from "./api.server"
import { db } from "./db.server"

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const modelType = "App\\Models\\Admin\\Admin"
const permissionPage = "admin.system.permission.index"
const rolePage = "admin.system.role.index"
type PermissionRow = { id: string; pid: number | null; title: string; route: string | null; checked?: boolean }
type PermissionNode = PermissionRow & { children: PermissionNode[] }
class AccessError extends Error { constructor(public status: number, message: string) { super(message) } }
function requirePage(user: Identity, label: string, route: string) {
  if (!can(user, "系统管理", route) || !can(user, label, route)) throw new AccessError(403, "没有访问权限")
}
function requireAction(user: Identity, label: string, route: string) {
  if (!can(user, label, route)) throw new AccessError(403, "没有操作权限")
}
function requireRoute(user: Identity, route: string) {
  if (!user.roles.includes("超级管理员") && !user.routes.includes(route)) throw new AccessError(403, "没有操作权限")
}
function requireRoleAction(user: Identity, label: string, route: string) {
  requirePage(user, "角色管理", rolePage)
  requireAction(user, label, route)
}
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get("origin") !== new URL(origin).origin || !request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError(403, "请求来源无效")
}
function permissionTree(rows: PermissionRow[]): PermissionNode[] {
  const byId = new Map(rows.map(row => [row.id, { ...row, children: [] as PermissionNode[] }]))
  const roots: PermissionNode[] = []
  for (const node of byId.values()) {
    const parent = node.pid && node.pid > 0 ? byId.get(String(node.pid)) : undefined
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }
  const reached = new Set<string>()
  const mark = (node: PermissionNode) => { if (reached.has(node.id)) return; reached.add(node.id); node.children.forEach(mark) }
  roots.forEach(mark)
  for (const node of byId.values()) if (!reached.has(node.id)) roots.push(node)
  return roots
}
async function permissionList(user: Identity) {
  requirePage(user, "权限管理", permissionPage)
  const result = await db.query("SELECT id::text AS id,pid,name AS title,route FROM t_permissions WHERE guard_name='web' ORDER BY COALESCE(pid,0),id")
  return Response.json({ tree: permissionTree(result.rows) }, { headers })
}
async function rolesList(request: Request, user: Identity) {
  requirePage(user, "角色管理", rolePage)
  const params = new URL(request.url).searchParams
  const input = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(Object.fromEntries(params))
  const count = await db.query("SELECT count(*)::int AS total FROM t_roles WHERE guard_name='web'")
  const rows = await db.query("SELECT id::text AS id,name,created_at FROM t_roles WHERE guard_name='web' ORDER BY id DESC LIMIT $1 OFFSET $2", [input.pageSize, (input.page-1)*input.pageSize])
  const permissions = {
    create: can(user, "添加角色", "admin.system.role.add"), update: can(user, "修改角色名称", "admin.system.role.update"),
    delete: can(user, "删除角色", "admin.system.role.del"), assign: can(user, "编辑角色权限", "admin.system.role.show_permissions"),
  }
  return Response.json({ rows: rows.rows, total: count.rows[0]?.total ?? 0, page: input.page, pageSize: input.pageSize, permissions }, { headers })
}
async function rolePermissionData(request: Request, user: Identity) {
  requireRoleAction(user, "编辑角色权限", "admin.system.role.show_permissions")
  const input = z.object({ id: z.coerce.number().int().positive() }).parse(Object.fromEntries(new URL(request.url).searchParams))
  const role = await db.query("SELECT id::text AS id,name FROM t_roles WHERE id=$1 AND guard_name='web'", [input.id])
  if (!role.rowCount) throw new AccessError(404, "角色不存在")
  const selected = await db.query("SELECT permission_id::text AS id FROM t_role_has_permissions rp JOIN t_permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.guard_name='web'", [input.id])
  const checked = new Set(selected.rows.map(row => String(row.id)))
  const result = await db.query("SELECT id::text AS id,pid,name AS title,route FROM t_permissions WHERE guard_name='web' ORDER BY COALESCE(pid,0),id")
  return Response.json({ role: role.rows[0], tree: permissionTree(result.rows.map(row => ({ ...row, checked: checked.has(String(row.id)) }))) }, { headers })
}
async function permissionAdd(user: Identity, input: { context: string; parentId: number; route: string }) {
  requirePage(user, "权限管理", permissionPage)
  requireRoute(user, "admin.system.permission.add")
  if (input.parentId > 0) {
    const parent = await db.query("SELECT 1 FROM t_permissions WHERE id=$1 AND guard_name='web'", [input.parentId])
    if (!parent.rowCount) throw new AccessError(400, "父级权限不存在")
  }
  const duplicate = await db.query("SELECT 1 FROM t_permissions WHERE guard_name='web' AND name=$1 AND COALESCE(pid,0)=$2", [input.context, input.parentId])
  if (duplicate.rowCount) throw new AccessError(409, "同级权限名称已存在")
  const result = await db.query("INSERT INTO t_permissions(name,pid,route,guard_name,created_at,updated_at) VALUES($1,$2,$3,'web',now(),now()) RETURNING id::text AS id", [input.context, input.parentId, input.route])
  return Response.json({ message: "权限已添加", id: result.rows[0].id }, { headers })
}
async function permissionUpdate(user: Identity, input: { nodeId: number; context: string; route: string }) {
  requirePage(user, "权限管理", permissionPage)
  requireRoute(user, "admin.system.permission.update")
  const result = await db.query("UPDATE t_permissions SET name=$2,route=$3,updated_at=now() WHERE id=$1 AND guard_name='web' RETURNING id", [input.nodeId, input.context, input.route])
  if (!result.rowCount) throw new AccessError(404, "权限不存在")
  return Response.json({ message: "权限已更新" }, { headers })
}
async function permissionDelete(user: Identity, input: { nodeId: number }) {
  requirePage(user, "权限管理", permissionPage)
  requireRoute(user, "admin.system.permission.del")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const existing = await client.query("SELECT id FROM t_permissions WHERE id=$1 AND guard_name='web' FOR UPDATE", [input.nodeId])
    if (!existing.rowCount) throw new AccessError(404, "权限不存在")
    const children = await client.query("SELECT 1 FROM t_permissions WHERE pid=$1 AND guard_name='web' LIMIT 1", [input.nodeId])
    if (children.rowCount) throw new AccessError(409, "请先删除该节点下的子权限")
    await client.query("DELETE FROM t_role_has_permissions WHERE permission_id=$1", [input.nodeId])
    await client.query("DELETE FROM t_model_has_permissions WHERE permission_id=$1", [input.nodeId])
    await client.query("DELETE FROM t_permissions WHERE id=$1", [input.nodeId])
    await client.query("COMMIT")
    return Response.json({ message: "权限已删除" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function roleAdd(user: Identity, input: { name: string }) {
  requireRoleAction(user, "添加角色", "admin.system.role.add")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`role-name:${input.name}`])
    const duplicate = await client.query("SELECT 1 FROM t_roles WHERE guard_name='web' AND name=$1", [input.name])
    if (duplicate.rowCount) throw new AccessError(409, "角色名称已存在")
    const result = await client.query("INSERT INTO t_roles(name,guard_name,created_at,updated_at) VALUES($1,'web',now(),now()) RETURNING id", [input.name])
    await client.query("COMMIT")
    return Response.json({ message: "角色已添加", id: result.rows[0].id }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function roleUpdate(user: Identity, input: { id: number; name: string }) {
  requireRoleAction(user, "修改角色名称", "admin.system.role.update")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const existing = await client.query("SELECT name FROM t_roles WHERE id=$1 AND guard_name='web' FOR UPDATE", [input.id])
    if (!existing.rowCount) throw new AccessError(404, "角色不存在")
    if (existing.rows[0].name === "超级管理员") throw new AccessError(403, "超级管理员角色不可修改")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`role-name:${input.name}`])
    const duplicate = await client.query("SELECT 1 FROM t_roles WHERE guard_name='web' AND name=$1 AND id<>$2", [input.name, input.id])
    if (duplicate.rowCount) throw new AccessError(409, "角色名称已存在")
    await client.query("UPDATE t_roles SET name=$2,updated_at=now() WHERE id=$1", [input.id, input.name])
    await client.query("COMMIT")
    return Response.json({ message: "角色名称已更新" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function roleDelete(user: Identity, input: { id: number }) {
  requireRoleAction(user, "删除角色", "admin.system.role.del")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const role = await client.query("SELECT name FROM t_roles WHERE id=$1 AND guard_name='web' FOR UPDATE", [input.id])
    if (!role.rowCount) throw new AccessError(404, "角色不存在")
    if (role.rows[0].name === "超级管理员") throw new AccessError(403, "超级管理员角色不可删除")
    await client.query("DELETE FROM t_role_has_permissions WHERE role_id=$1", [input.id])
    await client.query("DELETE FROM t_model_has_roles WHERE role_id=$1", [input.id])
    await client.query("DELETE FROM t_roles WHERE id=$1", [input.id])
    await client.query("COMMIT")
    return Response.json({ message: "角色已删除" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function roleChangePermissions(user: Identity, input: { id: number; permissionIds: number[] }) {
  requireRoleAction(user, "编辑角色权限", "admin.system.role.change_permission")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const role = await client.query("SELECT name FROM t_roles WHERE id=$1 AND guard_name='web' FOR UPDATE", [input.id])
    if (!role.rowCount) throw new AccessError(404, "角色不存在")
    if (role.rows[0].name === "超级管理员") throw new AccessError(403, "超级管理员权限不可修改")
    const ids = [...new Set(input.permissionIds)]
    const allowed = await client.query("SELECT id FROM t_permissions WHERE guard_name='web' AND id=ANY($1::bigint[])", [ids])
    if (allowed.rowCount !== ids.length) throw new AccessError(400, "权限列表已变化，请刷新后重试")
    await client.query("DELETE FROM t_role_has_permissions WHERE role_id=$1", [input.id])
    for (const id of ids) await client.query("INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES($1,$2)", [input.id,id])
    await client.query("COMMIT")
    return Response.json({ message: "角色权限已保存" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
const actionSchemas = {
  "permission-add": z.object({ action: z.literal("permission-add"), context: z.string().trim().min(1).max(255), parentId: z.coerce.number().int().min(0).default(0), route: z.string().trim().max(255).default("") }).strict(),
  "permission-update": z.object({ action: z.literal("permission-update"), nodeId: z.coerce.number().int().positive(), context: z.string().trim().min(1).max(255), route: z.string().trim().max(255).default("") }).strict(),
  "permission-delete": z.object({ action: z.literal("permission-delete"), nodeId: z.coerce.number().int().positive() }).strict(),
  "role-add": z.object({ action: z.literal("role-add"), name: z.string().trim().min(1).max(255) }).strict(),
  "role-update": z.object({ action: z.literal("role-update"), id: z.coerce.number().int().positive(), name: z.string().trim().min(1).max(255) }).strict(),
  "role-delete": z.object({ action: z.literal("role-delete"), id: z.coerce.number().int().positive() }).strict(),
  "role-change-permissions": z.object({ action: z.literal("role-change-permissions"), id: z.coerce.number().int().positive(), permissionIds: z.array(z.coerce.number().int().positive()).max(5000) }).strict(),
}
export async function systemAccessApi(request: Request) {
  return run(async () => {
    try {
      const user = await identity(request)
      if (request.method === "GET") {
        const params = new URL(request.url).searchParams
        const action = params.get("action") || "permission-tree"
        if (action === "permission-tree") return await permissionList(user)
        if (action === "roles") return await rolesList(request, user)
        if (action === "role-permissions") return await rolePermissionData(request, user)
        throw new AccessError(400, "未知查询")
      }
      if (request.method !== "POST") return Response.json({ message: "不支持的请求方法" }, { status: 405, headers })
      assertOrigin(request)
      const body = await request.json()
      const action = z.object({ action: z.string() }).passthrough().parse(body).action
      if (action === "permission-add") return await permissionAdd(user, actionSchemas[action].parse(body))
      if (action === "permission-update") return await permissionUpdate(user, actionSchemas[action].parse(body))
      if (action === "permission-delete") return await permissionDelete(user, actionSchemas[action].parse(body))
      if (action === "role-add") return await roleAdd(user, actionSchemas[action].parse(body))
      if (action === "role-update") return await roleUpdate(user, actionSchemas[action].parse(body))
      if (action === "role-delete") return await roleDelete(user, actionSchemas[action].parse(body))
      if (action === "role-change-permissions") return await roleChangePermissions(user, actionSchemas[action].parse(body))
      throw new AccessError(400, "未知操作")
    } catch (error) {
      if (error instanceof AccessError) return Response.json({ message: error.message }, { status: error.status, headers })
      throw error
    }
  })
}
