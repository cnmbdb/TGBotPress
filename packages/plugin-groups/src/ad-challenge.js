import { createHash, randomBytes } from "node:crypto";
const blockedPermissions = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_react_to_messages: false, can_edit_tag: false, can_change_info: false, can_invite_users: false, can_pin_messages: false, can_manage_topics: false };
async function telegram(fetcher, token, method, payload) {
  try {
    const response = await fetcher("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(12e3) });
    return await response.json();
  } catch {
    return { ok: false, description: "Telegram API request failed" };
  }
}
function challengeUrl() {
  const raw = process.env.PLATFORM_ORIGIN?.trim();
  if (!raw) return void 0;
  try {
    const url = new URL("/api/moderation", raw), env = (process.env.APP_ENV || "production").toLowerCase();
    if (url.protocol !== "https:" && !["local", "dev", "development"].includes(env)) return void 0;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return void 0;
  }
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
async function startAdVerificationChallenge(options) {
  const fetcher = options.fetcher ?? fetch, origin = challengeUrl();
  if (!origin) return false;
  const restricted = await telegram(fetcher, options.botToken, "restrictChatMember", { chat_id: options.chatId, user_id: options.userId, permissions: blockedPermissions, use_independent_chat_permissions: true });
  if (!restricted.ok) return false;
  await options.client.query("SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))", [`${options.botRid}:${options.chatId}`, options.userId]);
  const pending = await options.client.query(`SELECT rid,expires_at,verification_message_id,mini_app_message_id,user_chat_id FROM t_telegram_verification
    WHERE bot_rid=$1 AND verification_type='ad_challenge' AND chat_id=$2 AND user_id=$3 AND status='pending' ORDER BY rid DESC LIMIT 1 FOR UPDATE`, [options.botRid, options.chatId, options.userId]);
  const previous = pending.rows[0];
  if (previous && new Date(previous.expires_at).getTime() > Date.now()) return true;
  if (previous) {
    if (previous.verification_message_id) await telegram(fetcher, options.botToken, "deleteMessage", { chat_id: options.chatId, message_id: previous.verification_message_id });
    if (previous.mini_app_message_id && previous.user_chat_id) await telegram(fetcher, options.botToken, "deleteMessage", { chat_id: previous.user_chat_id, message_id: previous.mini_app_message_id });
    await options.client.query("UPDATE t_telegram_verification SET status='expired',verification_message_id=NULL,mini_app_message_id=NULL,update_time=now() WHERE rid=$1", [previous.rid]);
  }
  const token = randomBytes(32).toString("hex"), timeout = Math.max(300, Number(options.policy.ad_verification_timeout_seconds) || 1800), tokenHash = createHash("sha256").update(token).digest("hex");
  const inserted = await options.client.query(`INSERT INTO t_telegram_verification(token_hash,verification_type,bot_rid,chat_id,user_id,user_chat_id,status,expires_at,create_time,update_time)
    VALUES($1,'ad_challenge',$2,$3,$4,$4,'pending',now()+($5::text||' seconds')::interval,now(),now()) RETURNING rid`, [tokenHash, options.botRid, options.chatId, options.userId, timeout]);
  const id = inserted.rows[0]?.rid;
  if (!id) return false;
  const user = options.message.from ?? {}, username = String(user.username ?? "").replace(/[^a-z0-9_]/gi, "");
  const rawName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim(), name = escapeHtml(rawName || "\u7528\u6237" + options.userId);
  const mention = username ? "@" + username : `<a href="tg://user?id=${encodeURIComponent(options.userId)}">${name}</a>`;
  const expires = Math.max(1, Math.ceil(timeout / 60)), challenge = new URL(origin);
  challenge.searchParams.set("verify", token);
  const url = challenge.toString();
  const sent = await telegram(fetcher, options.botToken, "sendMessage", { chat_id: options.chatId, text: `\u26A0\uFE0F ${mention} \u7684\u6D88\u606F\u7591\u4F3C\u5E7F\u544A\uFF0C\u5DF2\u6682\u65F6\u7981\u8A00\u3002

\u8BF7\u5728 <b>${expires} \u5206\u949F</b>\u5185\u5B8C\u6210\u9A8C\u8BC1\u89E3\u9664\u9650\u5236\uFF1B\u8D85\u65F6\u672A\u901A\u8FC7\u5C06\u88AB\u6C38\u4E45\u5C01\u7981\u5E76\u79FB\u51FA\u672C\u7FA4\u3002`, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "\u524D\u5F80 Mini App \u9A8C\u8BC1\u5E76\u89E3\u9664\u7981\u8A00", web_app: { url } }]] } });
  if (!sent.ok) {
    await options.client.query("UPDATE t_telegram_verification SET status='failed',update_time=now() WHERE rid=$1", [id]);
    await telegram(fetcher, options.botToken, "restrictChatMember", { chat_id: options.chatId, user_id: options.userId, permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_react_to_messages: true, can_edit_tag: true, can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true }, use_independent_chat_permissions: true });
    return false;
  }
  if (sent.result?.message_id) await options.client.query("UPDATE t_telegram_verification SET verification_message_id=$2,update_time=now() WHERE rid=$1", [id, sent.result.message_id]);
  await options.client.query(`INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,event_type,action,score,reasons,content_preview,create_time)
    VALUES($1,$2,$3,'ad_verification_started','pending',0,'\u8FDD\u89C4\u6D88\u606F\u9A8C\u8BC1',$4,now())`, [options.botRid, options.chatId, options.userId, "\u9A8C\u8BC1\u8BB0\u5F55 #" + id]);
  return true;
}
export {
  startAdVerificationChallenge
};
