import { randomInt } from "node:crypto";
const CLONE_PROXY_BUTTON = "\u514B\u9686/\u4EE3\u7406";
const telegramCloneProxyClaimPredicate = [
  "((u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,from,id}'=u.update_body #>> '{message,chat,id}'",
  "AND regexp_replace(trim(COALESCE(u.update_body #>> '{message,text}','')), '[[:space:]\u{1F916}]', '', 'g') IN ('\u514B\u9686/\u4EE3\u7406','\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA','\u514B\u9686\u4EE3\u7406\u673A\u5668\u4EBA')",
  "AND EXISTS (SELECT 1 FROM t_telegram_clone_proxy_config c WHERE c.master_bot_rid=u.bot_rid))",
  "OR (u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND COALESCE(u.update_body #>> '{callback_query,data}','') LIKE 'cloneproxy:%')",
  ")"
].join("\n");
const privateId = (v) => /^\d{1,20}$/u.test(String(v ?? "")) ? String(v) : "";
const escapeHtml = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const formatAmount = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(6).replace(/\.?0+$/u, "") : "0";
const entryText = (v) => ["\u514B\u9686/\u4EE3\u7406", "\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA", "\u514B\u9686\u4EE3\u7406\u673A\u5668\u4EBA"].includes(String(v ?? "").replace(/[\s🤖]/gu, ""));
async function configFor(pool, botRid) {
  const result = await pool.query(
    "SELECT c.is_enable,c.charge_enable,c.open_price::text,c.default_revenue_ratio::text,c.merchant_limit,b.bot_token,b.recharge_wallet_addr FROM t_telegram_clone_proxy_config c JOIN t_telegram_bot b ON b.rid=c.master_bot_rid WHERE c.master_bot_rid=$1 LIMIT 1",
    [botRid]
  );
  return result.rows[0] ?? null;
}
async function appendCloneProxyButton(pool, botRid, chatType, markup) {
  if (chatType !== "private" || !markup || typeof markup !== "object") return markup;
  const value = markup;
  if (!Array.isArray(value.keyboard)) return markup;
  try {
    const result = await pool.query("SELECT is_enable AS enabled FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 LIMIT 1", [botRid]);
    if (Number(result.rows[0]?.enabled) !== 1) return markup;
    const hasEntry = value.keyboard.some((row) => Array.isArray(row) && row.some((button) => ["\u514B\u9686/\u4EE3\u7406", "\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA", "\u514B\u9686\u4EE3\u7406\u673A\u5668\u4EBA"].includes(typeof button === "string" ? button : String(button?.text ?? ""))));
    if (hasEntry) return markup;
    const contactRow = value.keyboard.findIndex((row) => Array.isArray(row) && row.some((button) => (typeof button === "string" ? button : String(button?.text ?? "")) === "\u{1F468}\u8054\u7CFB\u5BA2\u670D"));
    const keyboard = value.keyboard.map((row, index) => index === contactRow ? [{ text: CLONE_PROXY_BUTTON }, ...row] : row);
    return contactRow >= 0 ? { ...value, keyboard } : { ...value, keyboard: [...keyboard, [{ text: CLONE_PROXY_BUTTON }]] };
  } catch {
    return markup;
  }
}
async function send(fetcher, config, chatId, text, markup) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(String(config.bot_token ?? ""))) throw new Error("cloneproxy_bot_token_unavailable");
  const payload = { chat_id: chatId, text, parse_mode: "HTML", allow_sending_without_reply: true };
  if (markup) payload.reply_markup = markup;
  const response = await fetcher("https://api.telegram.org/bot" + config.bot_token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(12e3)
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error("cloneproxy_telegram_send_failed");
}
async function ack(fetcher, config, id) {
  if (!id) return;
  await fetcher("https://api.telegram.org/bot" + config.bot_token + "/answerCallbackQuery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: String(id) }),
    redirect: "error",
    signal: AbortSignal.timeout(12e3)
  });
}
function price(config) {
  return Number(config.charge_enable) === 1 ? Math.max(0, Number(config.open_price) || 0) : 0;
}
async function offer(fetcher, config, chatId) {
  const amount = price(config);
  const text = "\u6B22\u8FCE\u4F7F\u7528\u514B\u9686\u4EE3\u7406\u673A\u5668\u4EBA\n\n\u76EE\u524D\u4EE3\u7406\u4EF7\u4F4D\u4E3A\uFF1A<b>" + escapeHtml(amount ? formatAmount(amount) + " USDT" : "\u514D\u8D39") + "</b>\n\u9ED8\u8BA4\u6536\u76CA\u6BD4\u4F8B\uFF1A<b>" + escapeHtml(formatAmount(config.default_revenue_ratio)) + "%</b>\n\n\u5F00\u6237\u8981\u6C42\uFF1A\u9700\u5148\u8BBE\u7F6E\u81EA\u5DF1\u7684 Telegram Username\uFF0C\u4E14\u63D0\u4EA4\u7684 token \u5FC5\u987B\u5C5E\u4E8E\u6709\u6548\u673A\u5668\u4EBA\u3002\n\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u540E\uFF0C\u6309\u63D0\u793A\u5B8C\u6210\u652F\u4ED8\uFF08\u5982\u6709\u8D39\u7528\uFF09\u5E76\u53D1\u9001\u673A\u5668\u4EBA token\u3002";
  await send(fetcher, config, chatId, text, { inline_keyboard: [[{ text: amount ? "\u6DFB\u52A0\u673A\u5668\u4EBA\uFF08\u652F\u4ED8\u5F00\u6237\uFF09" : "\u6DFB\u52A0\u673A\u5668\u4EBA", callback_data: "cloneproxy:add" }]] });
}
async function promptToken(fetcher, config, chatId) {
  await send(fetcher, config, chatId, "\u8BF7\u53D1\u9001\u4F60\u7684\u673A\u5668\u4EBA token\u3002\n\n\u683C\u5F0F\u793A\u4F8B\uFF1A<code>123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code>\n\nToken \u53EA\u7528\u4E8E\u8C03\u7528 Telegram Bot API\uFF0C\u4E0D\u4F1A\u5728\u7528\u6237\u754C\u9762\u56DE\u663E\u3002", {
    force_reply: true,
    input_field_placeholder: "\u8BF7\u7C98\u8D34 BotFather token"
  });
}
async function expire(client, order) {
  await client.query("UPDATE t_telegram_clone_proxy_order SET status=3,comments='\u5F00\u6237\u8BA2\u5355\u5DF2\u8FC7\u671F',update_time=now() WHERE rid=$1 AND status=0", [order.rid]);
  if (order.external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='\u514B\u9686\u4EE3\u7406\u5F00\u6237\u8BA2\u5355\u5DF2\u8FC7\u671F',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [order.external_order_rid]);
}
async function showPayment(fetcher, config, chatId, order) {
  const wallet = String(config.recharge_wallet_addr ?? "").trim();
  let text = "\u5F00\u6237\u8BA2\u5355\u5DF2\u751F\u6210\n\u8BA2\u5355\u53F7\uFF1A<code>" + order.rid + "</code>\n\u5F00\u6237\u8D39\u7528\uFF1A<b>" + escapeHtml(formatAmount(order.amount)) + " USDT</b>\n";
  text += wallet && order.external_order_rid ? "\n\u94FE\u4E0A\u652F\u4ED8\u91D1\u989D\uFF1A<code>" + escapeHtml(formatAmount(order.need_pay_amount)) + "</code> USDT\n\u652F\u4ED8\u5730\u5740\uFF1A<code>" + escapeHtml(wallet) + "</code>\n\u8BF7\u5728\u8BA2\u5355\u6709\u6548\u671F\u5185\u5B8C\u6210\u8F6C\u8D26\uFF0C\u5230\u8D26\u540E\u76F4\u63A5\u53D1\u9001\u673A\u5668\u4EBA token\u3002" : "\n\u7BA1\u7406\u5458\u5C1A\u672A\u914D\u7F6E\u5145\u503C\u5730\u5740\uFF0C\u5F53\u524D\u53EF\u4F7F\u7528\u4E0B\u65B9\u4F59\u989D\u652F\u4ED8\u3002";
  await send(fetcher, config, chatId, text, { inline_keyboard: [
    [{ text: "\u4F59\u989D\u652F\u4ED8", callback_data: "cloneproxy:balance:" + order.rid }],
    [{ text: "\u53D6\u6D88\u8BA2\u5355", callback_data: "cloneproxy:cancel:" + order.rid }]
  ] });
}
async function onboarding(pool, fetcher, config, botRid, chatId, userId, username) {
  if (!username) {
    await send(fetcher, config, chatId, "\u8BF7\u5148\u5728 Telegram \u8BBE\u7F6E\u4E00\u4E2A\u516C\u5F00\u7528\u6237\u540D\uFF08Username\uFF09\uFF0C\u518D\u8FDB\u884C\u5F00\u6237\u3002\u8BBE\u7F6E\u5B8C\u6210\u540E\u91CD\u65B0\u70B9\u51FB\u300C\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA\u300D\u3002");
    return;
  }
  const client = await pool.connect();
  let outcome;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('plugin:cloneproxy:lifecycle',0))");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cloneproxy-open:' || $1 || ':' || $2,0))", [botRid, userId]);
    const configResult = await client.query("SELECT is_enable,charge_enable,open_price::text,default_revenue_ratio::text,merchant_limit FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 FOR UPDATE", [botRid]);
    const current = configResult.rows[0];
    if (!current || Number(current.is_enable) !== 1) {
      outcome = { type: "full" };
      await client.query("COMMIT");
    } else {
      const active = await client.query("SELECT 1 FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND owner_tg_uid=$2 AND status=1 LIMIT 1", [botRid, userId]);
      if (active.rowCount) {
        outcome = { type: "active" };
        await client.query("COMMIT");
      } else {
        const pendingResult = await client.query(
          "SELECT rid,status,amount::text,need_pay_amount::text,external_order_rid,expire_time<now() AS expired FROM t_telegram_clone_proxy_order WHERE master_bot_rid=$1 AND pay_user_tg_uid=$2 AND order_type='opening' AND status IN (0,1) ORDER BY rid DESC LIMIT 1 FOR UPDATE",
          [botRid, userId]
        );
        let pending = pendingResult.rows[0];
        if (pending?.status === 0 && pending.expired) {
          await expire(client, pending);
          pending = void 0;
        }
        if (pending) {
          await client.query("COMMIT");
          outcome = pending.status === 1 ? { type: "token" } : { type: "payment", order: pending };
        } else {
          const count = await client.query("SELECT count(*)::int AS count FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND status=1", [botRid]);
          if (Number(current.merchant_limit) > 0 && Number(count.rows[0]?.count ?? 0) >= Number(current.merchant_limit)) {
            outcome = { type: "full" };
            await client.query("COMMIT");
          } else {
            const amount = price(current);
            const orderResult = await client.query(
              "INSERT INTO t_telegram_clone_proxy_order(master_bot_rid,order_type,source_type,pay_user_tg_uid,pay_user_tg_username,amount,need_pay_amount,coin_name,payment_method,status,revenue_ratio,comments,create_time,update_time,paid_time,expire_time) VALUES($1,'opening','opening',$2,$3,$4,$4,'usdt',$5,$6,$7,$8,now(),now(),CASE WHEN $6=1 THEN now() ELSE NULL END,CASE WHEN $6=0 THEN now()+interval '15 minutes' ELSE NULL END) RETURNING rid",
              [botRid, userId, username, amount, amount ? "pending" : "free", amount ? 0 : 1, current.default_revenue_ratio, amount ? "\u5F85\u652F\u4ED8\u5F00\u6237" : "\u514D\u8D39\u5F00\u6237"]
            );
            const orderId = Number(orderResult.rows[0].rid);
            let needPay = String(amount);
            let fmsId = null;
            if (amount && String(config.recharge_wallet_addr ?? "").trim()) {
              for (let n = 0; n < 20; n++) {
                const candidate = await client.query("SELECT round($1::numeric+$2::numeric/100,4)::text AS amount", [amount, randomInt(1, 100)]);
                needPay = candidate.rows[0].amount;
                const duplicate = await client.query("SELECT 1 FROM t_fms_recharge_order WHERE status=0 AND need_pay_price=$1 LIMIT 1", [needPay]);
                if (!duplicate.rowCount) break;
              }
              const fms = await client.query(
                "INSERT INTO t_fms_recharge_order(bot_rid,recharge_tg_uid,recharge_tg_username,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments,create_time,expire_time) VALUES($1,$2,$3,'usdt',$4,$5,0,$6,now(),now()+interval '15 minutes') RETURNING rid",
                [botRid, userId, username, amount, needPay, "__clone_proxy__:" + orderId]
              );
              fmsId = Number(fms.rows[0].rid);
              await client.query("UPDATE t_telegram_clone_proxy_order SET need_pay_amount=$2,external_order_rid=$3,update_time=now() WHERE rid=$1", [orderId, needPay, fmsId]);
            }
            await client.query("COMMIT");
            const order = { rid: orderId, amount: String(amount), need_pay_amount: needPay, external_order_rid: fmsId };
            outcome = amount ? { type: "payment", order } : { type: "token" };
          }
        }
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
  if (outcome.type === "active") await send(fetcher, config, chatId, "\u60A8\u5DF2\u7ECF\u5F00\u901A\u8FC7\u4EE3\u7406\u673A\u5668\u4EBA\uFF0C\u65E0\u9700\u91CD\u590D\u5F00\u6237\u3002");
  else if (outcome.type === "full") await send(fetcher, config, chatId, "\u5F53\u524D\u4EE3\u7406\u5546\u6237\u540D\u989D\u5DF2\u6EE1\u6216\u529F\u80FD\u5DF2\u5173\u95ED\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002");
  else if (outcome.type === "payment") await showPayment(fetcher, config, chatId, outcome.order);
  else await promptToken(fetcher, config, chatId);
}
async function pay(pool, fetcher, config, botRid, chatId, userId, orderId) {
  const client = await pool.connect();
  let result = "unavailable";
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT status,amount::text,external_order_rid,expire_time<now() AS expired FROM t_telegram_clone_proxy_order WHERE rid=$1 AND master_bot_rid=$2 AND pay_user_tg_uid=$3 AND order_type='opening' FOR UPDATE",
      [orderId, botRid, userId]
    );
    const order = found.rows[0];
    if (order?.status === 1) result = "paid";
    else if (order?.status === 0 && order.expired) {
      await expire(client, { rid: orderId, external_order_rid: order.external_order_rid });
      result = "expired";
    } else if (order?.status === 0) {
      const debited = await client.query("UPDATE t_telegram_bot_user SET cash_usdt=cash_usdt-$1::numeric WHERE bot_rid=$2 AND tg_uid=$3 AND cash_usdt >= $1::numeric RETURNING rid", [order.amount, botRid, userId]);
      if (!debited.rowCount) result = "insufficient";
      else {
        await client.query("UPDATE t_telegram_clone_proxy_order SET payment_method='balance',status=1,paid_time=now(),comments='\u4F59\u989D\u652F\u4ED8\u6210\u529F\uFF0C\u7B49\u5F85\u63D0\u4EA4\u673A\u5668\u4EBA token',update_time=now() WHERE rid=$1 AND status=0", [orderId]);
        if (order.external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='\u5DF2\u4F7F\u7528\u4F59\u989D\u652F\u4ED8\u5F00\u6237',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [order.external_order_rid]);
        result = "paid";
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
  if (result === "paid") await promptToken(fetcher, config, chatId);
  else await send(fetcher, config, chatId, result === "expired" ? "\u8BE5\u5F00\u6237\u8BA2\u5355\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u53D1\u8D77\u5F00\u6237\u3002" : result === "insufficient" ? "USDT\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u5145\u503C\u540E\u518D\u652F\u4ED8\u5F00\u6237\u3002" : "\u8BA2\u5355\u4E0D\u5B58\u5728\u3001\u5DF2\u652F\u4ED8\u6216\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u53D1\u8D77\u5F00\u6237\u3002");
}
async function cancel(pool, fetcher, config, botRid, chatId, userId, orderId) {
  const client = await pool.connect();
  let changed = false;
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT external_order_rid FROM t_telegram_clone_proxy_order WHERE rid=$1 AND master_bot_rid=$2 AND pay_user_tg_uid=$3 AND order_type='opening' AND status=0 FOR UPDATE", [orderId, botRid, userId]);
    if (found.rowCount) {
      await client.query("UPDATE t_telegram_clone_proxy_order SET status=3,comments='\u7528\u6237\u53D6\u6D88\u5F00\u6237\u8BA2\u5355',update_time=now() WHERE rid=$1 AND status=0", [orderId]);
      if (found.rows[0].external_order_rid) await client.query("UPDATE t_fms_recharge_order SET status=3,comments='\u7528\u6237\u53D6\u6D88\u514B\u9686\u4EE3\u7406\u5F00\u6237\u8BA2\u5355',cancel_time=now(),update_time=now() WHERE rid=$1 AND status=0", [found.rows[0].external_order_rid]);
      changed = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
  await send(fetcher, config, chatId, changed ? "\u5F00\u6237\u8BA2\u5355\u5DF2\u53D6\u6D88\u3002" : "\u8BA2\u5355\u4E0D\u5B58\u5728\u6216\u5DF2\u5904\u7406\u3002");
}
async function handleTelegramCloneProxyUpdate(options) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== "true" || options.shouldContinue?.() === false) return false;
  const callback = options.update.callback_query;
  const message = callback?.message ?? options.update.message;
  const chatId = privateId(message?.chat?.id);
  const from = callback?.from ?? options.update.message?.from;
  const userId = privateId(from?.id);
  if (message?.chat?.type !== "private" || !chatId || !userId || chatId !== userId || from?.is_bot === true) return false;
  const data = String(callback?.data ?? "");
  if (callback ? !data.startsWith("cloneproxy:") : !entryText(options.update.message?.text)) return false;
  const config = await configFor(options.pool, options.botRid);
  if (!config) return false;
  if (callback) {
    await ack(options.fetcher, config, callback.id);
    const balance = /^cloneproxy:balance:(\d{1,18})$/u.exec(data);
    const cancelMatch = /^cloneproxy:cancel:(\d{1,18})$/u.exec(data);
    if (balance) await pay(options.pool, options.fetcher, config, options.botRid, chatId, userId, Number(balance[1]));
    else if (cancelMatch) await cancel(options.pool, options.fetcher, config, options.botRid, chatId, userId, Number(cancelMatch[1]));
    else if (Number(config.is_enable) !== 1) await send(options.fetcher, config, chatId, "\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA\u529F\u80FD\u76EE\u524D\u5DF2\u5173\u95ED\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002");
    else if (data === "cloneproxy:open") await offer(options.fetcher, config, chatId);
    else if (data === "cloneproxy:add") await onboarding(options.pool, options.fetcher, config, options.botRid, chatId, userId, String(from?.username ?? "").trim());
    else {
      await send(options.fetcher, config, chatId, "\u64CD\u4F5C\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u300C\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA\u300D\u3002");
    }
  } else if (Number(config.is_enable) !== 1) await send(options.fetcher, config, chatId, "\u514B\u9686/\u4EE3\u7406\u673A\u5668\u4EBA\u529F\u80FD\u76EE\u524D\u5DF2\u5173\u95ED\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002");
  else await offer(options.fetcher, config, chatId);
  return true;
}
export {
  CLONE_PROXY_BUTTON,
  appendCloneProxyButton,
  handleTelegramCloneProxyUpdate,
  telegramCloneProxyClaimPredicate
};
