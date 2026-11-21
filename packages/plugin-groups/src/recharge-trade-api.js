import { z } from "zod";
function createApi(host) {
  const { db, can, identity, run } = host;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const statuses = { 1: "\u5F85\u5145\u503C", 7: "\u91D1\u989D\u65E0\u5BF9\u5E94\u8BA2\u5355", 8: "\u5145\u503C\u4E2D", 9: "\u5145\u503C\u6210\u529F", 4: "\u5145\u503C\u5931\u8D25", 2: "\u4EBA\u5DE5\u7981\u6B62", 3: "\u627E\u4E0D\u5230\u7528\u6237" };
  const stoppable = [1, 4, 7, 3];
  function rechargeTradeApi(request) {
    return run(async () => {
      const user = await identity(request);
      if (!can(user, "\u5145\u503C\u4EA4\u6613", "admin.groupuser.rechargetrade.index")) return Response.json({ message: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650" }, { status: 403, headers });
      if (request.method === "GET") {
        const url = new URL(request.url);
        const input = z.object({
          page: z.coerce.number().int().min(1).max(1e6).default(1),
          pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
          txHash: z.string().trim().max(100).default(""),
          fromAddress: z.string().trim().max(200).default(""),
          toAddress: z.string().trim().max(200).default("")
        }).parse(Object.fromEntries(url.searchParams));
        const pattern = (value) => `%${value.replace(/[!%_]/g, (char) => `!${char}`)}%`;
        const values = [pattern(input.txHash), pattern(input.fromAddress), pattern(input.toAddress)];
        const where = "tx_hash ILIKE $1 ESCAPE '!' AND transferfrom_address ILIKE $2 ESCAPE '!' AND transferto_address ILIKE $3 ESCAPE '!'";
        const total = await db.query(`SELECT count(*)::int AS total FROM t_fms_wallet_trade_list WHERE ${where}`, values);
        const rows = await db.query(`SELECT rid, tx_hash, transferfrom_address, transferto_address, coin_name, amount,
        to_char(to_timestamp(NULLIF("timestamp", '')::numeric / 1000) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS timestamp,
        process_status, to_char(process_time, 'YYYY-MM-DD HH24:MI:SS') AS process_time, process_comments, to_char(get_time, 'YYYY-MM-DD HH24:MI:SS') AS get_time, recharge_order_rid
        FROM t_fms_wallet_trade_list WHERE ${where} ORDER BY rid DESC LIMIT $4 OFFSET $5`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
        return Response.json({ rows: rows.rows.map((row) => ({ ...row, process_status_label: statuses[row.process_status] || `\u672A\u77E5\u72B6\u6001 (${row.process_status})`, canStop: stoppable.includes(row.process_status) })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canStop: can(user, "\u7981\u6B62\u5145\u503C", "admin.groupuser.rechargetrade.stoporder") }, { headers });
      }
      if (request.method !== "POST") return Response.json({ message: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301" }, { status: 405, headers });
      const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : "";
      if (!origin || request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548" }, { status: 403, headers });
      if (!can(user, "\u7981\u6B62\u5145\u503C", "admin.groupuser.rechargetrade.stoporder")) return Response.json({ message: "\u6CA1\u6709\u64CD\u4F5C\u6743\u9650" }, { status: 403, headers });
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 4096) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      const raw = await request.text();
      if (raw.length > 4096) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ message: "\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9" }, { status: 400, headers });
      }
      const { rid } = z.object({ action: z.literal("stoporder"), rid: z.coerce.number().int().positive().max(2147483647) }).strict().parse(body);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query("SELECT rid, process_status FROM t_fms_wallet_trade_list WHERE rid=$1 FOR UPDATE", [rid]);
        if (!found.rowCount) {
          await client.query("ROLLBACK");
          return Response.json({ message: "\u4EA4\u6613\u6570\u636E\u4E0D\u5B58\u5728" }, { status: 404, headers });
        }
        if (!stoppable.includes(found.rows[0].process_status)) {
          await client.query("ROLLBACK");
          return Response.json({ message: "\u8BE5\u72B6\u6001\u4E0D\u80FD\u7981\u6B62" }, { status: 409, headers });
        }
        await client.query("UPDATE t_fms_wallet_trade_list SET process_status=2, tg_notice_status_send='Y', process_comments='\u4EBA\u5DE5\u7981\u6B62' WHERE rid=$1", [rid]);
        await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.recharge_trade.stop", rid]);
        await client.query("COMMIT");
        return Response.json({ ok: true, message: "\u7981\u6B62\u6210\u529F" }, { headers });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }
  return rechargeTradeApi;
}
export {
  createApi
};
