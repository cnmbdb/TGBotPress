import { z } from "zod";
function createModerationApi(host) {
  const { db, can, identity, run, scanRecentGroupMessages, telegramVerificationApi, customGroupAdKeywords } = host;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const labels = { event: { group_ad: "\u7FA4\u5E7F\u544A", flood: "\u9AD8\u9891\u53D1\u8A00", join_request_screening: "\u5165\u7FA4\u9A8C\u8BC1", manual_governance_release: "\u624B\u52A8\u89E3\u9664", new_member: "\u65B0\u6210\u5458" }, action: { delete: "\u5220\u9664\u6D88\u606F", verify: "\u9A8C\u8BC1", restrict: "\u7981\u8A00", restrict_forever: "\u6C38\u4E45\u7981\u8A00", ban: "\u62C9\u9ED1\u8E22\u51FA", approve: "\u6279\u51C6", failed: "\u5931\u8D25", release: "\u89E3\u9664", kick: "\u8E22\u51FA" }, verification: { join_request: "\u5165\u7FA4\u7533\u8BF7", join_captcha: "\u5165\u7FA4\u9A8C\u8BC1", ad: "\u5E7F\u544A\u9A8C\u8BC1", support: "\u5BA2\u670D\u9A8C\u8BC1" }, status: { pending: "\u5F85\u9A8C\u8BC1", verified: "\u5DF2\u901A\u8FC7", expired: "\u5DF2\u8FC7\u671F", failed: "\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88" } };
  const originAllowed = (request) => {
    const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : "";
    return !!expected && request.headers.get("origin") === expected && !!request.headers.get("content-type")?.startsWith("application/json");
  };
  const bool = z.boolean();
  const minutes = z.coerce.number().int();
  async function actionAllowed(user, route) {
    const configured = await db.query("SELECT 1 FROM t_permissions WHERE guard_name='web' AND route=$1 LIMIT 1", [route]);
    return !configured.rowCount || can(user, "", route);
  }
  async function telegram(token, method, payload) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return { ok: false, description: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528\u5916\u90E8\u673A\u5668\u4EBA\u64CD\u4F5C" };
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12e3) });
      return await response.json();
    } catch {
      return { ok: false, description: "Telegram \u63A5\u53E3\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5" };
    }
  }
  function moderationApi(request) {
    return run(async () => {
      if (new URL(request.url).searchParams.has("verify")) return telegramVerificationApi(request);
      const user = await identity(request);
      if (!can(user, "\u7FA4\u7EC4\u7528\u6237", "admin.groupuser.moderation.index")) return Response.json({ message: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650" }, { status: 403, headers });
      if (request.method === "GET") {
        const [bots, configs, groups, logs, verifications, members] = await Promise.all([
          db.query("SELECT rid,bot_username,bot_admin_username FROM t_telegram_bot ORDER BY rid"),
          db.query("SELECT bot_rid,support_enabled,support_captcha_enabled,support_verified_minutes,ad_score_threshold,ad_keywords FROM t_telegram_bot_moderation_config ORDER BY bot_rid"),
          db.query(`SELECT g.rid,g.bot_rid,g.tg_groupid::text AS tg_groupid,g.tg_groupusername,g.tg_groupnickname,b.bot_username,
    p.rid AS policy_rid,p.join_captcha_enabled,p.group_moderation_enabled,p.block_forwarded_messages,p.no_avatar_captcha_enabled,p.no_username_captcha_enabled,p.new_account_captcha_enabled,p.new_account_max_age_seconds,
    p.ad_keywords,p.ad_keywords_auto_upload,p.ad_keywords_auto_sync,p.ad_action,p.ad_restrict_duration_seconds,p.verification_timeout_seconds,p.ad_verification_timeout_seconds,p.rate_limit_count,p.rate_limit_window_seconds
    FROM t_telegram_bot_group g LEFT JOIN t_telegram_bot b ON b.rid=g.bot_rid LEFT JOIN t_telegram_bot_group_policy p ON p.bot_rid=g.bot_rid AND p.tg_groupid=g.tg_groupid WHERE g.status=1 ORDER BY g.rid DESC LIMIT 500`),
          db.query("SELECT l.rid,l.bot_rid,b.bot_username,l.chat_id::text AS chat_id,l.user_id::text AS user_id,l.message_id,l.event_type,l.action,l.score,l.reasons,l.content_preview,to_char(l.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time FROM t_telegram_moderation_log l LEFT JOIN t_telegram_bot b ON b.rid=l.bot_rid ORDER BY l.rid DESC LIMIT 500"),
          db.query("SELECT v.rid,v.bot_rid,b.bot_username,v.chat_id::text AS chat_id,v.user_id::text AS user_id,v.user_chat_id::text AS user_chat_id,v.verification_type,v.status,v.verification_message_id,v.mini_app_message_id,to_char(v.expires_at,'YYYY-MM-DD HH24:MI:SS') AS expires_at,to_char(v.verified_at,'YYYY-MM-DD HH24:MI:SS') AS verified_at,to_char(v.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time FROM t_telegram_verification v LEFT JOIN t_telegram_bot b ON b.rid=v.bot_rid ORDER BY v.rid DESC LIMIT 500"),
          db.query("SELECT m.rid,m.bot_rid,b.bot_username,m.chat_id::text AS chat_id,m.user_id::text AS user_id,m.action,to_char(m.restricted_until,'YYYY-MM-DD HH24:MI:SS') AS restricted_until,to_char(m.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time FROM t_telegram_moderated_member m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE m.status='active' AND (m.restricted_until IS NULL OR m.restricted_until>now()) ORDER BY m.update_time DESC LIMIT 500")
        ]);
        const configRows = configs.rows.map((row2) => ({ ...row2, ad_keywords: row2.ad_keywords || "" }));
        const configKeywords = new Map(configRows.map((row2) => [row2.bot_rid, row2.ad_keywords]));
        const groupRows = groups.rows.map((row2) => {
          const autoUpload = row2.ad_keywords_auto_upload ?? true, autoSync = row2.ad_keywords_auto_sync ?? true, words = customGroupAdKeywords(row2.ad_keywords || "", configKeywords.get(row2.bot_rid) || "");
          return { ...row2, join_captcha_enabled: row2.join_captcha_enabled ?? false, group_moderation_enabled: row2.group_moderation_enabled ?? false, block_forwarded_messages: row2.block_forwarded_messages ?? false, no_avatar_captcha_enabled: row2.no_avatar_captcha_enabled ?? false, no_username_captcha_enabled: row2.no_username_captcha_enabled ?? false, new_account_captcha_enabled: row2.new_account_captcha_enabled ?? false, new_account_max_age_seconds: row2.new_account_max_age_seconds ?? 86400, ad_keywords_auto_upload: autoUpload, ad_keywords_auto_sync: autoSync, ad_action: row2.ad_action || "verify", ad_restrict_duration_seconds: row2.ad_restrict_duration_seconds || 3600, verification_timeout_seconds: row2.verification_timeout_seconds || 180, ad_verification_timeout_seconds: row2.ad_verification_timeout_seconds || 1800, rate_limit_count: row2.rate_limit_count || 6, rate_limit_window_seconds: row2.rate_limit_window_seconds || 10, ad_keywords: words.join("\n") };
        });
        return Response.json({ bots: bots.rows, configs: configRows, groups: groupRows, logs: logs.rows.map((row2) => ({ ...row2, event_label: labels.event[row2.event_type] || row2.event_type, action_label: labels.action[row2.action] || row2.action })), verifications: verifications.rows.map((row2) => ({ ...row2, type_label: labels.verification[row2.verification_type] || row2.verification_type, status_label: labels.status[row2.status] || row2.status })), members: members.rows.map((row2) => ({ ...row2, action_label: labels.action[row2.action] || row2.action })), telegramEnabled: process.env.PLATFORM_TELEGRAM_ACTIONS === "true", permissions: { saveBot: await actionAllowed(user, "admin.groupuser.moderation.save_bot"), saveGroup: await actionAllowed(user, "admin.groupuser.moderation.save_group"), releaseMember: await actionAllowed(user, "admin.groupuser.moderation.release_member") } }, { headers });
      }
      if (request.method !== "POST") return Response.json({ message: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301" }, { status: 405, headers });
      if (!originAllowed(request)) return Response.json({ message: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548" }, { status: 403, headers });
      const raw = await request.text();
      if (raw.length > 2e4) return Response.json({ message: "\u8F93\u5165\u5185\u5BB9\u8FC7\u957F" }, { status: 413, headers });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ message: "\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9" }, { status: 400, headers });
      }
      const action = z.object({ action: z.enum(["save_bot", "save_group", "release_member"]) }).parse(body).action;
      const actionRoute = { save_bot: "admin.groupuser.moderation.save_bot", save_group: "admin.groupuser.moderation.save_group", release_member: "admin.groupuser.moderation.release_member" }[action];
      if (!await actionAllowed(user, actionRoute)) return Response.json({ message: "\u6CA1\u6709\u64CD\u4F5C\u6743\u9650" }, { status: 403, headers });
      if (action === "save_bot") {
        const d2 = z.object({ action: z.literal("save_bot"), bot_rid: z.coerce.number().int().positive(), support_enabled: bool, support_captcha_enabled: bool, support_verified_minutes: minutes.min(5).max(43200), ad_score_threshold: minutes.min(1).max(20), ad_keywords: z.string().max(5e3) }).strict().parse(body);
        const bot = await db.query("SELECT rid FROM t_telegram_bot WHERE rid=$1", [d2.bot_rid]);
        if (!bot.rowCount) return Response.json({ message: "\u673A\u5668\u4EBA\u4E0D\u5B58\u5728" }, { status: 404, headers });
        await db.query(`INSERT INTO t_telegram_bot_moderation_config(bot_rid,support_enabled,support_chat_id,support_captcha_enabled,support_verified_minutes,ad_score_threshold,ad_keywords,create_time,update_time)
   VALUES($1,$2,NULL,$3,$4,$5,$6,now(),now()) ON CONFLICT(bot_rid) DO UPDATE SET support_enabled=EXCLUDED.support_enabled,support_chat_id=NULL,support_captcha_enabled=EXCLUDED.support_captcha_enabled,support_verified_minutes=EXCLUDED.support_verified_minutes,ad_score_threshold=EXCLUDED.ad_score_threshold,ad_keywords=EXCLUDED.ad_keywords,update_time=now()`, [d2.bot_rid, d2.support_enabled, d2.support_captcha_enabled, d2.support_verified_minutes, d2.ad_score_threshold, d2.ad_keywords]);
        await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.moderation.save_bot", d2.bot_rid]);
        return Response.json({ ok: true, message: "\u673A\u5668\u4EBA\u5BA2\u670D\u4E0E\u8BC6\u522B\u914D\u7F6E\u5DF2\u4FDD\u5B58" }, { headers });
      }
      if (action === "save_group") {
        const d2 = z.object({ action: z.literal("save_group"), bot_rid: z.coerce.number().int().positive(), tg_groupid: z.string().regex(/^-?\d{1,20}$/), join_captcha_enabled: bool, group_moderation_enabled: bool, block_forwarded_messages: bool, no_avatar_captcha_enabled: bool, no_username_captcha_enabled: bool, new_account_captcha_enabled: bool, new_account_max_age_seconds: z.coerce.number().int().refine((v) => [3600, 86400, 2592e3, 15552e3, 31536e3].includes(v)), ad_keywords: z.string().max(5e3), ad_keywords_auto_upload: bool, ad_keywords_auto_sync: bool, ad_action: z.enum(["delete", "restrict", "restrict_forever", "verify", "ban"]), ad_restrict_duration_minutes: minutes.min(1).max(43200), verification_timeout_seconds: minutes.min(60).max(3600), ad_verification_timeout_minutes: minutes.min(5).max(1440), rate_limit_count: minutes.min(2).max(50), rate_limit_window_seconds: minutes.min(2).max(300) }).strict().parse(body);
        const match = await db.query("SELECT rid FROM t_telegram_bot_group WHERE bot_rid=$1 AND tg_groupid=$2 AND status=1", [d2.bot_rid, d2.tg_groupid]);
        if (!match.rowCount) return Response.json({ message: "\u7FA4\u7EC4\u4E0E\u673A\u5668\u4EBA\u4E0D\u5339\u914D\u6216\u7FA4\u7EC4\u5DF2\u505C\u7528" }, { status: 409, headers });
        const shared = await db.query("SELECT ad_keywords FROM t_telegram_bot_moderation_config WHERE bot_rid=$1", [d2.bot_rid]);
        const custom = customGroupAdKeywords(d2.ad_keywords, shared.rows[0]?.ad_keywords || "").join("\n");
        await db.query(`INSERT INTO t_telegram_bot_group_policy(bot_rid,tg_groupid,join_captcha_enabled,group_moderation_enabled,block_forwarded_messages,no_avatar_captcha_enabled,no_username_captcha_enabled,new_account_captcha_enabled,new_account_max_age_seconds,ad_keywords,ad_keywords_auto_upload,ad_keywords_auto_sync,ad_action,ad_restrict_duration_seconds,verification_timeout_seconds,ad_verification_timeout_seconds,rate_limit_count,rate_limit_window_seconds,create_time,update_time)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),now())
   ON CONFLICT(bot_rid,tg_groupid) DO UPDATE SET join_captcha_enabled=EXCLUDED.join_captcha_enabled,group_moderation_enabled=EXCLUDED.group_moderation_enabled,block_forwarded_messages=EXCLUDED.block_forwarded_messages,no_avatar_captcha_enabled=EXCLUDED.no_avatar_captcha_enabled,no_username_captcha_enabled=EXCLUDED.no_username_captcha_enabled,new_account_captcha_enabled=EXCLUDED.new_account_captcha_enabled,new_account_max_age_seconds=EXCLUDED.new_account_max_age_seconds,ad_keywords=EXCLUDED.ad_keywords,ad_keywords_auto_upload=EXCLUDED.ad_keywords_auto_upload,ad_keywords_auto_sync=EXCLUDED.ad_keywords_auto_sync,ad_action=EXCLUDED.ad_action,ad_restrict_duration_seconds=EXCLUDED.ad_restrict_duration_seconds,verification_timeout_seconds=EXCLUDED.verification_timeout_seconds,ad_verification_timeout_seconds=EXCLUDED.ad_verification_timeout_seconds,rate_limit_count=EXCLUDED.rate_limit_count,rate_limit_window_seconds=EXCLUDED.rate_limit_window_seconds,update_time=now()`, [d2.bot_rid, d2.tg_groupid, d2.join_captcha_enabled, d2.group_moderation_enabled, d2.block_forwarded_messages, d2.no_avatar_captcha_enabled, d2.no_username_captcha_enabled, d2.new_account_captcha_enabled, d2.new_account_max_age_seconds, custom, d2.ad_keywords_auto_upload, d2.ad_keywords_auto_sync, d2.ad_action, d2.ad_restrict_duration_minutes * 60, d2.verification_timeout_seconds, d2.ad_verification_timeout_minutes * 60, d2.rate_limit_count, d2.rate_limit_window_seconds]);
        await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.moderation.save_group", match.rows[0].rid]);
        const scan = await scanRecentGroupMessages({ botRid: d2.bot_rid, chatId: d2.tg_groupid });
        let message = "";
        if (scan.skipped) message = "\u7FA4\u7EC4\u7B56\u7565\u5DF2\u4FDD\u5B58\uFF1B\u5F00\u53D1\u73AF\u5883 Telegram \u64CD\u4F5C\u5DF2\u5173\u95ED\uFF0C\u672A\u6267\u884C\u5386\u53F2\u56DE\u626B";
        else {
          message = "\u7FA4\u7EC4\u7B56\u7565\u5DF2\u4FDD\u5B58\uFF0C\u6700\u8FD1 30 \u5206\u949F\u5DF2\u56DE\u626B\u5E76\u5904\u7406 " + scan.processed + " \u6761\u6D88\u606F";
          if (scan.failed) message += "\uFF0C" + scan.failed + " \u6761\u5904\u7406\u5931\u8D25";
          if (scan.challengeFallbacks) message += "\uFF1B" + scan.challengeFallbacks + " \u6761\u9A8C\u8BC1\u6311\u6218\u672A\u80FD\u542F\u52A8\uFF0C\u5DF2\u56DE\u9000\u4E3A\u5220\u9664\u6D88\u606F";
        }
        return Response.json({ ok: true, message, scan }, { headers });
      }
      if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return Response.json({ message: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528\u5916\u90E8\u673A\u5668\u4EBA\u64CD\u4F5C" }, { status: 409, headers });
      const d = z.object({ action: z.literal("release_member"), rid: z.coerce.number().int().positive() }).strict().parse(body);
      const member = await db.query("SELECT m.rid,m.bot_rid,m.chat_id::text AS chat_id,m.user_id::text AS user_id,m.action,b.bot_token FROM t_telegram_moderated_member m JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE m.rid=$1 AND m.status='active'", [d.rid]);
      if (!member.rowCount) return Response.json({ message: "\u8BE5\u6CBB\u7406\u8BB0\u5F55\u5DF2\u89E3\u9664\u6216\u5DF2\u5931\u6548" }, { status: 404, headers });
      const row = member.rows[0], result = row.action === "ban" ? await telegram(row.bot_token, "unbanChatMember", { chat_id: row.chat_id, user_id: row.user_id, only_if_banned: true }) : await telegram(row.bot_token, "restrictChatMember", { chat_id: row.chat_id, user_id: row.user_id, permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_react_to_messages: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true }, use_independent_chat_permissions: true });
      if (!result.ok) return Response.json({ message: `\u89E3\u9664\u5931\u8D25\uFF1A${result.description || "Telegram \u8BF7\u6C42\u5931\u8D25"}` }, { status: 502, headers });
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE t_telegram_moderated_member SET status='released',update_time=now() WHERE rid=$1 AND status='active'", [d.rid]);
        await client.query("INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,'manual_governance_release','release',0,'\u540E\u53F0\u7BA1\u7406\u5458\u624B\u52A8\u89E3\u9664',$4,now())", [row.bot_rid, row.chat_id, row.user_id, `\u6CBB\u7406\u8BB0\u5F55 #${d.rid}`]);
        await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)", [user.id, "groupuser.moderation.release_member", d.rid]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return Response.json({ ok: true, message: "\u5DF2\u89E3\u9664\u8BE5\u7528\u6237\u7684\u6CBB\u7406\u9650\u5236" }, { headers });
    });
  }
  return moderationApi;
}
export {
  createModerationApi
};
