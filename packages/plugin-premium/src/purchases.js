import { constants, createPrivateKey, privateDecrypt, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { telegramPremiumStarPrice } from './index.js';
export const premiumPackageCallbackClaimPredicate = [
    "u.update_body ? 'callback_query'",
    "AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
    "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
    "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
    "AND u.update_body #>> '{callback_query,data}' ~ '^premium_[0-9a-fA-F]{32}$'",
].join('\n');
export const premiumUsernameReplyClaimPredicate = [
    "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
    "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
    "AND u.update_body #>> '{message,from,id}'=u.update_body #>> '{message,chat,id}'",
    "AND (left(trim(COALESCE(u.update_body #>> '{message,text}','')),1)='@' OR trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^[0-9]{1,16}$')",
    "AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s WHERE s.bot_rid=u.bot_rid AND s.chat_id::text=u.update_body #>> '{message,chat,id}' AND s.user_id::text=u.update_body #>> '{message,from,id}' AND s.state='premium_purchase_username' AND s.expires_at>now())",
].join('\n');
export function isPremiumUsernameReplyCandidate(update) {
    const message = update?.message;
    const text = String(message?.text ?? '').trim();
    return message?.chat?.type === 'private' && !message?.from?.is_bot && ((text.length >= 4 && text.startsWith('@')) || /^[1-9][0-9]{0,15}$/u.test(text));
}
export async function isPremiumUsernameReplyForPrompt(pool, botRid, update) {
    const message = update?.message;
    const replyToMessageId = String(message?.reply_to_message?.message_id ?? '');
    const chatId = String(message?.chat?.id ?? ''), userId = String(message?.from?.id ?? '');
    if (message?.chat?.type !== 'private' || message?.from?.is_bot || !/^\d{1,20}$/u.test(replyToMessageId) || !/^\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId))
        return false;
    const result = await pool.query("SELECT EXISTS(SELECT 1 FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id::text=$2 AND user_id::text=$3 AND state='premium_purchase_username' AND expires_at>now() AND prompt_message_id::text=$4) AS premium", [botRid, chatId, userId, replyToMessageId]);
    return result.rows[0]?.premium === true;
}
export const premiumWalletPayClaimPredicate = [
    "u.update_body ? 'callback_query'",
    "AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
    "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
    "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
    "AND u.update_body #>> '{callback_query,data}' ~ '^tgpremiumwalletpay_[1-9][0-9]{0,9}$'",
    "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n');
export const premiumCancelUnpaidClaimPredicate = [
    "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
    "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
    "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
    "AND u.update_body #>> '{callback_query,data}'='cancelpremiumunpaid'",
    "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n');
export const premiumChooseAgainClaimPredicate = [
    "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
    "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
    "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
    "AND u.update_body #>> '{callback_query,data}'='重新选择套餐premium'",
    "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
    "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=4)",
].join('\n');
export function isPremiumCallbackUpdate(update) {
    const data = String(update?.callback_query?.data ?? '');
    return callbackPattern.test(data) || /^tgpremiumwalletpay_[1-9][0-9]{0,9}$/u.test(data) || data === 'cancelpremiumunpaid' || data === '重新选择套餐premium';
}
const usernamePattern = /^@[A-Za-z0-9_]{3,32}$/u;
const telegramIdPattern = /^[1-9][0-9]{0,15}$/u;
const callbackPattern = /^premium_[0-9a-fA-F]{32}$/u;
const telegramHeaders = { 'Content-Type': 'application/json' };
function callbackSelection(update) {
    const callback = update?.callback_query;
    const message = callback?.message;
    const chatId = String(message?.chat?.id ?? '');
    const userId = String(callback?.from?.id ?? '');
    const data = String(callback?.data ?? '');
    if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !callbackPattern.test(data))
        return null;
    return { callback, message, chatId, userId, data, callbackUsername: String(callback?.from?.username ?? '') };
}
function premiumMessage(message) {
    const chatId = String(message?.chat?.id ?? '');
    const userId = String(message?.from?.id ?? '');
    const username = String(message?.text ?? '').trim();
    const messageIdText = String(message?.message_id ?? '');
    const messageId = Number(messageIdText);
    if (message?.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || message?.from?.is_bot || !/^\d{1,20}$/u.test(messageIdText) || !Number.isSafeInteger(messageId) || messageId < 1 || (!usernamePattern.test(username) && !telegramIdPattern.test(username)))
        return null;
    return { chatId, userId, username, messageId, buyerUsername: String(message.from?.username ?? '') };
}
function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function contextObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch { /* malformed conversation state is treated as expired */ }
    }
    return {};
}
async function botTokenFor(pool, botRid) {
    const result = await pool.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [botRid]);
    return String(result.rows[0]?.bot_token ?? '');
}
async function telegram(fetcher, token, method, payload) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(token))
        return { ok: false };
    try {
        const response = await fetcher('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: telegramHeaders, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) });
        return await response.json();
    }
    catch {
        return { ok: false };
    }
}
function rsaPrivateKey() {
    const path = process.env.TRON_RSA_PRIVATE_KEY_PATH;
    const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim();
    if (!raw)
        throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE');
    return createPrivateKey(raw);
}
function decryptPlatformCookie(value) {
    if (!value)
        throw new Error('PREMIUM_PLATFORM_COOKIE_MISSING');
    const versioned = value.startsWith('v2:');
    const encoded = (versioned ? value.slice(3) : value).replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded))
        throw new Error('RSA_CIPHERTEXT_INVALID');
    const encrypted = Buffer.from(encoded, 'base64');
    const key = rsaPrivateKey();
    const bytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8;
    if (!bytes || bytes < 256 || bytes % 1 || !encrypted.length || encrypted.length % bytes)
        throw new Error('RSA_CIPHERTEXT_INVALID');
    const chunks = [];
    for (let offset = 0; offset < encrypted.length; offset += bytes)
        chunks.push(privateDecrypt(versioned
            ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
            : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)));
    return Buffer.concat(chunks).toString('utf8');
}
async function searchFragmentRecipient(fetcher, pkg, username) {
    const cookie = decryptPlatformCookie(pkg.platform_cookie);
    const url = new URL('https://fragment.com/api');
    url.searchParams.set('hash', String(pkg.platform_hash ?? ''));
    const form = new URLSearchParams({ query: username, months: String(pkg.package_month), method: 'searchPremiumGiftRecipient' });
    const response = await fetcher(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Cookie: cookie,
            Referer: 'https://fragment.com/',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new Error('FRAGMENT_INVALID_RESPONSE');
    }
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('FRAGMENT_INVALID_RESPONSE');
    const result = body;
    if (result.ok !== true)
        throw new Error(typeof result.error === 'string' ? result.error : '未知');
    const recipient = String(result.found?.recipient ?? '');
    if (!recipient || recipient.length > 1000)
        throw new Error('FRAGMENT_RECIPIENT_MISSING');
    return { recipient, displayName: String(result.found?.name ?? '未知').slice(0, 255) };
}
function packageKeyboard(packages) {
    if (!packages.length)
        return undefined;
    const rows = [[{ text: '点击 ↓ 重新选择套餐(点我查看说明)', callback_data: '重新选择套餐premium' }]];
    for (let index = 0; index < packages.length; index += 2) {
        rows.push(packages.slice(index, index + 2).map(row => ({ text: String(row.package_name).slice(0, 64), callback_data: row.callback_data })));
    }
    return { inline_keyboard: rows };
}
export async function handleTelegramPremiumPackageCallback(pool, fetcher, botRid, update) {
    const selected = callbackSelection(update);
    if (!selected)
        return false;
    const token = await botTokenFor(pool, botRid);
    if (selected.callback.id != null) {
        const answered = await telegram(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) });
        if (!answered.ok)
            throw new Error('premium_package_callback_answer_failed');
    }
    const active = await pool.query('SELECT p.rid,p.premium_platform_rid,b.platform_name,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.show_notes,p.package_pic,b.receive_wallet,b.platform_hash,b.platform_cookie FROM t_premium_platform_package p JOIN t_premium_platform b ON b.rid=p.premium_platform_rid WHERE p.bot_rid=$1 AND p.callback_data=$2 AND p.status=0 AND b.status=0 LIMIT 1', [botRid, selected.data]);
    const packageData = active.rows[0];
    const packages = await pool.query('SELECT p.package_name,p.callback_data FROM t_premium_platform_package p JOIN t_premium_platform b ON b.rid=p.premium_platform_rid WHERE p.bot_rid=$1 AND p.status=0 AND b.status=0 ORDER BY p.seq_sn DESC,p.rid DESC', [botRid]);
    const markup = packageKeyboard(packages.rows);
    let text;
    if (!packageData)
        text = '@' + escapeHtml(selected.callbackUsername) + ' <b>您好！该套餐已暂停购买，请选择其他套餐！</b>\n';
    else {
        const sessionId = randomBytes(18).toString('hex');
        const context = JSON.stringify({ packageRid: packageData.rid, sessionId });
        await pool.query("INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,context,expires_at) VALUES($1,$2,$3,'premium_purchase_username',NULL,$4::jsonb,now()+interval '15 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='premium_purchase_username',prompt_message_id=NULL,context=$4::jsonb,expires_at=now()+interval '15 minutes',updated_at=now()", [botRid, selected.chatId, selected.userId, context]);
        const starsPlatform = Number(packageData.platform_name) === 3;
        text = starsPlatform
            ? '<b>请发送要开通会员的 Telegram 用户名或用户 ID：</b>\n<b>官方 Stars 开通仅支持机器人已记录的用户；目标用户先与机器人互动后可直接发用户名。</b>\n<b>会员套餐仍需按页面显示金额支付 USDT，确认收款后机器人再使用 Stars 开通。</b>\n'
            : '<b>您好！请直接发送需要开通/续费会员的 Telegram 用户名：</b>\n<b>提示：用户名以 @ 开头，例如</b> @' + escapeHtml(selected.callbackUsername) + '\n';
        text +=
            escapeHtml(packageData.show_notes ?? '') + '\n➖➖➖➖➖➖➖➖\n' +
                '<b>🟢当前套餐：' + escapeHtml(packageData.package_name) + '</b>\n' +
                '<b>🟢开通月份：</b>' + escapeHtml(packageData.package_month) + '\n' +
                (starsPlatform ? '<b>🟢机器人扣款：</b>' + escapeHtml(telegramPremiumStarPrice(packageData.package_month) ?? '月份无效') + ' Stars\n➖➖➖➖➖➖➖➖\n⚠️<b>需要机器人账户有足够 Stars。</b>' : '➖➖➖➖➖➖➖➖\n⚠️<b>请在下单后核对支付地址与金额，填写错误无法追回。</b>');
    }
    if (!packages.rows.length)
        text += '😭😭😭<b>暂无可用会员套餐，请联系管理员！</b>';
    const photo = packageData?.package_pic?.trim() ?? '';
    let sent;
    if (photo && /^https:\/\//iu.test(photo) && text.length <= 1024) {
        try {
            const url = new URL(photo);
            if (url.username || url.password)
                throw new Error('unsafe_photo_url');
            sent = await telegram(fetcher, token, 'sendPhoto', { chat_id: selected.chatId, photo: url.toString(), caption: text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(markup ? { reply_markup: markup } : {}) });
        }
        catch {
            sent = await telegram(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(markup ? { reply_markup: markup } : {}) });
        }
    }
    else
        sent = await telegram(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(markup ? { reply_markup: markup } : {}) });
    if (!sent.ok)
        throw new Error('premium_package_selection_reply_failed');
    if (packageData && sent.result?.message_id != null) {
        await pool.query("UPDATE t_platform_telegram_conversation_state SET prompt_message_id=$4,updated_at=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='premium_purchase_username'", [botRid, selected.chatId, selected.userId, String(sent.result.message_id)]);
    }
    return true;
}
function parsePriceUnits(value) {
    const match = /^(\d{1,8})(?:\.(\d{1,4}))?$/u.exec(value.trim());
    if (!match)
        return null;
    return BigInt(match[1]) * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}
function priceText(units) {
    return (units / 10000n).toString() + '.' + (units % 10000n).toString().padStart(4, '0');
}
async function sendText(fetcher, token, chatId, text, messageId, replyMarkup) {
    const result = await telegram(fetcher, token, 'sendMessage', {
        chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true,
        ...(messageId ? { reply_to_message_id: messageId } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!result.ok)
        throw new Error('premium_purchase_reply_failed');
}
function purchaseReceipt(purchase, replyMessageId) {
    const stars = purchase.fulfillment_method === 'telegram_stars';
    const keyboard = { inline_keyboard: [
            [{ text: '余额支付', callback_data: 'tgpremiumwalletpay_' + purchase.order_rid }],
            [{ text: '我要充值', callback_data: 'aitrusteeshiprechargetrx' }],
        ] };
    const text = '<b>下单成功，请核对金额和地址支付</b>\n' +
        '开通用户：' + escapeHtml(purchase.premium_tg_username) + '\n' +
        '用户昵称：' + escapeHtml(purchase.premium_name) + '\n' +
        '订单号：' + purchase.order_rid + '\n➖➖➖➖➖➖➖➖\n' +
        '<b>🟢当前套餐：' + escapeHtml(purchase.package_name) + '</b>\n' +
        '<b>🟢开通月份：</b>' + escapeHtml(purchase.premium_package_month) + '\n' +
        '<b>🟢支付金额：</b><code>' + escapeHtml(purchase.need_pay_usdt) + '</code> <b>USDT</b> (点击金额复制)\n' +
        '<b>🟢支付地址：</b><code>' + escapeHtml(purchase.receive_wallet) + '</code>\n' +
        (stars ? '<b>🟢开通方式：</b>Telegram Stars（机器人将消耗 <code>' + escapeHtml(purchase.need_pay_stars) + '</code> Stars）\n' : '') +
        '<b>🟢失效时间：' + escapeHtml(purchase.expire_time) + '</b>\n➖➖➖➖➖➖➖➖\n' +
        '⚠️<b>请在订单失效时间支付，订单过期后请重新发起！</b>\n' +
        '⚠️<b>点击地址和金额复制，金额或者地址错误将无法追回！</b>\n' +
        '⏬<b>点击余额支付，可直接使用充值的 USDT 余额支付</b>\n' +
        (stars ? 'Bot 将在 USDT 收款确认后使用 Telegram Stars 官方接口开通。\n' : '') +
        '当前时间：' + escapeHtml(purchase.created_at);
    return { chatId: purchase.chat_id, messageId: replyMessageId, text, markup: keyboard };
}
async function notifyPurchase(pool, fetcher, token, purchase, replyMessageId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT update_rid,bot_rid,chat_id,premium_tg_username,premium_name,order_rid,package_name,premium_package_month,fulfillment_method,need_pay_usdt::text AS need_pay_usdt,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id,receive_wallet,to_char(created_at,\'YYYY-MM-DD HH24:MI:SS\') AS created_at,to_char(expire_time,\'YYYY-MM-DD HH24:MI:SS\') AS expire_time,notification_sent_at IS NOT NULL AS notification_sent FROM t_platform_telegram_premium_purchase WHERE update_rid=$1 AND bot_rid=$2 AND chat_id=$3 FOR UPDATE', [purchase.update_rid, purchase.bot_rid, purchase.chat_id]);
        const row = current.rows[0];
        if (!row || row.notification_sent) {
            await client.query('COMMIT');
            return;
        }
        const receipt = purchaseReceipt(row, replyMessageId);
        const sent = await telegram(fetcher, token, 'sendMessage', { chat_id: receipt.chatId, text: receipt.text, reply_to_message_id: receipt.messageId, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: receipt.markup });
        if (!sent.ok)
            throw new Error('premium_purchase_receipt_delivery_failed');
        await client.query('UPDATE t_platform_telegram_premium_purchase SET notification_sent_at=now() WHERE update_rid=$1 AND bot_rid=$2 AND chat_id=$3 AND notification_sent_at IS NULL', [purchase.update_rid, purchase.bot_rid, purchase.chat_id]);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
async function existingPurchase(pool, updateRid, botRid, chatId) {
    const result = await pool.query('SELECT update_rid,bot_rid,chat_id,premium_tg_username,premium_name,order_rid,package_name,premium_package_month,fulfillment_method,need_pay_usdt::text AS need_pay_usdt,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id,receive_wallet,to_char(created_at,\'YYYY-MM-DD HH24:MI:SS\') AS created_at,to_char(expire_time,\'YYYY-MM-DD HH24:MI:SS\') AS expire_time,notification_sent_at IS NOT NULL AS notification_sent FROM t_platform_telegram_premium_purchase WHERE update_rid=$1 AND bot_rid=$2 AND chat_id=$3 LIMIT 1', [updateRid, botRid, chatId]);
    return result.rows[0];
}
async function resolveTelegramStarsRecipient(pool, botRid, value) {
    let userId = '';
    let label = '';
    let name = '';
    if (telegramIdPattern.test(value)) {
        const parsed = BigInt(value);
        if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER))
            return null;
        userId = parsed.toString();
        const found = await pool.query('SELECT tg_username,tg_nickname FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 AND status=1 LIMIT 1', [botRid, userId]);
        const knownUsername = String(found.rows[0]?.tg_username ?? '').replace(/^@/, '').trim();
        label = knownUsername ? '@' + knownUsername : 'TGID ' + userId;
        name = String(found.rows[0]?.tg_nickname ?? label);
    }
    else if (usernamePattern.test(value)) {
        const lookup = await pool.query("SELECT tg_uid::text,tg_username,tg_nickname FROM t_telegram_bot_user WHERE bot_rid=$1 AND status=1 AND lower(trim(tg_username,'@'))=lower($2) ORDER BY last_time DESC NULLS LAST LIMIT 2", [botRid, value.slice(1)]);
        if (lookup.rows.length !== 1)
            return null;
        const parsed = BigInt(lookup.rows[0].tg_uid);
        if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER))
            return null;
        userId = parsed.toString();
        label = '@' + String(lookup.rows[0].tg_username ?? value).replace(/^@/, '');
        name = String(lookup.rows[0].tg_nickname ?? label);
    }
    else
        return null;
    return { userId, label, name };
}
function uniqueRandomPrice(base) {
    const offsets = Array.from({ length: 101 }, (_, index) => index + 100);
    for (let index = offsets.length - 1; index > 0; index--) {
        const swap = randomInt(index + 1);
        [offsets[index], offsets[swap]] = [offsets[swap], offsets[index]];
    }
    return offsets.map(offset => priceText(base + BigInt(offset)));
}
export async function handleTelegramPremiumUsernameReply(pool, fetcher, botRid, updateRid, message) {
    const selected = premiumMessage(message);
    if (!selected)
        return false;
    const token = await botTokenFor(pool, botRid);
    const savedPurchase = await existingPurchase(pool, updateRid, botRid, selected.chatId);
    if (savedPurchase) {
        await notifyPurchase(pool, fetcher, token, savedPurchase, selected.messageId);
        return true;
    }
    const stateResult = await pool.query("SELECT context FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='premium_purchase_username' AND expires_at>now() LIMIT 1", [botRid, selected.chatId, selected.userId]);
    const state = stateResult.rows[0];
    if (!state) {
        await sendText(fetcher, token, selected.chatId, '套餐选择会话已过期，请重新选择会员套餐。', selected.messageId);
        return true;
    }
    const context = contextObject(state.context);
    const packageRid = Number(context.packageRid);
    const sessionId = String(context.sessionId ?? '');
    if (!Number.isSafeInteger(packageRid) || packageRid <= 0 || !sessionId) {
        await sendText(fetcher, token, selected.chatId, '套餐会话无效，请重新选择会员套餐。', selected.messageId);
        return true;
    }
    const pending = await pool.query('SELECT rid FROM t_premium_platform_order WHERE bot_rid=$1 AND status IN (0,1) AND buy_tg_uid=$2 ORDER BY rid DESC LIMIT 1', [botRid, selected.chatId]);
    if (pending.rows[0]) {
        await sendText(fetcher, token, selected.chatId, '您还有未完成的会员订单，暂时无法继续提交。若需重新提交，请先取消未完成的订单。', selected.messageId, { inline_keyboard: [[{ text: '取消未完成的订单', callback_data: 'cancelpremiumunpaid' }]] });
        return true;
    }
    const packageResult = await pool.query('SELECT p.rid,p.premium_platform_rid,b.platform_name,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.show_notes,p.package_pic,b.receive_wallet,b.platform_hash,b.platform_cookie FROM t_premium_platform_package p JOIN t_premium_platform b ON b.rid=p.premium_platform_rid WHERE p.rid=$1 AND p.bot_rid=$2 AND p.status=0 AND b.status=0 LIMIT 1', [packageRid, botRid]);
    const packageData = packageResult.rows[0];
    if (!packageData) {
        await sendText(fetcher, token, selected.chatId, '该会员套餐已暂停购买，请重新选择其他套餐。', selected.messageId);
        return true;
    }
    const starsMode = Number(packageData.platform_name) === 3;
    let fragment = null;
    let targetUserId = null;
    let targetLabel = selected.username;
    let premiumName = '';
    let starCount = 0;
    const basePrice = parsePriceUnits(packageData.usdt_price);
    if (basePrice === null || basePrice <= 0n || basePrice + 200n > 999999999999n) {
        await sendText(fetcher, token, selected.chatId, '当前会员套餐价格配置无效，请联系管理员。', selected.messageId);
        return true;
    }
    if (!packageData.receive_wallet) {
        await sendText(fetcher, token, selected.chatId, '会员平台尚未配置 USDT 收款钱包，暂时无法创建订单，请联系管理员。', selected.messageId);
        return true;
    }
    if (starsMode) {
        const target = await resolveTelegramStarsRecipient(pool, botRid, selected.username);
        if (!target) {
            await sendText(fetcher, token, selected.chatId, '机器人尚未记录该用户名对应的 Telegram ID。请让目标用户先与机器人互动后重试，或直接发送其 Telegram 数字 ID。', selected.messageId);
            return true;
        }
        targetUserId = target.userId;
        targetLabel = target.label;
        premiumName = target.name;
        starCount = telegramPremiumStarPrice(packageData.package_month) ?? 0;
        if (!starCount) {
            await sendText(fetcher, token, selected.chatId, 'Telegram Stars 会员套餐月份无效，请联系管理员。', selected.messageId);
            return true;
        }
    }
    else {
        if (!usernamePattern.test(selected.username)) {
            await sendText(fetcher, token, selected.chatId, '用户名格式不正确，请输入以 @ 开头的 Telegram 用户名，例如 @username。', selected.messageId);
            return true;
        }
        if (!packageData.platform_hash || !packageData.platform_cookie) {
            await sendText(fetcher, token, selected.chatId, 'Fragment 平台配置不完整，暂时无法创建订单，请联系管理员。', selected.messageId);
            return true;
        }
        try {
            fragment = await searchFragmentRecipient(fetcher, packageData, selected.username);
            premiumName = fragment.displayName;
        }
        catch (error) {
            const reason = error instanceof Error && error.message !== 'RSA_PRIVATE_KEY_UNAVAILABLE' && error.message !== 'PREMIUM_PLATFORM_COOKIE_MISSING' && error.message !== 'RSA_CIPHERTEXT_INVALID'
                ? escapeHtml(error.message.replace(/[\u0000-\u001f<>]/gu, ' ').slice(0, 180)) : '平台暂时无法验证该用户';
            await sendText(fetcher, token, selected.chatId, '获取用户信息失败，请检查用户名是否正确，例如 @username。\n错误信息：' + reason, selected.messageId);
            return true;
        }
    }
    const client = await pool.connect();
    let purchase;
    let hasPendingOrder = false;
    let sessionChanged = false;
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-premium-buyer:' || $1 || ':' || $2,0))", [botRid, selected.chatId]);
        const duplicate = await client.query('SELECT update_rid,bot_rid,chat_id,premium_tg_username,premium_name,order_rid,package_name,premium_package_month,fulfillment_method,need_pay_usdt::text AS need_pay_usdt,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id,receive_wallet,to_char(created_at,\'YYYY-MM-DD HH24:MI:SS\') AS created_at,to_char(expire_time,\'YYYY-MM-DD HH24:MI:SS\') AS expire_time,notification_sent_at IS NOT NULL AS notification_sent FROM t_platform_telegram_premium_purchase WHERE update_rid=$1 AND bot_rid=$2 AND chat_id=$3 FOR UPDATE', [updateRid, botRid, selected.chatId]);
        if (duplicate.rows[0])
            purchase = duplicate.rows[0];
        else {
            const currentState = await client.query("SELECT context FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='premium_purchase_username' AND expires_at>now() FOR UPDATE", [botRid, selected.chatId, selected.userId]);
            const currentContext = contextObject(currentState.rows[0]?.context);
            if (String(currentContext.sessionId ?? '') !== sessionId || Number(currentContext.packageRid) !== packageRid)
                sessionChanged = true;
            else {
                const existingOrder = await client.query('SELECT rid FROM t_premium_platform_order WHERE bot_rid=$1 AND status IN (0,1) AND buy_tg_uid=$2 ORDER BY rid DESC LIMIT 1 FOR UPDATE', [botRid, selected.chatId]);
                if (existingOrder.rows[0])
                    hasPendingOrder = true;
                else {
                    if (basePrice === null)
                        throw new Error('PREMIUM_PRICE_MISSING');
                    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-premium-order-price',0))");
                    let amount = '';
                    for (const candidate of uniqueRandomPrice(basePrice)) {
                        const occupied = await client.query('SELECT 1 FROM t_premium_platform_order WHERE status IN (0,1) AND need_pay_usdt=$1::numeric LIMIT 1', [candidate]);
                        if (!occupied.rows.length) {
                            amount = candidate;
                            break;
                        }
                    }
                    if (!amount)
                        throw new Error('PREMIUM_RANDOM_PRICE_EXHAUSTED');
                    const inserted = await client.query('INSERT INTO t_premium_platform_order(bot_rid,premium_platform_rid,source_type,buy_tg_uid,buy_tg_username,premium_tg_username,need_pay_usdt,status,premium_platform_package_rid,premium_package_month,create_time,expire_time,recipient,fulfillment_method,need_pay_stars,premium_tg_user_id) VALUES($1,$2,2,$3,$4,$5,$6::numeric,0,$7,$8,now(),now()+interval \'15 minutes\',$9,$10,$11,$12) RETURNING rid,to_char(expire_time,\'YYYY-MM-DD HH24:MI:SS\') AS expire_time', [botRid, packageData.premium_platform_rid, selected.chatId, selected.buyerUsername || null, targetLabel, amount, packageRid, packageData.package_month, fragment?.recipient ?? null, starsMode ? 'telegram_stars' : 'fragment_ton', starCount, targetUserId]);
                    const order = inserted.rows[0];
                    if (!order)
                        throw new Error('PREMIUM_ORDER_INSERT_FAILED');
                    const purchaseName = starsMode ? premiumName : fragment.displayName;
                    const saved = await client.query("INSERT INTO t_platform_telegram_premium_purchase(update_rid,bot_rid,chat_id,premium_tg_username,premium_name,order_rid,package_name,premium_package_month,need_pay_usdt,receive_wallet,expire_time,fulfillment_method,need_pay_stars,premium_tg_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::timestamp,$12,$13,$14) RETURNING update_rid,bot_rid,chat_id,premium_tg_username,premium_name,order_rid,package_name,premium_package_month,fulfillment_method,need_pay_usdt::text AS need_pay_usdt,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id,receive_wallet,to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(expire_time,'YYYY-MM-DD HH24:MI:SS') AS expire_time,false AS notification_sent", [updateRid, botRid, selected.chatId, targetLabel, purchaseName, order.rid, packageData.package_name, packageData.package_month, amount, packageData.receive_wallet, order.expire_time, starsMode ? 'telegram_stars' : 'fragment_ton', starCount, targetUserId]);
                    purchase = saved.rows[0];
                    if (!purchase)
                        throw new Error('PREMIUM_PURCHASE_IDEMPOTENCY_INSERT_FAILED');
                    await client.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='premium_purchase_username' AND context->>'sessionId'=$4", [botRid, selected.chatId, selected.userId, sessionId]);
                }
            }
        }
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
    if (sessionChanged) {
        await sendText(fetcher, token, selected.chatId, '套餐选择已更新，请重新选择套餐后再发送用户名。', selected.messageId);
        return true;
    }
    if (hasPendingOrder) {
        await sendText(fetcher, token, selected.chatId, '您还有未完成的会员订单，暂时无法继续提交。若需重新提交，请先取消未完成的订单。', selected.messageId, { inline_keyboard: [[{ text: '取消未完成的订单', callback_data: 'cancelpremiumunpaid' }]] });
        return true;
    }
    if (!purchase)
        throw new Error('PREMIUM_PURCHASE_STATE_INVALID');
    await notifyPurchase(pool, fetcher, token, purchase, selected.messageId);
    return true;
}
function verifiedCallback(update, pattern, allowedChats = ['private']) {
    const callback = update?.callback_query, message = callback?.message;
    const chatId = String(message?.chat?.id ?? ''), userId = String(callback?.from?.id ?? ''), data = String(callback?.data ?? '');
    const keyboard = message?.reply_markup?.inline_keyboard;
    if (!message || !allowedChats.includes(String(message.chat?.type)) || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat?.type === 'private' && chatId !== userId) || callback?.from?.is_bot || !pattern.test(data))
        return null;
    if (!Array.isArray(keyboard) || !keyboard.some((row) => Array.isArray(row) && row.some((button) => button?.callback_data === data)))
        return null;
    return { callback, message, chatId, data };
}
async function botToken(pool, botRid) {
    const result = await pool.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [botRid]);
    const token = result.rows[0]?.bot_token;
    if (!token)
        throw new Error('PREMIUM_BOT_MISSING');
    return token;
}
async function answerPremiumCallback(fetcher, token, method, payload) {
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(token))
        return { ok: false };
    try {
        const response = await fetcher('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: telegramHeaders, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) });
        return await response.json();
    }
    catch {
        return { ok: false };
    }
}
function decimalAmount(value) {
    const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d+))?$/u);
    if (!match)
        return null;
    const fraction = match[2] ?? '';
    return { units: BigInt(match[1]) * 10n ** BigInt(fraction.length) + BigInt(fraction || '0'), scale: fraction.length };
}
export async function handlePremiumWalletPayCallback(pool, fetcher, botRid, update) {
    const selected = verifiedCallback(update, /^tgpremiumwalletpay_([1-9][0-9]{0,9})$/u);
    if (!selected)
        return false;
    const orderRid = Number(/^tgpremiumwalletpay_(\d+)$/u.exec(selected.data)?.[1]);
    const token = await botToken(pool, botRid);
    if (selected.callback.id != null)
        await answerPremiumCallback(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) });
    const client = await pool.connect();
    let outcome = 'not_pending', username = '', months = '';
    try {
        await client.query('BEGIN');
        const order = await client.query('SELECT need_pay_usdt::text,premium_tg_username,premium_package_month FROM t_premium_platform_order WHERE rid=$1 AND bot_rid=$2 AND buy_tg_uid=$3 AND status=0 FOR UPDATE', [orderRid, botRid, selected.chatId]);
        if (order.rows[0]) {
            const amountText = String(order.rows[0].need_pay_usdt ?? ''), amount = decimalAmount(amountText);
            if (amount && amount.units > 0n && /^\d{1,20}(?:\.\d{1,6})?$/u.test(amountText)) {
                const user = await client.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, selected.chatId]);
                if (!user.rows[0])
                    outcome = 'insufficient';
                else {
                    const debit = await client.query('UPDATE t_telegram_bot_user SET cash_usdt=cash_usdt-$3::numeric WHERE rid=$1 AND bot_rid=$2 AND cash_usdt >= $3::numeric RETURNING cash_usdt::text', [user.rows[0].rid, botRid, amountText]);
                    if (!debit.rowCount)
                        outcome = 'insufficient';
                    else {
                        const paid = await client.query('UPDATE t_premium_platform_order SET status=1,update_time=now() WHERE rid=$1 AND bot_rid=$2 AND buy_tg_uid=$3 AND status=0 RETURNING rid', [orderRid, botRid, selected.chatId]);
                        if (!paid.rowCount)
                            throw new Error('PREMIUM_WALLET_ORDER_STATE_CONFLICT');
                        username = String(order.rows[0].premium_tg_username ?? '');
                        months = String(order.rows[0].premium_package_month ?? '');
                        outcome = 'paid';
                    }
                }
            }
        }
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
    const result = outcome === 'paid'
        ? await answerPremiumCallback(fetcher, token, 'editMessageText', { chat_id: selected.chatId, message_id: selected.message.message_id, text: `会员订单支付成功，开通中···\n开通用户：${escapeHtml(username)}\n开通时间：${escapeHtml(months)}`, parse_mode: 'HTML', allow_sending_without_reply: true })
        : await answerPremiumCallback(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: outcome === 'insufficient' ? '用户USDT余额不足' : '订单不存在或者不是待支付状态', reply_to_message_id: selected.message.message_id, parse_mode: 'Markdown', allow_sending_without_reply: true });
    if (!result.ok)
        throw new Error(outcome === 'paid' ? 'PREMIUM_WALLET_PAY_SUCCESS_MESSAGE_FAILED' : 'PREMIUM_WALLET_PAY_RESULT_MESSAGE_FAILED');
    return true;
}
export async function handlePremiumCancelUnpaidCallback(pool, fetcher, botRid, update) {
    const selected = verifiedCallback(update, /^cancelpremiumunpaid$/u);
    if (!selected)
        return false;
    const token = await botToken(pool, botRid);
    if (selected.callback.id != null)
        await answerPremiumCallback(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-premium-cancel:' || $1 || ':' || $2,0))", [botRid, selected.chatId]);
        await client.query('UPDATE t_premium_platform_order SET status=4,cancel_time=now() WHERE bot_rid=$1 AND status=0 AND buy_tg_uid=$2', [botRid, selected.chatId]);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
    const sent = await answerPremiumCallback(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '您的未完成会员订单已取消，可重新发起购买会员！', parse_mode: 'Markdown', allow_sending_without_reply: true });
    if (!sent.ok)
        throw new Error('PREMIUM_CANCEL_UNPAID_REPLY_FAILED');
    return true;
}
export async function handlePremiumChooseAgainCallback(pool, fetcher, botRid, update) {
    const selected = verifiedCallback(update, /^重新选择套餐premium$/u, ['private', 'group', 'supergroup']);
    if (!selected)
        return false;
    const token = await botToken(pool, botRid);
    const sent = await answerPremiumCallback(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id ?? ''), text: '开通 Telegram 会员前，请仔细核对收款地址、支付金额和开通账号。', show_alert: true });
    if (!sent.ok)
        throw new Error('PREMIUM_CHOOSE_AGAIN_ALERT_FAILED');
    return true;
}
export async function handlePremiumTelegramCallback(pool, fetcher, botRid, update) {
    if (await handleTelegramPremiumPackageCallback(pool, fetcher, botRid, update))
        return true;
    if (await handlePremiumWalletPayCallback(pool, fetcher, botRid, update))
        return true;
    if (await handlePremiumCancelUnpaidCallback(pool, fetcher, botRid, update))
        return true;
    return handlePremiumChooseAgainCallback(pool, fetcher, botRid, update);
}
