import { z } from "zod";
function createGroupApi(host) {
  const { db, can, identity, run } = host;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const statusLabels = { 1: "\u4F7F\u7528\u4E2D", 2: "\u5DF2\u505C\u7528", 3: "\u7FA4\u7EC4\u4E0D\u5B58\u5728" };
  function canOpenGroupPage(user) {
    return user.roles.includes("\u8D85\u7EA7\u7BA1\u7406\u5458") || user.permissions.includes("\u7FA4\u7EC4\u7528\u6237") && user.permissions.includes("\u7FA4\u7EC4\u5217\u8868");
  }
  function canGroupAction(user, permission, route) {
    return canOpenGroupPage(user) && can(user, permission, route);
  }
  function groupApi(request) {
    return run(async () => {
      const user = await identity(request);
      if (!canOpenGroupPage(user)) return Response.json({ message: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650" }, { status: 403, headers });
      if (request.method === "GET") {
        const url = new URL(request.url);
        if (url.searchParams.get("action") === "options") {
          const bots = await db.query("SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC");
          return Response.json({ bots: bots.rows }, { headers });
        }
        const input = z.object({
          page: z.coerce.number().int().min(1).max(1e6).default(1),
          pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
          search: z.string().trim().max(200).default(""),
          botRid: z.union([z.literal("all"), z.coerce.number().int().positive()]).default("all")
        }).parse(Object.fromEntries(url.searchParams));
        const cleaned = input.search.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
        const pattern = `%${cleaned.replace(/[!%_]/g, (char) => `!${char}`)}%`;
        const bot = input.botRid === "all" ? null : input.botRid;
        const where = "($1='%%' OR a.tg_groupusername ILIKE $1 ESCAPE '!') AND ($2::int IS NULL OR a.bot_rid=$2)";
        const total = await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot_group a WHERE ${where}`, [pattern, bot]);
        const rows = await db.query(`SELECT a.rid,a.bot_rid,a.group_type,a.tg_groupid::text AS tg_groupid,a.tg_groupusername,a.tg_groupnickname,a.status,a.is_admin,
        to_char(a.first_time,'YYYY-MM-DD HH24:MI:SS') AS first_time,to_char(a.last_time,'YYYY-MM-DD HH24:MI:SS') AS last_time,
        to_char(a.stop_time,'YYYY-MM-DD HH24:MI:SS') AS stop_time,a.follow_count,b.bot_firstname,b.bot_username
        FROM t_telegram_bot_group a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where}
        ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [pattern, bot, input.pageSize, (input.page - 1) * input.pageSize]);
        return Response.json({ rows: rows.rows.map((row) => ({ ...row, status_label: statusLabels[row.status] || `\u672A\u77E5\u72B6\u6001 (${row.status})`, is_admin_label: row.is_admin === "Y" ? "\u7BA1\u7406\u5458" : "\u666E\u901A" })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, permissions: { send: canGroupAction(user, "\u53D1\u9001\u6D88\u606F", "admin.groupuser.group.sendmessage"), delete: canGroupAction(user, "\u5220\u9664\u7FA4\u7EC4", "admin.groupuser.group.delete") }, telegramEnabled: process.env.PLATFORM_TELEGRAM_ACTIONS === "true" }, { headers });
      }
      if (request.method !== "POST") return Response.json({ message: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301" }, { status: 405, headers });
      const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : "";
      if (!origin || request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548" }, { status: 403, headers });
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 8192) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      const raw = await request.text();
      if (raw.length > 8192) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ message: "\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9" }, { status: 400, headers });
      }
      const action = z.object({ action: z.enum(["sendmessage", "delete"]) }).parse(body).action;
      const rid = z.object({ rid: z.coerce.number().int().positive().max(2147483647) }).parse(body).rid;
      if (action === "delete") {
        if (!canGroupAction(user, "\u5220\u9664\u7FA4\u7EC4", "admin.groupuser.group.delete")) return Response.json({ message: "\u6CA1\u6709\u64CD\u4F5C\u6743\u9650" }, { status: 403, headers });
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const deleted = await client.query("DELETE FROM t_telegram_bot_group WHERE rid=$1 RETURNING rid", [rid]);
          if (!deleted.rowCount) {
            await client.query("ROLLBACK");
            return Response.json({ message: "\u6570\u636E\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664" }, { status: 404, headers });
          }
          await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.group.delete", rid]);
          await client.query("COMMIT");
          return Response.json({ ok: true, message: "\u5220\u9664\u6210\u529F" }, { headers });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      if (!canGroupAction(user, "\u53D1\u9001\u6D88\u606F", "admin.groupuser.group.sendmessage")) return Response.json({ message: "\u6CA1\u6709\u64CD\u4F5C\u6743\u9650" }, { status: 403, headers });
      const message = z.object({ message: z.string().trim().min(1).max(4096) }).parse(body).message;
      const record = await db.query(`SELECT g.rid,g.bot_rid,g.tg_groupid::text AS tg_groupid,g.status,b.bot_token
      FROM t_telegram_bot_group g LEFT JOIN t_telegram_bot b ON b.rid=g.bot_rid WHERE g.rid=$1`, [rid]);
      if (!record.rowCount) return Response.json({ message: "\u6570\u636E\u4E0D\u5B58\u5728" }, { status: 404, headers });
      const group = record.rows[0];
      if (group.status !== 1) return Response.json({ message: "\u7FA4\u7EC4\u72B6\u6001\u4E0D\u4E3A\u4F7F\u7528\u4E2D" }, { status: 409, headers });
      if (!group.bot_token) return Response.json({ message: "\u673A\u5668\u4EBA\u6570\u636E\u4E0D\u5B58\u5728\u6216\u672A\u914D\u7F6E Token" }, { status: 409, headers });
      if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return Response.json({ message: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528\u5916\u90E8\u673A\u5668\u4EBA\u64CD\u4F5C" }, { status: 409, headers });
      let telegram;
      try {
        const response = await fetch(`https://api.telegram.org/bot${group.bot_token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: group.tg_groupid, text: message, parse_mode: "HTML" }), signal: AbortSignal.timeout(12e3) });
        telegram = await response.json();
      } catch {
        return Response.json({ message: "\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5668\u7F51\u7EDC\u540E\u91CD\u8BD5" }, { status: 502, headers });
      }
      if (telegram.ok && telegram.result) {
        await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.group.send_message", rid]);
        return Response.json({ ok: true, message: "\u53D1\u9001\u6210\u529F" }, { headers });
      }
      const description = telegram.description || "Telegram \u8FD4\u56DE\u672A\u77E5\u9519\u8BEF";
      let changedStatus = null;
      if (description === "Forbidden: user is deactivated") changedStatus = 3;
      else if (description === "Forbidden: bot was kicked from the supergroup chat") changedStatus = 2;
      if (changedStatus) await db.query("UPDATE t_telegram_bot_group SET status=$2,stop_time=now() WHERE rid=$1 AND status=1", [rid, changedStatus]);
      return Response.json({ message: `\u53D1\u9001\u5931\u8D25\uFF1A${description}` }, { status: 502, headers });
    });
  }
  return groupApi;
}
export {
  createGroupApi
};
