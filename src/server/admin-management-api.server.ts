import { z } from "zod"
import { can, identity, run, type Identity } from "./api.server"
import { db } from "./db.server"
import { cookies, digest } from "./security"

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const modelType = "App\\Models\\Admin\\Admin"
const adminRoute = "admin.system.admin.index"
const createSchema = z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(30), password: z.string().min(1).max(128), whiteIp: z.string().trim().max(3000).default(""), status: z.boolean().default(true) }).strict()
const updateSchema = z.object({ action: z.literal("update"), id: z.coerce.number().int().positive(), name: z.string().trim().min(1).max(30), password: z.string().max(128).optional().default(""), whiteIp: z.string().trim().max(3000).default(""), roleIds: z.array(z.coerce.number().int().positive()).max(100).default([]) }).strict()
const statusSchema = z.object({ action: z.literal("set-status"), id: z.coerce.number().int().positive(), enabled: z.boolean() }).strict()
const deleteSchema = z.object({ action: z.literal("delete"), id: z.coerce.number().int().positive() }).strict()
const passwordSchema = z.object({ action: z.literal("change-password"), oldPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128), confirmPassword: z.string().min(1).max(128) }).strict()
class AdminError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
function requireView(user: Identity) {
  if (!can(user, "系统管理", adminRoute) || !can(user, "管理员管理", adminRoute)) throw new AdminError(403, "没有访问权限")
}
function requireAction(user: Identity, permission: string, route: string) {
  if (!can(user, permission, route)) throw new AdminError(403, "没有操作权限")
}
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get("origin") !== new URL(origin).origin || !request.headers.get("content-type")?.startsWith("application/json")) throw new AdminError(403, "请求来源无效")
}
async function audit(client: any, adminId: string, action: string, resourceId?: number) {
  await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [adminId, action, resourceId ?? null])
}
async function list(request: Request, user: Identity) {
  requireView(user)
  const params = new URL(request.url).searchParams
  const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), name: z.string().trim().max(30).default("") }).parse(Object.fromEntries(params))
  const values = input.name ? [input.name] : []
  const filter = input.name ? "WHERE a.name=$1" : ""
  const count = await db.query(`SELECT count(*)::int AS total FROM t_admin a ${filter}`, values)
  const pageValues = input.name ? [input.name, input.pageSize, (input.page - 1) * input.pageSize] : [input.pageSize, (input.page - 1) * input.pageSize]
  const limitParam = input.name ? "$2" : "$1", offsetParam = input.name ? "$3" : "$2"
  const rows = await db.query(`SELECT a.id::text AS id,a.name,a.status,a.white_ip,a.created_at,
      COALESCE(array_agg(m.role_id ORDER BY m.role_id) FILTER (WHERE m.role_id IS NOT NULL),ARRAY[]::bigint[]) AS role_ids,
      COALESCE(json_agg(json_build_object('id',r.id,'name',r.name) ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL),'[]'::json) AS roles
    FROM t_admin a LEFT JOIN t_model_has_roles m ON m.model_id=a.id AND m.model_type=$${pageValues.length + 1}
    LEFT JOIN t_roles r ON r.id=m.role_id AND r.guard_name='web' ${filter}
    GROUP BY a.id ORDER BY a.id DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
    input.name ? [...pageValues, modelType] : [...pageValues, modelType])
  const roles = await db.query("SELECT id::text AS id,name FROM t_roles WHERE guard_name='web' ORDER BY name,id")
  return Response.json({ rows: rows.rows, total: count.rows[0]?.total ?? 0, page: input.page, pageSize: input.pageSize, roles: roles.rows,
    permissions: {
      create: can(user, "添加管理员", "admin.system.admin.add"), status: can(user, "修改管理员状态", "admin.system.admin.change_status"),
      update: can(user, "修改管理员资料", "admin.system.admin.update"), delete: can(user, "删除管理员", "admin.system.admin.delete"),
    }, currentAdminId: user.id }, { headers })
}
async function storedPassword(plain: string) {
  const result = await db.query("SELECT '$2y$' || substring(crypt($1, gen_salt('bf', 12)) from 5) AS password", [plain])
  const hash = String(result.rows[0]?.password || "")
  if (!/^\$2y\$12\$[./A-Za-z0-9]{53}$/.test(hash)) throw new AdminError(503, "密码服务不可用")
  return hash
}
function bcryptSalt(hash: string) { return hash.startsWith("$2y$") ? `$2a$${hash.slice(4)}` : hash }
async function passwordMatches(plain: string, hash: string) {
  if (/^\$2[aby]\$/.test(hash)) {
    const checked = await db.query("SELECT crypt($1,$2)=$2 AS valid", [plain, bcryptSalt(hash)])
    return Boolean(checked.rows[0]?.valid)
  }
  const legacy = await db.query("SELECT $1=md5($2) AS valid", [hash, plain])
  return Boolean(legacy.rows[0]?.valid)
}
async function ensureSuperAdminRemains(client: any) {
  const result = await client.query(`SELECT count(*)::int AS total FROM t_admin a
    JOIN t_model_has_roles m ON m.model_id=a.id AND m.model_type=$1
    JOIN t_roles r ON r.id=m.role_id AND r.guard_name='web' AND r.name='超级管理员'
    WHERE a.status=1`, [modelType])
  if (Number(result.rows[0]?.total || 0) <= 1) throw new AdminError(400, "至少保留一位已启用的超级管理员")
}
async function create(user: Identity, input: z.infer<typeof createSchema>) {
  requireAction(user, "添加管理员", "admin.system.admin.add")
  const hash = await storedPassword(input.password)
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`admin-name:${input.name}`])
    const duplicate = await client.query("SELECT 1 FROM t_admin WHERE name=$1", [input.name])
    if (duplicate.rowCount) throw new AdminError(409, "管理员账号已存在")
    const result = await client.query("INSERT INTO t_admin(name,password,status,white_ip,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) RETURNING id", [input.name, hash, input.status ? 1 : 0, input.whiteIp])
    const id = Number(result.rows[0].id)
    await audit(client, user.id, "admin.create", id)
    await client.query("COMMIT")
    return Response.json({ message: "管理员已创建" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function update(request: Request, user: Identity, input: z.infer<typeof updateSchema>) {
  requireAction(user, "修改管理员资料", "admin.system.admin.update")
  const roleIds = [...new Set(input.roleIds)]
  const roleRows = await db.query("SELECT id,name FROM t_roles WHERE guard_name='web' AND id=ANY($1::bigint[])", [roleIds])
  if (roleRows.rowCount !== roleIds.length) throw new AdminError(400, "用户组已失效，请刷新后重试")
  if (!user.roles.includes("超级管理员") && roleRows.rows.some((row: { name: string }) => row.name === "超级管理员")) throw new AdminError(403, "没有分配超级管理员角色的权限")
  const hash = input.password ? await storedPassword(input.password) : null
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const existing = await client.query("SELECT id,status FROM t_admin WHERE id=$1 FOR UPDATE", [input.id])
    if (!existing.rowCount) throw new AdminError(404, "管理员不存在")
    const oldRoles = await client.query(`SELECT r.name FROM t_model_has_roles m JOIN t_roles r ON r.id=m.role_id
      WHERE m.model_type=$1 AND m.model_id=$2 AND r.guard_name='web'`, [modelType, input.id])
    if (Number(existing.rows[0].status) === 1 && oldRoles.rows.some((role: { name: string }) => role.name === "超级管理员")
      && !roleRows.rows.some((role: { name: string }) => role.name === "超级管理员")) await ensureSuperAdminRemains(client)
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`admin-name:${input.name}`])
    const duplicate = await client.query("SELECT 1 FROM t_admin WHERE name=$1 AND id<>$2", [input.name, input.id])
    if (duplicate.rowCount) throw new AdminError(409, "管理员账号已存在")
    await client.query("UPDATE t_admin SET name=$2,password=COALESCE($3,password),white_ip=$4,updated_at=now() WHERE id=$1", [input.id, input.name, hash, input.whiteIp])
    await client.query("DELETE FROM t_model_has_roles WHERE model_type=$1 AND model_id=$2", [modelType, input.id])
    for (const roleId of roleIds) await client.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES($1,$2,$3)", [roleId, modelType, input.id])
    if (hash) {
      await client.query("DELETE FROM t_platform_auth_ticket WHERE admin_id=$1", [input.id])
      const raw = cookies(request)["tg_platform_session"]
      const currentDevice = input.id === Number(user.id) && raw
        ? await client.query("SELECT device_session_id FROM t_platform_session WHERE token_hash=$1 AND admin_id=$2", [digest(raw), input.id])
        : { rows: [] }
      const currentDeviceId = currentDevice.rows[0]?.device_session_id ?? null
      await client.query("DELETE FROM t_platform_session WHERE admin_id=$1 AND ($2::bigint IS NULL OR device_session_id<>$2)", [input.id, currentDeviceId])
      await client.query("UPDATE t_admin_device_session SET revoked_at=COALESCE(revoked_at,now()) WHERE admin_id=$1 AND ($2::bigint IS NULL OR rid<>$2)", [input.id, currentDeviceId])
    }
    await audit(client, user.id, "admin.update", input.id)
    await client.query("COMMIT")
    return Response.json({ message: "管理员资料已更新" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function setStatus(user: Identity, input: z.infer<typeof statusSchema>) {
  requireAction(user, "修改管理员状态", "admin.system.admin.change_status")
  if (String(input.id) === user.id && !input.enabled) throw new AdminError(400, "不能禁用当前登录账号")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const target = await client.query(`SELECT a.id,a.status,EXISTS(SELECT 1 FROM t_model_has_roles m JOIN t_roles r ON r.id=m.role_id
      WHERE m.model_id=a.id AND m.model_type=$2 AND r.guard_name='web' AND r.name='超级管理员') AS is_super_admin
      FROM t_admin a WHERE a.id=$1 FOR UPDATE`, [input.id, modelType])
    if (!target.rowCount) throw new AdminError(404, "管理员不存在")
    if (!input.enabled && Number(target.rows[0].status) === 1 && target.rows[0].is_super_admin) await ensureSuperAdminRemains(client)
    const result = await client.query("UPDATE t_admin SET status=$2,updated_at=now() WHERE id=$1 RETURNING id", [input.id, input.enabled ? 1 : 0])
    if (!input.enabled) {
      await client.query("DELETE FROM t_platform_auth_ticket WHERE admin_id=$1", [input.id])
      await client.query("DELETE FROM t_platform_session WHERE admin_id=$1", [input.id])
      await client.query("UPDATE t_admin_device_session SET revoked_at=COALESCE(revoked_at,now()) WHERE admin_id=$1", [input.id])
    }
    await audit(client, user.id, input.enabled ? "admin.enable" : "admin.disable", input.id)
    await client.query("COMMIT")
    return Response.json({ message: input.enabled ? "管理员已启用" : "管理员已禁用" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function remove(user: Identity, input: z.infer<typeof deleteSchema>) {
  requireAction(user, "删除管理员", "admin.system.admin.delete")
  if (String(input.id) === user.id) throw new AdminError(400, "不能删除当前登录账号")
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const exists = await client.query(`SELECT a.id,a.status,EXISTS(SELECT 1 FROM t_model_has_roles m JOIN t_roles r ON r.id=m.role_id
      WHERE m.model_id=a.id AND m.model_type=$2 AND r.guard_name='web' AND r.name='超级管理员') AS is_super_admin
      FROM t_admin a WHERE a.id=$1 FOR UPDATE`, [input.id, modelType])
    if (!exists.rowCount) throw new AdminError(404, "管理员不存在")
    if (Number(exists.rows[0].status) === 1 && exists.rows[0].is_super_admin) await ensureSuperAdminRemains(client)
    await client.query("DELETE FROM t_platform_auth_ticket WHERE admin_id=$1", [input.id])
    await client.query("DELETE FROM t_platform_session WHERE admin_id=$1", [input.id])
    await client.query("DELETE FROM t_admin_passkey WHERE admin_id=$1", [input.id])
    await client.query("UPDATE t_admin_device_session SET revoked_at=COALESCE(revoked_at,now()) WHERE admin_id=$1", [input.id])
    await client.query("DELETE FROM t_model_has_roles WHERE model_type=$1 AND model_id=$2", [modelType, input.id])
    await client.query("DELETE FROM t_model_has_permissions WHERE model_type=$1 AND model_id=$2", [modelType, input.id])
    await audit(client, user.id, "admin.delete", input.id)
    await client.query("DELETE FROM t_admin WHERE id=$1", [input.id])
    await client.query("COMMIT")
    return Response.json({ message: "管理员已删除" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
async function changePassword(request: Request, user: Identity, input: z.infer<typeof passwordSchema>) {
  if (input.newPassword !== input.confirmPassword) throw new AdminError(400, "新密码与确认密码不一致")
  const current = await db.query("SELECT password FROM t_admin WHERE id=$1", [user.id])
  if (!current.rowCount || !(await passwordMatches(input.oldPassword, String(current.rows[0].password)))) throw new AdminError(400, "原密码错误")
  const hash = await storedPassword(input.newPassword)
  const raw = cookies(request)["tg_platform_session"]
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    await client.query("UPDATE t_admin SET password=$2,updated_at=now() WHERE id=$1", [user.id, hash])
    const currentDevice = raw ? await client.query("SELECT device_session_id FROM t_platform_session WHERE token_hash=$1 AND admin_id=$2", [digest(raw), user.id]) : { rows: [] }
    const currentDeviceId = currentDevice.rows[0]?.device_session_id ?? null
    await client.query("DELETE FROM t_platform_session WHERE admin_id=$1 AND ($2::bigint IS NULL OR device_session_id<>$2)", [user.id, currentDeviceId])
    await client.query("DELETE FROM t_platform_auth_ticket WHERE admin_id=$1", [user.id])
    await client.query("UPDATE t_admin_device_session SET revoked_at=COALESCE(revoked_at,now()) WHERE admin_id=$1 AND ($2::bigint IS NULL OR rid<>$2)", [user.id, currentDeviceId])
    await audit(client, user.id, "admin.change-password")
    await client.query("COMMIT")
    return Response.json({ message: "密码已更新" }, { headers })
  } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
}
export async function adminManagementApi(request: Request) {
  return run(async () => {
    try {
      const user = await identity(request)
      if (request.method === "GET") return await list(request, user)
      if (request.method !== "POST") return Response.json({ message: "不支持的请求方法" }, { status: 405, headers })
      assertOrigin(request)
      const body = await request.json()
      const action = z.object({ action: z.string() }).passthrough().parse(body).action
      if (action === "change-password") return await changePassword(request, user, passwordSchema.parse(body))
      requireView(user)
      if (action === "create") return await create(user, createSchema.parse(body))
      if (action === "update") return await update(request, user, updateSchema.parse(body))
      if (action === "set-status") return await setStatus(user, statusSchema.parse(body))
      if (action === "delete") return await remove(user, deleteSchema.parse(body))
      throw new AdminError(400, "未知操作")
    } catch (error) {
      if (error instanceof AdminError) return Response.json({ message: error.message }, { status: error.status, headers })
      throw error
    }
  })
}
