import { z } from "zod";
function createUsersApi(host) {
  const { db, can, identity, run } = host;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const statusLabels = { 1: "\u4F7F\u7528\u4E2D", 2: "\u5DF2\u505C\u7528", 3: "\u7528\u6237\u4E0D\u5B58\u5728" };
  const actionable = ["\u53D1\u9001\u6D88\u606F", "\u7FA4\u53D1\u6D88\u606F", "\u7528\u6237\u5145\u503C", "\u5220\u9664\u7528\u6237", "\u6279\u91CF\u5220\u9664\u505C\u7528"];
  function permissions(user) {
    return Object.fromEntries(actionable.map((name) => [name, can(user, name, `admin.groupuser.user.${name === "\u7528\u6237\u5145\u503C" ? "rechargemanual" : name === "\u5220\u9664\u7528\u6237" ? "delete" : name === "\u6279\u91CF\u5220\u9664\u505C\u7528" ? "batchdelete" : name === "\u7FA4\u53D1\u6D88\u606F" ? "batchsendmessage" : "sendmessage"}`)]));
  }
  function originAllowed(request) {
    const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : "";
    return !!origin && request.headers.get("origin") === origin && !!request.headers.get("content-type")?.startsWith("application/json");
  }
  async function telegramSend(token, chatId, message) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return { ok: false, description: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528\u5916\u90E8\u673A\u5668\u4EBA\u64CD\u4F5C" };
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }), signal: AbortSignal.timeout(12e3) });
      return await response.json();
    } catch {
      return { ok: false, description: "Telegram \u63A5\u53E3\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5" };
    }
  }
  function usersApi(request) {
    return run(async () => {
      const user = await identity(request);
      if (!can(user, "\u7528\u6237\u5217\u8868", "admin.groupuser.user.index")) return Response.json({ message: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650" }, { status: 403, headers });
      if (request.method === "GET") {
        const url = new URL(request.url);
        if (url.searchParams.get("action") === "options") {
          const bots = await db.query("SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC");
          return Response.json({ bots: bots.rows }, { headers });
        }
        const input = z.object({ page: z.coerce.number().int().min(1).max(1e6).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), username: z.string().trim().max(200).default(""), uid: z.string().trim().max(100).default(""), nickname: z.string().trim().max(200).default(""), botRid: z.union([z.literal("all"), z.coerce.number().int().positive()]).default("all") }).parse(Object.fromEntries(url.searchParams));
        const clean = input.username.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
        const like = (v) => `%${v.replace(/[!%_]/g, (c) => `!${c}`)}%`;
        const values = [like(clean), like(input.uid), like(input.nickname), input.botRid === "all" ? null : input.botRid];
        const where = "($1='%%' OR a.tg_username ILIKE $1 ESCAPE '!') AND ($2='%%' OR a.tg_uid::text ILIKE $2 ESCAPE '!') AND ($3='%%' OR a.tg_nickname ILIKE $3 ESCAPE '!') AND ($4::int IS NULL OR a.bot_rid=$4)";
        const total = await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot_user a WHERE ${where}`, values);
        const rows = await db.query(`SELECT a.rid,a.bot_rid,a.tg_uid::text AS tg_uid,a.tg_username,a.tg_nickname,a.status,a.bind_trc_wallet_addr,a.cash_trx::text AS cash_trx,a.cash_usdt::text AS cash_usdt,a.max_monitor_wallet,
    to_char(a.first_time,'YYYY-MM-DD HH24:MI:SS') AS first_time,to_char(a.last_time,'YYYY-MM-DD HH24:MI:SS') AS last_time,to_char(a.stop_time,'YYYY-MM-DD HH24:MI:SS') AS stop_time,b.bot_firstname,b.bot_username
    FROM t_telegram_bot_user a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where} ORDER BY a.rid DESC LIMIT $5 OFFSET $6`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
        return Response.json({ rows: rows.rows.map((row) => ({ ...row, status_label: statusLabels[row.status] || `\u672A\u77E5\u72B6\u6001 (${row.status})` })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, permissions: permissions(user), telegramEnabled: process.env.PLATFORM_TELEGRAM_ACTIONS === "true" }, { headers });
      }
      if (request.method !== "POST") return Response.json({ message: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301" }, { status: 405, headers });
      if (!originAllowed(request)) return Response.json({ message: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548" }, { status: 403, headers });
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 12e3) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      const raw = await request.text();
      if (raw.length > 12e3) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ message: "\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9" }, { status: 400, headers });
      }
      const action = z.object({ action: z.enum(["sendmessage", "batchsendmessage", "rechargemanual", "delete", "batchdelete"]) }).parse(body).action;
      const rights = permissions(user);
      const rightsForAction = { sendmessage: "\u53D1\u9001\u6D88\u606F", batchsendmessage: "\u7FA4\u53D1\u6D88\u606F", rechargemanual: "\u7528\u6237\u5145\u503C", delete: "\u5220\u9664\u7528\u6237", batchdelete: "\u6279\u91CF\u5220\u9664\u505C\u7528" };
      if (!rights[rightsForAction[action]]) return Response.json({ message: "\u6CA1\u6709\u64CD\u4F5C\u6743\u9650" }, { status: 403, headers });
      const id = z.coerce.number().int().positive().max(2147483647);
      if (action === "sendmessage") {
        const data2 = z.object({ action: z.literal("sendmessage"), rid: id, message: z.string().trim().min(1).max(4096) }).strict().parse(body);
        const result = await db.query("SELECT u.rid,u.bot_rid,u.tg_uid::text AS tg_uid,u.status,b.bot_token FROM t_telegram_bot_user u LEFT JOIN t_telegram_bot b ON b.rid=u.bot_rid WHERE u.rid=$1", [data2.rid]);
        if (!result.rowCount) return Response.json({ message: "\u6570\u636E\u4E0D\u5B58\u5728" }, { status: 404, headers });
        const row = result.rows[0];
        if (row.status !== 1) return Response.json({ message: "\u7528\u6237\u72B6\u6001\u4E0D\u4E3A\u4F7F\u7528\u4E2D" }, { status: 409, headers });
        if (!row.bot_token) return Response.json({ message: "\u673A\u5668\u4EBA\u6570\u636E\u4E0D\u5B58\u5728\u6216\u672A\u914D\u7F6E Token" }, { status: 409, headers });
        const sent = await telegramSend(row.bot_token, row.tg_uid, data2.message);
        if (sent.ok && sent.result) {
          await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.user.send_message", data2.rid]);
          return Response.json({ ok: true, message: "\u53D1\u9001\u6210\u529F" }, { headers });
        }
        if (sent.description === "Forbidden: user is deactivated") await db.query("UPDATE t_telegram_bot_user SET status=3,stop_time=now() WHERE rid=$1 AND status=1", [data2.rid]);
        return Response.json({ message: `\u53D1\u9001\u5931\u8D25\uFF1A${sent.description || "Telegram \u8FD4\u56DE\u672A\u77E5\u9519\u8BEF"}` }, { status: 502, headers });
      }
      if (action === "batchsendmessage") {
        if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return Response.json({ message: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528\u5916\u90E8\u673A\u5668\u4EBA\u64CD\u4F5C" }, { status: 409, headers });
        const data2 = z.object({ action: z.literal("batchsendmessage"), bot_rid: id, message: z.string().trim().min(1).max(4096) }).strict().parse(body);
        const bot = await db.query("SELECT bot_token FROM t_telegram_bot WHERE rid=$1", [data2.bot_rid]);
        if (!bot.rowCount || !bot.rows[0].bot_token) return Response.json({ message: "\u673A\u5668\u4EBA\u6570\u636E\u4E0D\u5B58\u5728\u6216\u672A\u914D\u7F6E Token" }, { status: 404, headers });
        const recipients = await db.query("SELECT rid,tg_uid::text AS tg_uid FROM t_telegram_bot_user WHERE bot_rid=$1 AND status=1 ORDER BY rid", [data2.bot_rid]);
        if (!recipients.rowCount) return Response.json({ message: "\u673A\u5668\u4EBA\u65E0\u7528\u6237\u6570\u636E" }, { status: 409, headers });
        let sentCount = 0, failedCount = 0, deactivatedCount = 0;
        for (let i = 0; i < recipients.rows.length; i += 5) {
          const batch = recipients.rows.slice(i, i + 5);
          const results = await Promise.all(batch.map(async (recipient) => ({ recipient, result: await telegramSend(bot.rows[0].bot_token, recipient.tg_uid, data2.message) })));
          const inactive = results.filter((item) => item.result.description === "Forbidden: user is deactivated").map((item) => item.recipient.rid);
          sentCount += results.filter((item) => item.result.ok && item.result.result).length;
          failedCount += results.filter((item) => !item.result.ok || !item.result.result).length;
          deactivatedCount += inactive.length;
          if (inactive.length) await db.query("UPDATE t_telegram_bot_user SET status=3,stop_time=now() WHERE rid=ANY($1::int[]) AND status=1", [inactive]);
        }
        await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.user.broadcast", data2.bot_rid]);
        return Response.json({ ok: true, message: `\u7FA4\u53D1\u5B8C\u6210\uFF1A\u6210\u529F ${sentCount}\uFF0C\u5931\u8D25 ${failedCount}\uFF0C\u505C\u7528 ${deactivatedCount}` }, { headers });
      }
      if (action === "rechargemanual") {
        const money = z.string().trim().regex(/^\d{1,14}(?:\.\d{1,6})?$/, "\u4F59\u989D\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57\uFF0C\u6700\u591A 6 \u4F4D\u5C0F\u6570").optional().or(z.literal(""));
        const data2 = z.object({ action: z.literal("rechargemanual"), rid: id, cash_trx: money, cash_usdt: money, max_monitor_wallet: z.string().trim().regex(/^\d{1,10}$/, "\u6570\u91CF\u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570").optional().or(z.literal("")) }).strict().parse(body);
        const updates = [];
        if (data2.cash_trx) updates.push(["cash_trx", data2.cash_trx]);
        if (data2.cash_usdt) updates.push(["cash_usdt", data2.cash_usdt]);
        if (data2.max_monitor_wallet) updates.push(["max_monitor_wallet", data2.max_monitor_wallet]);
        if (!updates.length) return Response.json({ message: "\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u4E2A\u5145\u503C\u9879" }, { status: 400, headers });
        const client2 = await db.connect();
        try {
          await client2.query("BEGIN");
          const current = await client2.query("SELECT rid FROM t_telegram_bot_user WHERE rid=$1 FOR UPDATE", [data2.rid]);
          if (!current.rowCount) {
            await client2.query("ROLLBACK");
            return Response.json({ message: "\u7528\u6237\u4E0D\u5B58\u5728" }, { status: 404, headers });
          }
          const fields = updates.map(([key]) => key), values = updates.map(([, value]) => value), set = fields.map((field, index) => `${field}=$${index + 2}`).join(",");
          await client2.query(`UPDATE t_telegram_bot_user SET ${set} WHERE rid=$1`, [data2.rid, ...values]);
          await client2.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.user.manual_recharge", data2.rid]);
          await client2.query("COMMIT");
          return Response.json({ ok: true, message: "\u5145\u503C\u6210\u529F" }, { headers });
        } catch (error) {
          await client2.query("ROLLBACK");
          throw error;
        } finally {
          client2.release();
        }
      }
      if (action === "delete") {
        const data2 = z.object({ action: z.literal("delete"), rid: id }).strict().parse(body);
        const client2 = await db.connect();
        try {
          await client2.query("BEGIN");
          const deleted = await client2.query("DELETE FROM t_telegram_bot_user WHERE rid=$1 RETURNING rid", [data2.rid]);
          if (!deleted.rowCount) {
            await client2.query("ROLLBACK");
            return Response.json({ message: "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664" }, { status: 404, headers });
          }
          await client2.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.user.delete", data2.rid]);
          await client2.query("COMMIT");
          return Response.json({ ok: true, message: "\u5220\u9664\u6210\u529F" }, { headers });
        } catch (error) {
          await client2.query("ROLLBACK");
          throw error;
        } finally {
          client2.release();
        }
      }
      const data = z.object({ action: z.literal("batchdelete"), bot_rid: id }).strict().parse(body);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const deleted = await client.query("DELETE FROM t_telegram_bot_user WHERE bot_rid=$1 AND status IN (2,3) RETURNING rid", [data.bot_rid]);
        if (!deleted.rowCount) {
          await client.query("ROLLBACK");
          return Response.json({ message: "\u6CA1\u6709\u53EF\u5220\u9664\u7684\u505C\u7528\u7528\u6237" }, { status: 404, headers });
        }
        await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.user.batch_delete_inactive", data.bot_rid]);
        await client.query("COMMIT");
        return Response.json({ ok: true, message: `\u5DF2\u5220\u9664 ${deleted.rowCount} \u4E2A\u505C\u7528\u7528\u6237` }, { headers });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }
  return usersApi;
}
export {
  createUsersApi
};
