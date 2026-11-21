function createVerificationApi(host) {
  const { db, cookie, cookies, digest, equalTokens, isToken, sendVerifiedJoinNotification } = host;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  const cookieName = "tg_telegram_verification";
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function result(message, status = 200) {
    return Response.json({ message }, { status, headers });
  }
  function tokenFrom(request) {
    const token = new URL(request.url).searchParams.get("verify");
    return isToken(token) ? token : null;
  }
  function tokenPage(status, type, completeUrl) {
    const ready = status === "pending";
    const content = ready ? `<div id="playcaptcha-root" data-complete-url="${escapeHtml(completeUrl)}" data-asset-base="/captcha/toys/"></div><div id="verification-feedback" role="status" aria-live="polite"></div>` : status === "verified" ? '<section class="verification-state"><h1>\u9A8C\u8BC1\u5DF2\u5B8C\u6210</h1><p>\u53EF\u4EE5\u5173\u95ED\u6B64\u9875\u9762\u5E76\u8FD4\u56DE Telegram\u3002</p></section>' : `<section class="verification-state"><h1>\u9A8C\u8BC1\u94FE\u63A5\u5DF2\u5931\u6548</h1><p>${type === "ad_challenge" ? "\u8FDD\u89C4\u9A8C\u8BC1\u5DF2\u8D85\u65F6\uFF0C\u7CFB\u7EDF\u5C06\u6309\u7167\u7FA4\u7EC4\u7B56\u7565\u6267\u884C\u6C38\u4E45\u5C01\u7981\u5E76\u79FB\u51FA\u7FA4\u7EC4\u3002" : "\u8BF7\u8FD4\u56DE Telegram \u91CD\u65B0\u53D1\u8D77\u9A8C\u8BC1\u3002"}</p></section>`;
    const appScript = `<script>(()=>{const app=window.Telegram&&window.Telegram.WebApp;if(!app)return;app.ready();app.expand();app.setHeaderColor('#edf1f3');app.setBackgroundColor('#edf1f3');const feedback=document.getElementById('verification-feedback');if(feedback)new MutationObserver(()=>{if(feedback.textContent.includes('\u9A8C\u8BC1\u901A\u8FC7'))setTimeout(()=>app.close(),650)}).observe(feedback,{childList:true,characterData:true,subtree:true})})()</script>`;
    const captchaScript = ready ? '<script src="/captcha/playcaptcha.js" defer></script>' : "";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="csrf-token" content="native-verification"><title>Telegram \u4EBA\u673A\u9A8C\u8BC1</title><link rel="stylesheet" href="/captcha/playcaptcha.css"><script src="https://telegram.org/js/telegram-web-app.js"></script><style>:root{color-scheme:light;--clawcap-bg:#fff;--clawcap-ink:#17191c;--clawcap-muted:#69707a;--clawcap-accent:#176b87;--clawcap-action:#e34b55}*{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#edf1f3;color:#17191c;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;min-height:var(--tg-viewport-stable-height,100svh);display:flex;align-items:flex-start;justify-content:center;padding:max(12px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));overflow-x:hidden}.verification-shell{display:flex;width:min(100%,430px);margin:auto;flex-direction:column;align-items:center}.verification-brand{width:100%;margin:0 0 12px;color:#4d5963;font-size:13px;text-align:center}#playcaptcha-root{display:flex;width:100%;align-items:flex-start;justify-content:center}.verification-state{padding:28px 24px;border:1px solid #d8dee2;border-radius:12px;background:#fff;text-align:center;box-shadow:0 12px 35px #18242d14}.verification-state h1{margin:0 0 8px;font-size:20px}.verification-state p{margin:0;color:#69707a;font-size:14px;line-height:1.6}#verification-feedback{width:100%;min-height:24px;margin-top:10px;color:#176b87;font-size:13px;text-align:center}@media(max-height:760px){:root{--captcha-mini-scale:.88}.verification-brand{margin-bottom:8px}}@media(max-width:380px){:root{--captcha-mini-scale:.82}}@media(max-height:660px){:root{--captcha-mini-scale:.78}.verification-brand{font-size:12px}}</style>${captchaScript}</head><body><main class="verification-shell"><p class="verification-brand">Telegram \u5B89\u5168\u9A8C\u8BC1</p>${content}</main>${appScript}</body></html>`;
  }
  async function telegram(botToken, method, payload) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true") return { ok: false, description: "\u5F53\u524D\u5F00\u53D1\u73AF\u5883 Telegram \u64CD\u4F5C\u5DF2\u5173\u95ED" };
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(12e3) });
      return await response.json();
    } catch {
      return { ok: false, description: "Telegram \u63A5\u53E3\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5" };
    }
  }
  async function audit(row, status, promptMessageId) {
    const prefix = row.verification_type === "ad_challenge" ? "ad" : row.verification_type;
    await db.query(`INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,now())`, [row.bot_rid, row.chat_id, row.user_id, promptMessageId, `${prefix}_verification_${status}`.slice(0, 40), status, status === "passed" ? "\u7528\u6237\u5DF2\u5B8C\u6210\u4EBA\u673A\u9A8C\u8BC1" : "Telegram \u653E\u884C\u5931\u8D25", `\u9A8C\u8BC1\u8BB0\u5F55 #${row.rid}`]);
  }
  async function telegramVerificationApi(request) {
    const token = tokenFrom(request);
    if (!token) return result("\u9A8C\u8BC1\u94FE\u63A5\u4E0D\u5B58\u5728\u3002", 404);
    const tokenHash = digest(token);
    if (request.method === "GET") {
      const found = await db.query("SELECT rid,bot_rid,chat_id::text,user_id::text,verification_type,status,expires_at,verification_message_id,mini_app_message_id,user_chat_id::text FROM t_telegram_verification WHERE token_hash=$1 LIMIT 1", [tokenHash]);
      const row = found.rows[0];
      if (!row) return result("\u9A8C\u8BC1\u94FE\u63A5\u4E0D\u5B58\u5728\u3002", 404);
      const expired = row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now();
      const displayStatus = expired ? "expired" : row.status;
      const origin2 = process.env.PLATFORM_ORIGIN;
      if (!origin2) return result("\u9A8C\u8BC1\u670D\u52A1\u5730\u5740\u5C1A\u672A\u914D\u7F6E\u3002", 503);
      const completeUrl = new URL("/api/moderation?verify=" + encodeURIComponent(token), new URL(origin2).origin).toString();
      const response2 = new Response(tokenPage(displayStatus, row.verification_type, completeUrl), { status: ["expired", "expiring"].includes(displayStatus) ? 410 : 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
      if (displayStatus === "pending") {
        const remaining = Math.max(1, Math.min(86400, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1e3)));
        response2.headers.append("Set-Cookie", cookie(cookieName, tokenHash, remaining));
      }
      return response2;
    }
    if (request.method !== "POST") return result("\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301\u3002", 405);
    const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : "";
    if (!origin || request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return result("\u8BF7\u6C42\u6765\u6E90\u65E0\u6548\u3002", 403);
    const gate = cookies(request)[cookieName];
    if (!gate || !equalTokens(gate, tokenHash) || request.headers.get("x-csrf-token") !== "native-verification") return result("\u9A8C\u8BC1\u4F1A\u8BDD\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9A8C\u8BC1\u94FE\u63A5\u3002", 419);
    const client = await db.connect();
    let verification;
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT rid,bot_rid,chat_id::text,user_id::text,verification_type,status,expires_at,verification_message_id,mini_app_message_id,user_chat_id::text FROM t_telegram_verification WHERE token_hash=$1 FOR UPDATE", [tokenHash]);
      verification = found.rows[0];
      if (!verification) {
        await client.query("ROLLBACK");
        return result("\u9A8C\u8BC1\u94FE\u63A5\u4E0D\u5B58\u5728\u3002", 404);
      }
      if (verification.status === "verified") {
        await client.query("COMMIT");
        return result("\u9A8C\u8BC1\u5DF2\u7ECF\u5B8C\u6210\u3002");
      }
      if (verification.status !== "pending" || new Date(verification.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return result("\u9A8C\u8BC1\u94FE\u63A5\u5DF2\u5931\u6548\u3002", 410);
      }
      if (!["join_request", "join_member", "ad_challenge", "support"].includes(verification.verification_type)) {
        await client.query("ROLLBACK");
        return result("\u6B64\u9A8C\u8BC1\u7C7B\u578B\u5C1A\u672A\u8FC1\u79FB\u3002", 409);
      }
      await client.query("UPDATE t_telegram_verification SET status='processing',update_time=now() WHERE rid=$1", [verification.rid]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!verification) return result("\u9A8C\u8BC1\u94FE\u63A5\u4E0D\u5B58\u5728\u3002", 404);
    const bot = await db.query("SELECT bot_token,bot_username,bot_admin_username FROM t_telegram_bot WHERE rid=$1", [verification.bot_rid]);
    const botToken = bot.rows[0]?.bot_token;
    if (!botToken) {
      await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid]);
      return result("\u673A\u5668\u4EBA\u914D\u7F6E\u4E0D\u5B58\u5728\u3002", 404);
    }
    if (verification.verification_type === "support") {
      const settings = await db.query("SELECT support_verified_minutes FROM t_telegram_bot_moderation_config WHERE bot_rid=$1 AND support_enabled=true", [verification.bot_rid]);
      if (!verification.user_chat_id || !settings.rows[0]) {
        await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid]);
        return result("\u5BA2\u670D\u4F1A\u8BDD\u5DF2\u5173\u95ED\u6216\u673A\u5668\u4EBA\u914D\u7F6E\u5DF2\u505C\u7528\u3002", 409);
      }
      await db.query("UPDATE t_telegram_verification SET status='verified',verified_at=now(),expires_at=now()+($2::text||' minutes')::interval,update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid, Math.max(5, Number(settings.rows[0].support_verified_minutes) || 1440)]);
      await audit(verification, "passed", verification.verification_message_id);
      if (verification.verification_message_id) void telegram(botToken, "deleteMessage", { chat_id: verification.user_chat_id, message_id: verification.verification_message_id });
      void telegram(botToken, "sendMessage", { chat_id: verification.user_chat_id, text: "\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u5BA2\u670D\u4F1A\u8BDD\u5DF2\u5F00\u542F\u3002\u8BF7\u76F4\u63A5\u53D1\u9001\u6587\u5B57\u3001\u56FE\u7247\u6216\u6587\u4EF6\uFF1B\u53D1\u9001 /endsupport \u53EF\u7ED3\u675F\u4F1A\u8BDD\u3002" });
      const response2 = result("\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u5BA2\u670D\u4F1A\u8BDD\u5DF2\u5F00\u542F\u3002");
      response2.headers.append("Set-Cookie", cookie(cookieName, "", 0));
      return response2;
    }
    const payload = { chat_id: verification.chat_id, user_id: verification.user_id };
    const telegramResult = verification.verification_type === "join_request" ? await telegram(botToken, "approveChatJoinRequest", payload) : await telegram(botToken, "restrictChatMember", { ...payload, permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_react_to_messages: true, can_edit_tag: true, can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true }, use_independent_chat_permissions: true });
    if (!telegramResult.ok) {
      await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid]);
      await audit(verification, "failed", verification.verification_message_id);
      return result(`Telegram \u653E\u884C\u5931\u8D25\uFF1A${telegramResult.description || "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"}`, 502);
    }
    await db.query("UPDATE t_telegram_verification SET status='verified',verified_at=now(),update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid]);
    if (verification.verification_type === "ad_challenge") await db.query("UPDATE t_telegram_moderated_member SET status='released',update_time=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND status='active'", [verification.bot_rid, verification.chat_id, verification.user_id]);
    await audit(verification, "passed", verification.verification_message_id);
    const promptChatId = ["join_request", "support"].includes(verification.verification_type) ? verification.user_chat_id : verification.chat_id;
    if (verification.verification_message_id && promptChatId) void telegram(botToken, "deleteMessage", { chat_id: promptChatId, message_id: verification.verification_message_id });
    if (verification.mini_app_message_id && verification.user_chat_id) void telegram(botToken, "deleteMessage", { chat_id: verification.user_chat_id, message_id: verification.mini_app_message_id });
    if (["join_member", "join_request"].includes(verification.verification_type) && verification.chat_id) {
      try {
        const notified = await sendVerifiedJoinNotification({ pool: db, fetcher: fetch, botRid: verification.bot_rid, token: botToken, bot: bot.rows[0], chatId: verification.chat_id, userId: verification.user_id });
        if (!notified) await telegram(botToken, "sendMessage", { chat_id: verification.chat_id, text: "\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u6B22\u8FCE\u52A0\u5165\u3002", allow_sending_without_reply: true });
      } catch {
      }
    }
    const response = result("\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u53EF\u4EE5\u8FD4\u56DE Telegram\u3002");
    response.headers.append("Set-Cookie", cookie(cookieName, "", 0));
    return response;
  }
  return telegramVerificationApi;
}
export {
  createVerificationApi
};
