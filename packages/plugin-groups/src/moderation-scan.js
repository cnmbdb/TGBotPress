function createModerationScan(host) {
  const { db, startAdVerificationChallenge, effectiveGroupAdKeywords } = host;
  const strong = ["\u535A\u5F69", "\u8D4C\u573A", "\u4E0B\u6CE8", "\u5305\u8D62", "\u5237\u5355", "\u8DD1\u5206", "\u6D17\u94B1", "\u7A7A\u6295\u7FA4", "\u8D44\u91D1\u76D8", "\u9AD8\u85AA\u517C\u804C", "\u65E5\u8D5A", "\u7A33\u8D5A", "\u4FDD\u672C\u6536\u76CA", "\u4EE3\u5F00\u53D1\u7968", "\u51FA\u552E\u8D26\u53F7", "\u6536\u8D2D\u8D26\u53F7", "\u514D\u8D39\u7A7A\u6295", "\u62C5\u4FDD\u4EA4\u6613", "\u65E0\u62BC\u8D37\u6B3E", "\u88F8\u804A", "\u8272\u7C89", "\u76D8\u53E3", "\u5A31\u4E50\u57CE"];
  const marketing = ["\u4EE3\u7406\u62DB\u5546", "\u6E20\u9053\u5408\u4F5C", "\u4F4E\u4EF7\u51FA\u552E", "\u9650\u65F6\u4F18\u60E0", "\u514D\u8D39\u9886\u53D6", "\u52A0\u6211\u54A8\u8BE2", "\u79C1\u804A\u54A8\u8BE2", "\u8054\u7CFB\u6211", "\u627F\u5151", "\u4EE3\u4ED8", "\u6362\u6C47", "\u5F15\u6D41", "\u63A8\u5E7F", "\u62DB\u8058", "\u5E7F\u544A\u5408\u4F5C", "\u5E7F\u544A\u4F4D", "\u5546\u52A1\u5408\u4F5C", "\u9879\u76EE\u63A8\u5E7F", "\u8D44\u6E90\u5BF9\u63A5", "\u62DB\u4EE3\u7406", "\u52A0\u7FA4", "\u8FDB\u7FA4", "\u7FA4\u53D1", "\u62C9\u4EBA", "\u4EE3\u6536", "\u4EE3\u5145", "\u6536u", "\u51FAu", "\u5E01\u5546"];
  const serviceKeys = ["new_chat_members", "new_chat_member", "left_chat_member", "new_chat_title", "new_chat_photo", "delete_chat_photo", "group_chat_created", "supergroup_chat_created", "pinned_message"];
  const textPart = (v) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  const messageText = (m) => ["text", "caption"].map((k) => textPart(m[k])).filter(Boolean).join("\n");
  const collectText = (m) => [
    m.text,
    m.caption,
    m.from?.first_name,
    m.from?.last_name,
    m.from?.username,
    m.sender_chat?.title,
    m.forward_from_chat?.title,
    m.forward_sender_name,
    m.forward_origin?.chat?.title,
    m.forward_origin?.sender_user?.username,
    m.bio
  ].map(textPart).filter(Boolean).join(" ").trim();
  function analyzeMessage(m, keywords, blockForwarded, threshold) {
    const text = collectText(m), normalized = text.toLocaleLowerCase("und"), reasons = [];
    const forwarded = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date || m.is_automatic_forward);
    let score = 0, highConfidence = false;
    if (forwarded && blockForwarded) return { isAd: true, score: Math.max(threshold, 5), reasons: ["\u7981\u6B62\u8F6C\u53D1\u6D88\u606F"], preview: Array.from(text).slice(0, 500).join(""), highConfidence: false };
    if (forwarded) {
      score++;
      reasons.push("\u8F6C\u53D1\u6765\u6E90");
    }
    const textUrls = (normalized.match(/(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)[^\s<]+/giu) || []).length;
    const entityUrls = [...m.entities || [], ...m.caption_entities || []].filter((e) => e?.type === "url" || e?.type === "text_link").length;
    const urlCount = Math.max(textUrls, entityUrls);
    if (urlCount) {
      score += Math.min(4, urlCount * 2);
      reasons.push("\u5305\u542B\u5916\u90E8\u94FE\u63A5");
    }
    const mention = (normalized.match(/(?:^|[\s，,：:；;])@[a-z0-9_]{5,}/giu) || []).length;
    if (mention) {
      score += 2;
      reasons.push(mention >= 2 ? "\u591A\u4E2A\u8054\u7CFB\u8D26\u53F7" : "\u5305\u542B\u8054\u7CFB\u8D26\u53F7");
    }
    if (/(?:微信|vx|v信|qq|telegram|飞机)\s*[:：]?\s*[a-z0-9_-]{5,}/iu.test(normalized)) {
      score += 2;
      reasons.push("\u5305\u542B\u7AD9\u5916\u8054\u7CFB\u65B9\u5F0F");
    }
    if (/(?:加|联系|咨询|私聊|找|客服)\s*(?:我|本人|商家|代理)?\s*[:：]?\s*@[a-z0-9_]{5,}/iu.test(normalized)) {
      score += 2;
      reasons.push("\u5F15\u5BFC\u79C1\u804A\u8054\u7CFB");
    }
    const moneyBait = /(?:兜|口袋|钱包).{0,6}(?:比脸.{0,3})?(?:干净|空)|(?:没钱|缺钱|想赚钱|手头紧)/u.test(normalized);
    const direct = /(?:^|[^a-z0-9])(?:m|密|私|滴|找|联系|加)\s*我(?:$|[^a-z0-9])/iu.test(normalized);
    if (moneyBait && direct) {
      score += 6;
      reasons.push("\u9AD8\u7F6E\u4FE1\u89C4\u907F\u5E7F\u544A");
      highConfidence = true;
    }
    if (/(?:诚\s*[招召聘]|招\s*[聘募]|群\s*演|兼\s*职|日\s*结|周\s*结|月\s*结|薪\s*资|工\s*资)/u.test(normalized)) {
      score += 2;
      reasons.push("\u62DB\u52DF\u517C\u804C\u63A8\u5E7F");
    }
    if (/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)[^\s<]+/iu.test(normalized)) {
      score += 2;
      reasons.push("\u7FA4\u7EC4\u9080\u8BF7\u94FE\u63A5");
    }
    if (/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u.test(normalized)) {
      score += 2;
      reasons.push("\u5305\u542B\u624B\u673A\u53F7");
    }
    if (strong.some((k) => normalized.includes(k.toLocaleLowerCase("und")))) {
      score += 4;
      reasons.push("\u9AD8\u98CE\u9669\u5E7F\u544A\u8BCD");
    }
    if (marketing.some((k) => normalized.includes(k.toLocaleLowerCase("und")))) {
      score += 2;
      reasons.push("\u8425\u9500\u63A8\u5E7F\u8BCD");
    }
    if (keywords.some((k) => normalized.includes(k.toLocaleLowerCase("und")))) {
      score += 4;
      reasons.push("\u547D\u4E2D\u81EA\u5B9A\u4E49\u5E7F\u544A\u8BCD");
    }
    if (/(.)\1{7,}/u.test(normalized)) {
      score++;
      reasons.push("\u91CD\u590D\u5B57\u7B26\u5237\u5C4F");
    }
    if (Array.from(normalized).length > 180 && urlCount) {
      score++;
      reasons.push("\u957F\u8425\u9500\u6587\u6848");
    }
    return { isAd: score >= Math.max(1, threshold), score, reasons: [...new Set(reasons)], preview: Array.from(text).slice(0, 500).join(""), highConfidence };
  }
  function isServiceMessage(m) {
    return serviceKeys.some((k) => Object.prototype.hasOwnProperty.call(m, k));
  }
  function isKeywordCommand(m, username) {
    const match = String(m.text ?? "").trim().match(/^\/jgjc(?:@([a-z0-9_]+))?\s*$/iu);
    if (!match) return false;
    const mentioned = String(match[1] ?? "");
    const bot = String(username ?? "").replace(/^@/, "");
    return !mentioned || !!bot && mentioned.toLowerCase() === bot.toLowerCase();
  }
  async function telegram(fetcher, token, method, payload) {
    try {
      const r = await fetcher("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(12e3) });
      return await r.json();
    } catch {
      return { ok: false, description: "Telegram \u63A5\u53E3\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5" };
    }
  }
  const restricted = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_react_to_messages: false };
  async function locked(pool, parameters, sql, handle) {
    const c = await pool.connect();
    let active = false;
    try {
      await c.query("BEGIN");
      active = true;
      const r = await c.query(sql, parameters);
      const row = r.rows[0];
      if (!row) {
        await c.query("ROLLBACK");
        active = false;
        return false;
      }
      await handle(row, c);
      await c.query("COMMIT");
      active = false;
      return true;
    } catch (e) {
      if (active) try {
        await c.query("ROLLBACK");
      } catch {
      }
      throw e;
    } finally {
      c.release();
    }
  }
  async function scanRecentGroupMessages(options) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return { skipped: true, scanned: 0, processed: 0, failed: 0, challengeFallbacks: 0 };
    const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console, minutes = Math.max(1, Math.min(30, options.minutes ?? 30));
    const configResult = await pool.query(
      "SELECT b.bot_token,b.bot_username,c.ad_score_threshold,c.ad_keywords FROM t_telegram_bot b LEFT JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid WHERE b.rid=$1",
      [options.botRid]
    );
    const bot = configResult.rows[0];
    if (!bot?.bot_token) return { skipped: false, scanned: 0, processed: 0, failed: 0, challengeFallbacks: 0 };
    const policyResult = await pool.query(
      "SELECT bot_rid,tg_groupid::text AS tg_groupid,group_moderation_enabled,block_forwarded_messages,ad_keywords,ad_keywords_auto_upload,ad_keywords_auto_sync,ad_action,ad_restrict_duration_seconds,ad_verification_timeout_seconds FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2",
      [options.botRid, options.chatId]
    );
    const policy = policyResult.rows[0];
    if (!policy?.group_moderation_enabled) return { skipped: false, scanned: 0, processed: 0, failed: 0, challengeFallbacks: 0 };
    const recent = await pool.query(
      "SELECT rid,message_id::text AS message_id,message_json FROM t_telegram_group_message_history WHERE bot_rid=$1 AND chat_id=$2 AND message_date>=now()-($3::text||' minutes')::interval AND ($4::bigint IS NULL OR message_id=$4::bigint) ORDER BY message_date LIMIT 500",
      [options.botRid, options.chatId, minutes, options.messageId ?? null]
    );
    const userCache = /* @__PURE__ */ new Map();
    let scanned = 0, processed = 0, failed = 0, challengeFallbacks = 0;
    const lockSql = "SELECT rid,message_id::text AS message_id,message_json FROM t_telegram_group_message_history WHERE rid=$1 AND bot_rid=$2 AND chat_id=$3 FOR UPDATE SKIP LOCKED";
    for (const candidate of recent.rows) {
      scanned++;
      try {
        const result = await locked(pool, [candidate.rid, options.botRid, options.chatId], lockSql, async (row, client) => {
          const message = typeof row.message_json === "string" ? JSON.parse(row.message_json) : row.message_json;
          if (!message || typeof message !== "object" || Array.isArray(message) || isServiceMessage(message) || isKeywordCommand(message, bot.bot_username)) return;
          const user = message.from;
          if (!user?.id || user.is_bot) return;
          const logged = await client.query("SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$3 AND event_type IN ('group_ad','flood') LIMIT 1", [options.botRid, options.chatId, row.message_id]);
          if (logged.rowCount) return;
          const userId = String(user.id);
          let isAdmin = userCache.get(userId);
          if (isAdmin === void 0) {
            const response = await telegram(fetcher, bot.bot_token, "getChatMember", { chat_id: options.chatId, user_id: userId });
            isAdmin = ["creator", "administrator"].includes(String(response.result?.status || ""));
            userCache.set(userId, isAdmin);
          }
          if (isAdmin) return;
          const custom = effectiveGroupAdKeywords(policy.ad_keywords, bot.ad_keywords, policy.ad_keywords_auto_upload, policy.ad_keywords_auto_sync);
          const analysis = analyzeMessage(message, custom, policy.block_forwarded_messages, Number(bot.ad_score_threshold) || 4);
          if (!analysis.isAd) return;
          processed++;
          await telegram(fetcher, bot.bot_token, "deleteMessage", { chat_id: options.chatId, message_id: row.message_id });
          let action = analysis.highConfidence ? "ban" : policy.ad_action;
          if (action === "verify") {
            const started = await startAdVerificationChallenge({ client, fetcher, botRid: options.botRid, botToken: bot.bot_token, chatId: options.chatId, userId, message, policy: { ad_verification_timeout_seconds: Number(policy.ad_verification_timeout_seconds) || 1800 } });
            if (!started) {
              action = "delete";
              challengeFallbacks++;
            }
          }
          let restrictedUntil = null, ok = true;
          if (action === "ban") {
            const r = await telegram(fetcher, bot.bot_token, "banChatMember", { chat_id: options.chatId, user_id: userId });
            ok = r.ok;
          } else if (action === "restrict" || action === "restrict_forever") {
            const payload = { chat_id: options.chatId, user_id: userId, permissions: restricted, use_independent_chat_permissions: true };
            if (action === "restrict") {
              const seconds = Math.max(60, Number(policy.ad_restrict_duration_seconds) || 3600);
              const at = new Date(Date.now() + seconds * 1e3);
              payload.until_date = Math.floor(at.getTime() / 1e3);
              restrictedUntil = at.toISOString();
            }
            const r = await telegram(fetcher, bot.bot_token, "restrictChatMember", payload);
            ok = r.ok;
          } else if (action !== "verify") action = "delete";
          if (ok && (action === "ban" || action === "restrict" || action === "restrict_forever")) {
            await client.query(
              "INSERT INTO t_telegram_moderated_member(bot_rid,chat_id,user_id,action,restricted_until,status,create_time,update_time) VALUES($1,$2,$3,$4,$5,'active',now(),now()) ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET action=EXCLUDED.action,restricted_until=EXCLUDED.restricted_until,status='active',update_time=now()",
              [options.botRid, options.chatId, userId, action, restrictedUntil]
            );
          }
          await client.query(
            "INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())",
            [options.botRid, options.chatId, userId, row.message_id, analysis.reasons.includes("\u77ED\u65F6\u95F4\u9AD8\u9891\u53D1\u8A00") ? "flood" : "group_ad", ok ? action : "failed", analysis.score, analysis.reasons.join("\u3001"), analysis.preview]
          );
        });
        if (!result) continue;
      } catch (error) {
        failed++;
        logger.error("moderation recent scan failed for group " + options.chatId);
      }
    }
    return { skipped: false, scanned, processed, failed, challengeFallbacks };
  }
  return { analyzeMessage, scanRecentGroupMessages };
}
export {
  createModerationScan
};
