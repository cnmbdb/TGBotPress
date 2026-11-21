function createGroupUpdates(host) {
  const { db, scanRecentGroupMessages, telegramCalculatorReply, handleTelegramKeywordReply, handleTelegramExchangeRate, lookupTronApprovals, lookupTronAddress, DISABLED_SECRET_COMMAND_REPLY, isDisabledSensitiveTelegramCommand } = host;
  function groupMessage(update) {
    const message = update.message ?? update.edited_message;
    if (!message || typeof message !== "object" || Array.isArray(message) || !message.chat || typeof message.chat !== "object" || !["group", "supergroup"].includes(message.chat.type)) return null;
    if (!/^-?\d{1,20}$/.test(String(message.chat.id)) || !/^\d{1,20}$/.test(String(message.message_id))) return null;
    return message;
  }
  async function claim(pool, owner, batchSize) {
    const result = await pool.query(`WITH candidates AS (
    SELECT rid FROM t_platform_telegram_update
    WHERE ((update_body ? 'message' AND update_body #>> '{message,chat,type}' IN ('group','supergroup'))
       OR (update_body ? 'edited_message' AND update_body #>> '{edited_message,chat,type}' IN ('group','supergroup')))
      AND NOT (update_body ? 'message' AND (update_body #> '{message,new_chat_member}' IS NOT NULL OR update_body #> '{message,new_chat_members}' IS NOT NULL))
      AND attempts < 8
      AND ((status IN ('pending','failed') AND next_attempt_at <= CURRENT_TIMESTAMP) OR (status='processing' AND lease_until < CURRENT_TIMESTAMP))
    ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE t_platform_telegram_update AS u SET status='processing',attempts=u.attempts+1,lease_owner=$2,lease_until=CURRENT_TIMESTAMP+interval '30 seconds'
  FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body`, [batchSize, owner]);
    return result.rows;
  }
  async function recordMessage(pool, botRid, message) {
    const text = [message.text, message.caption].filter((value) => typeof value === "string").join("\n");
    await pool.query(
      `INSERT INTO t_telegram_group_message_history(bot_rid,chat_id,message_id,user_id,message_date,message_text,message_json,create_time)
    VALUES($1,$2,$3,$4,COALESCE(to_timestamp($5)::timestamp,now()),$6,$7::jsonb,now())
    ON CONFLICT(bot_rid,chat_id,message_id) DO UPDATE SET user_id=EXCLUDED.user_id,message_date=EXCLUDED.message_date,message_text=EXCLUDED.message_text,message_json=EXCLUDED.message_json,create_time=EXCLUDED.create_time`,
      [botRid, String(message.chat.id), String(message.message_id), message.from?.id == null ? null : String(message.from.id), Number.isSafeInteger(message.date) && Number(message.date) > 0 ? message.date : null, text, JSON.stringify(message)]
    );
  }
  async function syncGroupTitle(pool, botRid, message) {
    const title = message.new_chat_title;
    if (typeof title !== "string" || title.length === 0 || message.from?.is_bot === true) return;
    const chatId = String(message.chat.id);
    const group = await pool.query(
      "SELECT rid FROM t_telegram_bot_group WHERE bot_rid=$1 AND tg_groupid=$2 ORDER BY rid LIMIT 1",
      [botRid, chatId]
    );
    const username = message.chat.username ?? "";
    if (group.rows[0]) {
      await pool.query(`UPDATE t_telegram_bot_group SET status=1,tg_groupusername=$2,tg_groupnickname=$3,last_time=CURRENT_TIMESTAMP,stop_time=NULL WHERE rid=$1`, [group.rows[0].rid, username, title]);
      return;
    }
    await pool.query(`INSERT INTO t_telegram_bot_group(bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,first_time)
    VALUES($1,$2,$3,$4,$5,1,CURRENT_TIMESTAMP)`, [botRid, message.chat.type, chatId, username, title]);
  }
  async function telegramRequest(fetcher, token, method, payload) {
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, result: void 0 };
    try {
      const response = await fetcher("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(12e3) });
      return await response.json();
    } catch {
      return { ok: false, result: void 0 };
    }
  }
  async function handleGroupTronApprovalCommand(pool, fetcher, botRid, message) {
    const text = String(message.text ?? "").trim();
    if (!text.startsWith("\u67E5\u6388\u6743")) return false;
    const tokenResult = await pool.query("SELECT bot_token FROM t_telegram_bot WHERE rid=$1", [botRid]);
    const token = tokenResult.rows[0]?.bot_token ?? "";
    const address = text.slice("\u67E5\u6388\u6743".length).trim().split(/\s+/u)[0] ?? "";
    let messages;
    let replyMarkup;
    if (!/^T.{33}$/u.test(address)) {
      messages = ["\u8F93\u5165\u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u8F93\u5165\u683C\u5F0F\uFF1A\u67E5\u6388\u6743xxxxxxx  xxxxxxx\u4E3A\u6CE2\u573A\u94B1\u5305\u5730\u5740\u3002\n\n\u6BD4\u5982  \u67E5\u6388\u6743TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS"];
    } else {
      try {
        const result = await lookupTronApprovals({ pool, fetcher, address });
        messages = result.messages;
        replyMarkup = result.replyMarkup;
      } catch {
        const safeAddress = address.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
        messages = ["\u67E5\u8BE2\u5730\u5740\uFF1A<code>" + safeAddress + "</code>\n\u67E5\u8BE2\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"];
        replyMarkup = { inline_keyboard: [[{ text: "\u6CE2\u573A\u94FE\u4E0A\u67E5\u8BE2", url: "https://tronscan.org/#/address/" + encodeURIComponent(address) }]] };
      }
    }
    for (const [index, text2] of messages.entries()) {
      const payload = {
        chat_id: String(message.chat.id),
        text: text2,
        parse_mode: "HTML",
        allow_sending_without_reply: true
      };
      if (index === 0) payload.reply_to_message_id = message.message_id;
      if (index === messages.length - 1 && replyMarkup) payload.reply_markup = replyMarkup;
      const sent = await telegramRequest(fetcher, token, "sendMessage", payload);
      if (!sent.ok) throw new Error("telegram_group_tron_approval_reply_failed");
    }
    return true;
  }
  async function handleGroupTronAddress(pool, fetcher, botRid, message) {
    const address = String(message.text ?? "").trim();
    if (!/^T.{33}$/u.test(address)) return false;
    const botResult = await pool.query(
      "SELECT bot_token,bot_username FROM t_telegram_bot WHERE rid=$1",
      [botRid]
    );
    const bot = botResult.rows[0];
    if (!bot?.bot_token) throw new Error("telegram_group_address_bot_missing");
    let reply;
    try {
      reply = await lookupTronAddress({ pool, fetcher, address, botUsername: bot.bot_username });
    } catch {
      const safeAddress = address.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      reply = { text: "\u67E5\u8BE2\u5730\u5740\uFF1A<code>" + safeAddress + "</code>\\n\u67E5\u8BE2\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u683C\u5F0F\u6216\u7A0D\u540E\u91CD\u8BD5\u3002", replyMarkup: { inline_keyboard: [] } };
    }
    const sent = await telegramRequest(fetcher, bot.bot_token, "sendMessage", {
      chat_id: String(message.chat.id),
      text: reply.text.slice(0, 3900),
      parse_mode: "HTML",
      allow_sending_without_reply: true,
      reply_to_message_id: message.message_id,
      reply_markup: reply.replyMarkup
    });
    if (!sent.ok) throw new Error("telegram_group_tron_address_reply_failed");
    return true;
  }
  async function captureGroupKeyword(pool, fetcher, botRid, message) {
    const command = String(message.text ?? "").trim().match(/^\/jgjc(?:@([a-z0-9_]+))?\s*$/iu);
    if (!command || !message.from?.id || message.from.is_bot) return false;
    const botResult = await pool.query("SELECT bot_token,bot_username FROM t_telegram_bot WHERE rid=$1", [botRid]);
    const bot = botResult.rows[0];
    if (!bot?.bot_token) return false;
    const mentioned = String(command[1] ?? "");
    const username = String(bot.bot_username ?? "").replace(/^@/, "");
    if (mentioned && (!username || mentioned.toLowerCase() !== username.toLowerCase())) return false;
    const policy = await pool.query("SELECT group_moderation_enabled,ad_keywords FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2", [botRid, String(message.chat.id)]);
    if (!policy.rows[0]?.group_moderation_enabled) return false;
    const member = await telegramRequest(fetcher, bot.bot_token, "getChatMember", { chat_id: String(message.chat.id), user_id: String(message.from.id) });
    if (!member.ok || !["creator", "administrator"].includes(String(member.result?.status ?? ""))) return false;
    await telegramRequest(fetcher, bot.bot_token, "deleteMessage", { chat_id: String(message.chat.id), message_id: String(message.message_id) });
    const target = message.reply_to_message;
    const content = target ? [target.text, target.caption].filter((value) => typeof value === "string").join("\n").trim() : "";
    let outcome = "ignored";
    let detail = "\u7BA1\u7406\u5458\u5173\u952E\u8BCD\u547D\u4EE4\u7F3A\u5C11\u53EF\u4FDD\u5B58\u7684\u56DE\u590D\u6D88\u606F";
    if (target && content) {
      const targetWithChat = { ...target, chat: target.chat ?? message.chat };
      await recordMessage(pool, botRid, targetWithChat);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT ad_keywords FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2 FOR UPDATE", [botRid, String(message.chat.id)]);
        if (!current.rows[0]) throw new Error("group_policy_missing");
        const words = String(current.rows[0].ad_keywords ?? "").split(/[,，\r\n]+/u).map((value) => value.trim()).filter(Boolean);
        const duplicate = words.some((value) => value.toLocaleLowerCase("und") === content.toLocaleLowerCase("und"));
        const merged = duplicate ? words.join("\n") : [...words, content].join("\n");
        if (!duplicate && Array.from(merged).length <= 5e3) {
          await client.query("UPDATE t_telegram_bot_group_policy SET ad_keywords=$3,update_time=now() WHERE bot_rid=$1 AND tg_groupid=$2", [botRid, String(message.chat.id), merged]);
          outcome = "saved";
          detail = "\u7BA1\u7406\u5458\u5DF2\u5C06\u56DE\u590D\u6D88\u606F\u4FDD\u5B58\u4E3A\u672C\u7FA4\u72EC\u7ACB\u5173\u952E\u8BCD";
        } else if (duplicate) detail = "\u8BE5\u5173\u952E\u8BCD\u5DF2\u5B58\u5728\uFF0C\u4ECD\u5DF2\u6267\u884C\u56DE\u626B";
        else detail = "\u672C\u7FA4\u5173\u952E\u8BCD\u5DF2\u8FBE\u5230\u957F\u5EA6\u4E0A\u9650\uFF0C\u4ECD\u5DF2\u6267\u884C\u56DE\u626B";
        await client.query(
          `INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
        SELECT $1,$2,$3,$4,'keyword_capture',$5,0,$6,$7,now() WHERE NOT EXISTS (
          SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$4 AND event_type='keyword_capture')`,
          [botRid, String(message.chat.id), String(message.from.id), String(message.message_id), outcome, detail, Array.from(content).slice(0, 450).join("")]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      await pool.query(
        `INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
      SELECT $1,$2,$3,$4,'keyword_capture','ignored',0,$5,'',now() WHERE NOT EXISTS (
        SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$4 AND event_type='keyword_capture')`,
        [botRid, String(message.chat.id), String(message.from.id), String(message.message_id), detail]
      );
    }
    const scan = await scanRecentGroupMessages({ botRid, chatId: String(message.chat.id), minutes: 30, pool, fetcher });
    if (scan.failed) throw new Error("group_keyword_rescan_failed");
    return true;
  }
  async function processGroupManagementPluginUpdate(options) {
    const message = groupMessage(options.update);
    if (!message) throw new Error("invalid_group_message");
    if (process.env.PLATFORM_TELEGRAM_ACTIONS === "true" && await captureGroupKeyword(options.pool, options.fetcher, options.botRid, message)) return;
    await recordMessage(options.pool, options.botRid, message);
    await syncGroupTitle(options.pool, options.botRid, message);
    if (process.env.PLATFORM_TELEGRAM_ACTIONS === "true") {
      const moderation = await scanRecentGroupMessages({ botRid: options.botRid, chatId: String(message.chat.id), messageId: String(message.message_id), pool: options.pool, fetcher: options.fetcher });
      if (moderation.skipped || moderation.failed > 0) throw new Error("group_moderation_failed");
    }
  }
  async function syncTelegramGroupMessages(options) {
    const enabled = options.enabled ?? process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === "true";
    if (!enabled) return { skipped: true, processed: 0, failed: 0 };
    const pool = options.pool ?? db, shouldContinue = options.shouldContinue ?? (() => true), logger = options.logger ?? console;
    const fetcher = options.fetcher ?? fetch;
    if (!shouldContinue()) return { skipped: true, processed: 0, failed: 0 };
    const owner = "group-moderation-" + process.pid;
    const batchSize = Math.min(Math.max(options.batchSize ?? 20, 1), 100);
    let processed = 0, failed = 0;
    try {
      const updates = await claim(pool, owner, batchSize);
      for (const update of updates) {
        if (!shouldContinue()) break;
        try {
          const message = groupMessage(update.update_body);
          if (!message) throw new Error("invalid_group_message");
          if (isDisabledSensitiveTelegramCommand(message.text ?? message.caption)) {
            if (process.env.PLATFORM_TELEGRAM_ACTIONS === "true") {
              const bot = await pool.query("SELECT bot_token FROM t_telegram_bot WHERE rid=$1", [update.bot_rid]);
              const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? "", "sendMessage", {
                chat_id: String(message.chat.id),
                text: DISABLED_SECRET_COMMAND_REPLY,
                reply_to_message_id: message.message_id,
                allow_sending_without_reply: true
              });
              if (!sent.ok) throw new Error("telegram_disabled_secret_reply_failed");
            }
            await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
            processed++;
            continue;
          }
          if (process.env.PLATFORM_TELEGRAM_ACTIONS === "true") {
            const exchangeRate = await handleTelegramExchangeRate({
              pool,
              botRid: update.bot_rid,
              update: update.update_body,
              allowGroups: true,
              sendMessage: async (sourceMessage, text) => {
                const bot = await pool.query("SELECT bot_token FROM t_telegram_bot WHERE rid=$1", [update.bot_rid]);
                const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? "", "sendMessage", {
                  chat_id: String(sourceMessage.chat?.id ?? ""),
                  text,
                  reply_to_message_id: sourceMessage.message_id,
                  parse_mode: "HTML",
                  allow_sending_without_reply: true
                });
                return sent.ok === true;
              }
            });
            if (exchangeRate.kind === "replied") {
              await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
              processed++;
              continue;
            }
            if (await handleGroupTronApprovalCommand(pool, fetcher, update.bot_rid, message)) {
              await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
              processed++;
              continue;
            }
            if (await handleGroupTronAddress(pool, fetcher, update.bot_rid, message)) {
              await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
              processed++;
              continue;
            }
            const calculatorReply = telegramCalculatorReply(String(message.text ?? "").trim());
            if (calculatorReply !== null) {
              const bot = await pool.query("SELECT bot_token FROM t_telegram_bot WHERE rid=$1", [update.bot_rid]);
              const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? "", "sendMessage", {
                chat_id: String(message.chat.id),
                text: calculatorReply,
                reply_to_message_id: message.message_id,
                allow_sending_without_reply: true,
                parse_mode: "HTML"
              });
              if (!sent.ok) throw new Error("telegram_calculator_delivery_failed");
            } else {
              await handleTelegramKeywordReply({ pool, fetcher, botRid: update.bot_rid, message });
            }
          }
          await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
          processed++;
        } catch {
          failed++;
          await pool.query("UPDATE t_platform_telegram_update SET status='failed',next_attempt_at=CURRENT_TIMESTAMP+LEAST(interval '5 minutes',interval '2 seconds'*power(2,LEAST(attempts,7))),lease_owner=NULL,lease_until=NULL,last_error_code='group_moderation_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner]);
          logger.error("Telegram group moderation update failed");
        }
      }
      return { skipped: false, processed, failed };
    } catch {
      logger.error("Telegram group moderation update batch failed");
      return { skipped: false, processed, failed, fatal: true };
    }
  }
  return { groupMessage, processGroupManagementPluginUpdate, syncTelegramGroupMessages };
}
export {
  createGroupUpdates
};
