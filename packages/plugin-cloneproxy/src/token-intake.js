import { createHash } from "node:crypto";
const tokenPattern = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;
const html = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const privateId = (value) => /^-?\d{1,20}$/.test(String(value ?? "")) ? String(value) : "";
async function notify(client, masterBotRid, updateId, chatId, text, suffix = "reply") {
  await client.query(
    "INSERT INTO t_platform_job_outbox(task_name,idempotency_key,entity_type,entity_id,bot_rid,chat_id,message_text) VALUES('handlerechargeorder',$1,'cloneproxy_token',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING",
    [`cloneproxy-token:${masterBotRid}:${updateId}:${suffix}`, String(updateId), masterBotRid, chatId, text]
  );
}
async function begin(client) {
  await client.query("BEGIN");
}
async function rollback(client) {
  await client.query("ROLLBACK").catch(() => void 0);
}
async function claimUpdate(client, masterBotRid, updateId) {
  const current = await client.query("SELECT last_update_id FROM t_telegram_bot WHERE rid=$1 FOR UPDATE", [masterBotRid]);
  if (!current.rowCount) return false;
  if (Number(current.rows[0].last_update_id ?? -1) >= updateId) return false;
  return true;
}
async function markUpdate(client, masterBotRid, updateId) {
  await client.query("UPDATE t_telegram_bot SET last_update_id=$2 WHERE rid=$1 AND (last_update_id IS NULL OR last_update_id<$2)", [masterBotRid, updateId]);
}
async function completeUpdate(client, masterBotRid, updateId, inboxClaim) {
  if (!inboxClaim) {
    await markUpdate(client, masterBotRid, updateId);
    return;
  }
  const result = await client.query(
    "UPDATE t_platform_telegram_update SET status='processed',processed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2 RETURNING rid",
    [inboxClaim.rid, inboxClaim.owner]
  );
  if (result.rowCount !== 1) throw new Error("cloneproxy_inbox_lease_lost");
}
async function replyAndClaim(pool, masterBotRid, updateId, chatId, text, inboxClaim) {
  const client = await pool.connect();
  try {
    await begin(client);
    const claim = inboxClaim ? true : await claimUpdate(client, masterBotRid, updateId);
    if (!claim) {
      await client.query("COMMIT");
      return;
    }
    await notify(client, masterBotRid, updateId, chatId, text);
    await completeUpdate(client, masterBotRid, updateId, inboxClaim);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
async function telegramGetMe(fetcher, token) {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(1e4), redirect: "error" });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true || !payload.result || typeof payload.result.username !== "string") return null;
    const username = payload.result.username.trim();
    if (!username) return null;
    return { username, first_name: String(payload.result.first_name ?? "").trim() };
  } catch {
    return null;
  }
}
async function setWebhook(services, fetcher, botRid, token, webUrl, secretKey, appKey) {
  const secret = services.webhookSecret(botRid, token, secretKey, appKey);
  const url = services.configuredWebhookUrl(webUrl, botRid);
  const response = await fetcher(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member", "chat_join_request"] }),
    signal: AbortSignal.timeout(1e4),
    redirect: "error"
  });
  const payload = await response.json();
  return response.ok && payload.ok === true;
}
async function finishProvisioning(options, args) {
  const { pool, masterBotRid } = options;
  const client = await pool.connect();
  let botRid = 0;
  let revenueRatio = "0";
  let responseText = "";
  try {
    await begin(client);
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('plugin:cloneproxy:lifecycle',0))");
    if (!options.inboxClaim && !await claimUpdate(client, masterBotRid, args.updateId)) {
      await client.query("COMMIT");
      return { handled: true, reason: "duplicate_update" };
    }
    const orderResult = await client.query("SELECT rid,status,master_bot_rid,pay_user_tg_uid::text FROM t_telegram_clone_proxy_order WHERE rid=$1 AND master_bot_rid=$2 AND pay_user_tg_uid=$3 AND order_type='opening' FOR UPDATE", [args.orderRid, masterBotRid, args.tgUid]);
    const order = orderResult.rows[0];
    if (!order || Number(order.status) !== 1) {
      await notify(client, masterBotRid, args.updateId, args.chatId, "\u8BE5\u5F00\u6237\u8BA2\u5355\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u53D1\u8D77\u3002");
      await completeUpdate(client, masterBotRid, args.updateId, options.inboxClaim);
      await client.query("COMMIT");
      return { handled: true, reason: "order_unavailable" };
    }
    const waiter = await client.query("SELECT clone_proxy_order_rid FROM t_platform_cloneproxy_token_waiter WHERE master_bot_rid=$1 AND pay_user_tg_uid=$2 FOR UPDATE", [masterBotRid, args.tgUid]);
    if (waiter.rowCount && String(waiter.rows[0].clone_proxy_order_rid) !== String(args.orderRid)) {
      await notify(client, masterBotRid, args.updateId, args.chatId, "\u5F53\u524D\u5F00\u6237\u8BA2\u5355\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u673A\u5668\u4EBA token\u3002");
      await completeUpdate(client, masterBotRid, args.updateId, options.inboxClaim);
      await client.query("COMMIT");
      return { handled: true, reason: "waiter_changed" };
    }
    const configResult = await client.query(
      "SELECT rid,merchant_limit,default_revenue_ratio::text FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 FOR UPDATE",
      [masterBotRid]
    );
    const config = configResult.rows[0];
    if (!config) {
      await rollback(client);
      return { handled: false, reason: "config_missing" };
    }
    const tokenDigestLock = createHash("sha256").update(args.token).digest("hex");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cloneproxy-token:' || $1,0))", [tokenDigestLock]);
    const usernameKey = args.candidate.username.toLowerCase();
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cloneproxy-username:' || $1,0))", [usernameKey]);
    const duplicateToken = await client.query("SELECT 1 FROM t_telegram_bot WHERE bot_token=$1 UNION ALL SELECT 1 FROM t_telegram_clone_proxy_merchant WHERE bot_token_hash=$2 LIMIT 1", [args.token, args.tokenHash]);
    const duplicateOwner = await client.query("SELECT 1 FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND owner_tg_uid=$2 LIMIT 1", [masterBotRid, args.tgUid]);
    const duplicateUsername = await client.query("SELECT 1 FROM t_telegram_bot WHERE LOWER(bot_username)=LOWER($1) LIMIT 1", [args.candidate.username]);
    if (duplicateToken.rowCount || duplicateOwner.rowCount || duplicateUsername.rowCount) {
      const text = duplicateToken.rowCount ? "\u8FD9\u4E2A\u673A\u5668\u4EBA token \u5DF2\u7ECF\u88AB\u7CFB\u7EDF\u4F7F\u7528\uFF0C\u8BF7\u6362\u4E00\u4E2A\u673A\u5668\u4EBA\u3002" : duplicateOwner.rowCount ? "\u8BE5\u7528\u6237\u5DF2\u5F00\u6237\u3002" : "\u673A\u5668\u4EBA\u7528\u6237\u540D\u5DF2\u5B58\u5728\uFF0C\u8BF7\u66F4\u6362\u673A\u5668\u4EBA\u540E\u91CD\u8BD5\u3002";
      await notify(client, masterBotRid, args.updateId, args.chatId, text);
      await completeUpdate(client, masterBotRid, args.updateId, options.inboxClaim);
      await client.query("COMMIT");
      return { handled: true, reason: "duplicate_credential" };
    }
    const capacity = await client.query(
      "SELECT count(*)::int AS count FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND status=1",
      [masterBotRid]
    );
    if (Number(config.merchant_limit) > 0 && Number(capacity.rows[0]?.count ?? 0) >= Number(config.merchant_limit)) {
      await notify(client, masterBotRid, args.updateId, args.chatId, "\u5F53\u524D\u4EE3\u7406\u5546\u6237\u540D\u989D\u5DF2\u6EE1\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002");
      await completeUpdate(client, masterBotRid, args.updateId, options.inboxClaim);
      await client.query("COMMIT");
      return { handled: true, reason: "capacity_exhausted" };
    }
    const inserted = await client.query(
      "INSERT INTO t_telegram_bot(bot_token,bot_admin_username,bot_firstname,bot_username,comments,create_by,create_time,last_update_id) VALUES($1,$2,$3,$4,$5,0,now(),0) RETURNING rid",
      [args.token, "@" + args.tgUsername, args.candidate.first_name, args.candidate.username, "\u514B\u9686/\u4EE3\u7406\u5546\u6237\uFF1A@" + args.tgUsername]
    );
    botRid = Number(inserted.rows[0]?.rid);
    if (!Number.isSafeInteger(botRid) || botRid <= 0) throw new Error("clone proxy bot insert failed");
    await options.services.cloneBotConfiguration(client, masterBotRid, botRid, false);
    const merchant = await client.query(
      "INSERT INTO t_telegram_clone_proxy_merchant(master_bot_rid,bot_rid,owner_tg_uid,owner_tg_username,owner_tg_name,bot_token_hash,revenue_ratio,status,total_revenue_usdt,total_revenue_trx,webhook_status,create_time,update_time) VALUES($1,$2,$3,$4,$5,$6,$7,1,0,0,0,now(),now()) RETURNING rid",
      [masterBotRid, botRid, args.tgUid, args.tgUsername, args.tgName, args.tokenHash, config.default_revenue_ratio]
    );
    const orderUpdate = await client.query(
      "UPDATE t_telegram_clone_proxy_order SET merchant_rid=$2,bot_rid=$3,status=2,update_time=now(),complete_time=now(),comments='\u5F00\u6237\u6210\u529F' WHERE rid=$1 AND status=1",
      [args.orderRid, merchant.rows[0].rid, botRid]
    );
    if (orderUpdate.rowCount !== 1) throw new Error("clone proxy order changed");
    const user = await client.query("SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE", [masterBotRid, args.tgUid]);
    if (!user.rowCount) {
      await client.query("INSERT INTO t_telegram_bot_user(bot_rid,tg_uid,tg_username,tg_nickname,status,cash_trx,cash_usdt,max_monitor_wallet,first_time) VALUES($1,$2,$3,$4,1,0,0,0,now())", [masterBotRid, args.tgUid, args.tgUsername, args.tgName]);
    } else {
      await client.query("UPDATE t_telegram_bot_user SET tg_username=$2,tg_nickname=$3,status=1 WHERE rid=$1", [user.rows[0].rid, args.tgUsername, args.tgName]);
    }
    await client.query("UPDATE t_platform_cloneproxy_token_waiter SET consumed_at=now() WHERE master_bot_rid=$1 AND pay_user_tg_uid=$2 AND clone_proxy_order_rid=$3 AND consumed_at IS NULL", [masterBotRid, args.tgUid, args.orderRid]);
    revenueRatio = String(config.default_revenue_ratio);
    responseText = "\u2705\u5DF2\u7ECF\u6210\u529F\u5F00\u6237\uFF0C\u673A\u5668\u4EBA\u5DF2\u52A0\u5165\u7CFB\u7EDF\u7FA4\u63A7\u3002\n\u673A\u5668\u4EBA\uFF1A@" + html(args.candidate.username) + "\n\u6536\u76CA\u6BD4\u4F8B\uFF1A" + html(revenueRatio) + "%";
    await notify(client, masterBotRid, args.updateId, args.chatId, responseText);
    await completeUpdate(client, masterBotRid, args.updateId, options.inboxClaim);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
  let webhookOk = false;
  let webhookError = "Webhook \u6CE8\u518C\u8BF7\u6C42\u5931\u8D25";
  if (["local", "dev", "development"].includes(options.appEnvironment ?? process.env.APP_ENV ?? "")) {
    webhookOk = true;
  } else {
    try {
      const origin = options.services.configuredWebhookOrigin({ webUrl: options.webUrl ?? process.env.WEB_URL, platformOrigin: process.env.PLATFORM_ORIGIN, appUrl: process.env.APP_URL });
      webhookOk = await setWebhook(options.services, options.fetcher ?? fetch, botRid, args.token, origin, options.webhookKey ?? process.env.TELEGRAM_WEBHOOK_SECRET_KEY ?? "", options.appKey ?? process.env.APP_KEY ?? "");
      if (!webhookOk) webhookError = "Telegram \u672A\u63A5\u53D7 Webhook \u8BBE\u7F6E";
    } catch {
      webhookError = "Webhook \u6CE8\u518C\u8BF7\u6C42\u5931\u8D25";
    }
  }
  try {
    await pool.query("UPDATE t_telegram_clone_proxy_merchant SET webhook_status=$2,webhook_error=$3,update_time=now() WHERE bot_rid=$1", [botRid, webhookOk ? 1 : 2, webhookOk ? null : webhookError]);
    if (!webhookOk) {
      const warningClient = await pool.connect();
      try {
        await begin(warningClient);
        await notify(
          warningClient,
          masterBotRid,
          args.updateId,
          args.chatId,
          "\n\n\u26A0\uFE0F Webhook \u5C1A\u672A\u6CE8\u518C\uFF1A" + html(webhookError) + (["local", "dev", "development"].includes(options.appEnvironment ?? process.env.APP_ENV ?? "") ? "\uFF1B\u5F53\u524D\u5F00\u53D1\u6A21\u5F0F\u7531 Job \u8F6E\u8BE2\u63A5\u7BA1\u3002" : ""),
          "webhook-warning"
        );
        await warningClient.query("COMMIT");
      } catch (error) {
        await rollback(warningClient);
        throw error;
      } finally {
        warningClient.release();
      }
    }
  } catch {
  }
  return { handled: true, provisioned: true };
}
async function handleCloneProxyTokenUpdate(options) {
  const { update, masterBotRid, pool } = options;
  if (!(options.enabled ?? process.env.PLATFORM_TELEGRAM_ACTIONS === "true")) return { handled: false, reason: "telegram_actions_disabled" };
  if (options.shouldContinue && !options.shouldContinue()) return { handled: false, reason: "worker_stopping" };
  const updateId = update.update_id;
  const message = update.message;
  const chatId = privateId(message?.chat?.id);
  const tgUid = privateId(message?.from?.id);
  if (!Number.isSafeInteger(updateId) || typeof updateId !== "number" || updateId < 0 || !message || message.chat?.type !== "private" || message.from?.is_bot === true || !chatId || chatId.startsWith("-") || chatId !== tgUid) {
    return { handled: false, reason: "not_a_private_user_message" };
  }
  const pending = await pool.query(
    "SELECT o.rid FROM t_telegram_clone_proxy_order o LEFT JOIN t_platform_cloneproxy_token_waiter w ON w.master_bot_rid=o.master_bot_rid AND w.pay_user_tg_uid=o.pay_user_tg_uid WHERE o.master_bot_rid=$1 AND o.pay_user_tg_uid=$2 AND o.order_type='opening' AND o.status=1 AND ((w.master_bot_rid IS NOT NULL AND w.clone_proxy_order_rid=o.rid AND w.consumed_at IS NULL AND w.expires_at>now()) OR ((w.master_bot_rid IS NULL OR (w.consumed_at IS NULL AND w.expires_at<=now())) AND trim(COALESCE($3::text,'')) ~ '^\\d{6,12}:[A-Za-z0-9_-]{20,}$')) ORDER BY o.rid DESC LIMIT 1",
    [masterBotRid, tgUid, String(message.text ?? "").trim()]
  );
  const orderRid = pending.rows[0]?.rid;
  if (!orderRid) return { handled: false, reason: "no_paid_opening_order" };
  const tgUsername = String(message.from?.username ?? "").trim();
  const tgName = [message.from?.first_name, message.from?.last_name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  const token = String(message.text ?? "").trim();
  if (!tgUsername) {
    await replyAndClaim(pool, masterBotRid, updateId, chatId, "\u5FC5\u987B\u5148\u8BBE\u7F6E\u81EA\u5DF1\u7684 Telegram Username \u624D\u80FD\u5F00\u6237\uFF0C\u8BF7\u8BBE\u7F6E\u540E\u91CD\u65B0\u53D1\u9001\u673A\u5668\u4EBA token\u3002", options.inboxClaim);
    return { handled: true, reason: "username_required" };
  }
  if (!tokenPattern.test(token)) {
    await replyAndClaim(pool, masterBotRid, updateId, chatId, "\u673A\u5668\u4EBA token \u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u8BF7\u4ECE BotFather \u590D\u5236\u5B8C\u6574 token \u540E\u91CD\u8BD5\u3002", options.inboxClaim);
    return { handled: true, reason: "invalid_token_format" };
  }
  const candidate = await telegramGetMe(options.fetcher ?? fetch, token);
  if (!candidate) {
    await replyAndClaim(pool, masterBotRid, updateId, chatId, "\u673A\u5668\u4EBA token \u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 token \u672A\u8FC7\u671F\u4E14\u672A\u590D\u5236\u591A\u4F59\u7A7A\u683C\u3002", options.inboxClaim);
    return { handled: true, reason: "token_validation_failed" };
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await finishProvisioning(options, { updateId, chatId, tgUid, tgUsername, tgName, orderRid: Number(orderRid), token, tokenHash, candidate });
  return result;
}
export {
  handleCloneProxyTokenUpdate
};
