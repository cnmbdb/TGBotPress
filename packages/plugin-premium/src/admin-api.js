import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { priceUnits, telegramPremiumStarPrice } from './index.js';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const statusLabels = { 0: '待支付', 1: '待开通', 2: '已开通', 3: '已过期', 4: '会员取消', 5: '开通失败', 6: '开通中' };
const sourceLabels = { 1: '人工下单', 2: '自动下单' };
const idSchema = z.coerce.number().int().positive().max(2_147_483_647);
export function createPremiumOrderApi(host) {
    const { db, identity, can, run } = host;
    return function premiumOrderApi(request) {
        return run(async () => {
            if (request.method !== 'GET')
                return Response.json({ message: '请求方法不支持' }, { status: 405, headers });
            const user = await identity(request), route = 'admin.premium.order.index';
            if (!can(user, '会员管理', route) || !can(user, '会员订单', route))
                return Response.json({ message: '没有访问权限' }, { status: 403, headers });
            const url = new URL(request.url);
            if (url.searchParams.get('action') === 'options') {
                const bots = await db.query('SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC');
                return Response.json({ bots: bots.rows }, { headers });
            }
            const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), username: z.string().trim().max(100).default(''), botRid: z.union([z.literal('all'), z.coerce.number().int().positive()]).default('all') }).parse(Object.fromEntries(url.searchParams));
            const username = '%' + input.username.replace(/[!%_]/g, char => '!' + char) + '%', botRid = input.botRid === 'all' ? null : input.botRid;
            const where = "($1='%%' OR a.premium_tg_username ILIKE $1 ESCAPE '!') AND ($2::int IS NULL OR a.bot_rid=$2)";
            const total = await db.query(`SELECT count(*)::int AS total FROM t_premium_platform_order a WHERE ${where}`, [username, botRid]);
            const result = await db.query(`SELECT a.rid,a.bot_rid,a.premium_platform_rid,a.buy_tg_uid,a.buy_tg_username,a.premium_tg_username,a.premium_tg_user_id::text AS premium_tg_user_id,a.payment_method,a.need_pay_usdt::text AS need_pay_usdt,a.need_pay_stars,a.premium_package_month,a.status,a.create_time,a.expire_time,a.cancel_time,a.complete_time,a.source_type,a.comments,b.bot_username FROM t_premium_platform_order a LEFT JOIN t_telegram_bot b ON a.bot_rid=b.rid WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [username, botRid, input.pageSize, (input.page - 1) * input.pageSize]);
            const rows = result.rows.map(row => ({ ...row, status_label: statusLabels[Number(row.status)] || `未知状态 (${row.status})`, source_type_label: sourceLabels[Number(row.source_type)] || `未知来源 (${row.source_type})` }));
            return Response.json({ rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize }, { headers });
        });
    };
}
export function createPremiumTradeApi(host) {
    const { db, identity, can, run, telegramActionsEnabled } = host;
    return function premiumTradeApi(request) {
        return run(async () => {
            const user = await identity(request), route = 'admin.premium.trade.index';
            if (!can(user, '会员管理', route) || !can(user, '会员交易', route))
                return Response.json({ message: '没有访问权限' }, { status: 403, headers });
            if (request.method === 'GET') {
                const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), tx_hash: z.string().trim().max(100).default(''), transferfrom_address: z.string().trim().max(200).default(''), transferto_address: z.string().trim().max(200).default('') }).parse(Object.fromEntries(new URL(request.url).searchParams));
                const values = [`%${input.tx_hash.replace(/[!%_]/g, c => '!' + c)}%`, `%${input.transferfrom_address.replace(/[!%_]/g, c => '!' + c)}%`, `%${input.transferto_address.replace(/[!%_]/g, c => '!' + c)}%`];
                const where = "($1='%%' OR tx_hash ILIKE $1 ESCAPE '!') AND ($2='%%' OR transferfrom_address ILIKE $2 ESCAPE '!') AND ($3='%%' OR transferto_address ILIKE $3 ESCAPE '!')";
                const total = await db.query(`SELECT count(*)::int AS total FROM t_premium_wallet_trade_list WHERE ${where}`, values);
                const result = await db.query(`SELECT rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,CASE WHEN "timestamp" ~ '^[0-9]+$' THEN to_char(to_timestamp(("timestamp"::numeric/1000)::double precision) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') ELSE "timestamp" END AS transaction_time,process_status,to_char(process_time,'YYYY-MM-DD HH24:MI:SS') AS process_time,process_comments,to_char(get_time,'YYYY-MM-DD HH24:MI:SS') AS get_time FROM t_premium_wallet_trade_list WHERE ${where} ORDER BY rid DESC LIMIT $4 OFFSET $5`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
                const statusLabels = { 6: '会员平台未启用', 7: '金额无对应订单', 8: '下单中', 9: '下单成功', 1: '待下单', 5: '会员平台未配置正确', 4: '下单失败', 2: '人工禁止' };
                return Response.json({ rows: result.rows.map(row => ({ ...row, process_status_label: statusLabels[Number(row.process_status)] || `未知状态 (${row.process_status})`, can_reissue: [4, 5, 6, 7].includes(Number(row.process_status)), can_stop: [1, 4, 5, 6, 7].includes(Number(row.process_status)) })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canReissue: can(user, '会员补发', 'admin.premium.trade.reorder'), canStop: can(user, '禁止开通', 'admin.premium.trade.stoporder'), telegramEnabled: telegramActionsEnabled() }, { headers });
            }
            if (request.method !== 'POST')
                return Response.json({ message: '请求方法不支持' }, { status: 405, headers });
            const origin = host.platformOrigin();
            const expectedOrigin = origin ? new URL(origin).origin : '';
            if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin)
                return Response.json({ message: '请求来源无效' }, { status: 403, headers });
            if (request.headers.get('content-type')?.includes('application/json') !== true)
                return Response.json({ message: '请求格式无效' }, { status: 415, headers });
            let body;
            try {
                body = await request.json();
            }
            catch {
                return Response.json({ message: '请求内容无效' }, { status: 400, headers });
            }
            const input = z.object({ action: z.enum(['reissue', 'stop']), rid: idSchema }).strict().parse(body);
            const permission = input.action === 'reissue' ? '会员补发' : '禁止开通', permissionRoute = input.action === 'reissue' ? 'admin.premium.trade.reorder' : 'admin.premium.trade.stoporder';
            if (!can(user, permission, permissionRoute))
                return Response.json({ message: '没有操作权限' }, { status: 403, headers });
            if (input.action === 'reissue' && !telegramActionsEnabled())
                return Response.json({ message: '当前开发环境未启用外部机器人操作' }, { status: 409, headers });
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                const current = await client.query('SELECT process_status FROM t_premium_wallet_trade_list WHERE rid=$1 FOR UPDATE', [input.rid]);
                if (!current.rowCount) {
                    await client.query('ROLLBACK');
                    return Response.json({ message: '交易数据不存在' }, { status: 404, headers });
                }
                const state = Number(current.rows[0].process_status), allowed = input.action === 'reissue' ? [4, 5, 6, 7] : [1, 4, 5, 6, 7];
                if (!allowed.includes(state)) {
                    await client.query('ROLLBACK');
                    return Response.json({ message: input.action === 'reissue' ? '该状态禁止补发' : '该状态不能禁止' }, { status: 409, headers });
                }
                if (input.action === 'reissue')
                    await client.query("UPDATE t_premium_wallet_trade_list SET process_status=1,tg_notice_status_send='N' WHERE rid=$1", [input.rid]);
                else
                    await client.query("UPDATE t_premium_wallet_trade_list SET process_status=2,tg_notice_status_send='Y',process_comments='人工禁止兑换' WHERE rid=$1", [input.rid]);
                await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, input.action === 'reissue' ? 'premium.trade.reissue' : 'premium.trade.stop', input.rid]);
                await client.query('COMMIT');
                return Response.json({ ok: true, message: input.action === 'reissue' ? '补发任务已提交' : '已禁止兑换' }, { headers });
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
        });
    };
}
export function createPremiumPlatformApi(host) {
    const { db, identity, can, run } = host;
    const base = 'admin.premium.platform', id = z.coerce.number().int().positive().max(2_147_483_647);
    const permissions = { create: ['添加会员平台', 'add'], update: ['修改会员平台', 'update'], delete: ['删除会员平台', 'delete'], status: ['修改会员平台', 'change_status'], cookie: ['修改cookie', 'updateapikey'], phrase: ['修改助记词', 'updatephrase'] };
    return function premiumPlatformApi(request) {
        return run(async () => {
            const user = await identity(request), url = new URL(request.url);
            const allowed = (action) => can(user, permissions[action][0], base + '.' + permissions[action][1]);
            if (!can(user, '会员管理', base + '.index') || !can(user, '会员平台', base + '.index'))
                return Response.json({ message: '没有访问权限' }, { status: 403, headers });
            if (request.method === 'GET') {
                if (url.searchParams.get('action') === 'options') {
                    const result = await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC');
                    return Response.json({ bots: result.rows }, { headers });
                }
                if (url.searchParams.get('action') === 'starsBalance') {
                    const botRid = id.parse(url.searchParams.get('botRid'));
                    const bot = await db.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [botRid]);
                    const token = bot.rows[0]?.bot_token;
                    if (!token)
                        return Response.json({ message: '机器人不存在或尚未配置 Token' }, { status: 404, headers });
                    try {
                        const response = await fetch(`https://api.telegram.org/bot${token}/getMyStarBalance`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
                        const body = await response.json().catch(() => null);
                        const amount = body?.result?.amount;
                        if (!response.ok || body?.ok !== true || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)
                            throw new Error('telegram_stars_balance_unavailable');
                        return Response.json({ stars: amount }, { headers });
                    }
                    catch {
                        return Response.json({ message: '查询 Telegram Stars 余额失败，请检查机器人 Token 和网络' }, { status: 502, headers });
                    }
                }
                const input = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), search: z.string().trim().max(100).default('') }).parse(Object.fromEntries(url.searchParams));
                const search = '%' + input.search.replace(/[!%_]/g, c => '!' + c) + '%';
                const where = "($1='%%' OR COALESCE(p.platform_hash,'') ILIKE $1 ESCAPE '!' OR COALESCE(p.tg_admin_uid,'') ILIKE $1 ESCAPE '!' OR COALESCE(p.comments,'') ILIKE $1 ESCAPE '!')";
                const [total, result] = await Promise.all([
                    db.query(`SELECT count(*)::int AS total FROM t_premium_platform p WHERE ${where}`, [search]),
                    db.query(`SELECT p.rid,p.bot_rid,b.bot_firstname,b.bot_username,p.platform_name,p.tg_admin_uid,p.platform_hash,(COALESCE(p.platform_cookie,'')<>'') cookie_configured,(COALESCE(p.platform_phrase,'')<>'') phrase_configured,p.status,p.receive_wallet,to_char(p.get_tx_time,'YYYY-MM-DD HH24:MI:SS') get_tx_time,p.tg_notice_obj_receive,p.tg_notice_obj_send,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') create_time FROM t_premium_platform p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid WHERE ${where} ORDER BY p.rid DESC LIMIT $2 OFFSET $3`, [search, input.pageSize, (input.page - 1) * input.pageSize]),
                ]);
                return Response.json({ rows: result.rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canAdd: allowed('create'), canEdit: allowed('update'), canDelete: allowed('delete'), canStatus: allowed('status'), canCookie: allowed('cookie'), canPhrase: allowed('phrase') }, { headers });
            }
            if (request.method !== 'POST')
                return Response.json({ message: '请求方法不支持' }, { status: 405, headers });
            const expectedOrigin = host.platformOrigin() ? new URL(host.platformOrigin()).origin : '';
            if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin || !request.headers.get('content-type')?.startsWith('application/json'))
                return Response.json({ message: '请求来源无效' }, { status: 403, headers });
            if (Number(request.headers.get('content-length') || 0) > 32_768)
                return Response.json({ message: '表单内容过长' }, { status: 413, headers });
            const raw = await request.text();
            if (raw.length > 32_768)
                return Response.json({ message: '表单内容过长' }, { status: 413, headers });
            let body;
            try {
                body = JSON.parse(raw);
            }
            catch {
                return Response.json({ message: '表单内容无效' }, { status: 400, headers });
            }
            const action = z.object({ action: z.enum(['create', 'update', 'delete', 'status', 'cookie', 'phrase']) }).parse(body).action;
            if (!allowed(action))
                return Response.json({ message: '没有操作权限' }, { status: 403, headers });
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                let rid, message = '';
                if (action === 'create' || action === 'update') {
                    const schema = z.object({ action: z.enum(['create', 'update']), ...(action === 'update' ? { rid: id } : {}), bot_rid: id, platform_name: z.union([z.literal(1), z.literal(2), z.literal(3)]), tg_admin_uid: z.string().trim().max(500).default(''), platform_hash: z.string().trim().max(500).default(''), ...(action === 'create' ? { platform_cookie: z.string().trim().max(2500).default('') } : {}), tg_notice_obj_receive: z.string().trim().max(200).default(''), tg_notice_obj_send: z.string().trim().max(200).default(''), receive_wallet: z.string().trim().max(100).default(''), get_tx_time: z.string().trim().max(40).default(''), comments: z.string().trim().max(255).default('') }).strict();
                    const input = schema.parse(body);
                    if (!(await client.query('SELECT 1 FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])).rowCount) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: '机器人不存在' }, { status: 400, headers });
                    }
                    if (input.platform_name === 3 && action === 'create' && input.platform_cookie) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: 'Telegram Stars 平台不需要 Fragment Cookie' }, { status: 400, headers });
                    }
                    if (input.platform_name === 3 && !input.receive_wallet) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: 'Stars 履约仍需配置 USDT 收款钱包，用于收取购买者的订单款' }, { status: 400, headers });
                    }
                    if (input.receive_wallet) {
                        const [energy, telegram, transit] = await Promise.all([
                            client.query('SELECT 1 FROM t_energy_platform_bot WHERE receive_wallet=$1 LIMIT 1', [input.receive_wallet]),
                            client.query('SELECT 1 FROM t_telegram_bot WHERE recharge_wallet_addr=$1 LIMIT 1', [input.receive_wallet]),
                            client.query('SELECT 1 FROM t_transit_wallet WHERE receive_wallet=$1 LIMIT 1', [input.receive_wallet]),
                        ]);
                        if (energy.rowCount || telegram.rowCount || transit.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: energy.rowCount ? '不能和能量钱包地址一致' : telegram.rowCount ? '收款钱包不能和机器人充值地址一致' : '不能和闪兑钱包地址一致' }, { status: 400, headers });
                        }
                    }
                    let transactionTime = null;
                    if (input.get_tx_time) {
                        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(input.get_tx_time) || Number.isNaN(new Date(input.get_tx_time.replace(' ', 'T') + 'Z').getTime())) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '交易拉取时间无效' }, { status: 400, headers });
                        }
                        transactionTime = input.get_tx_time.length === 16 ? input.get_tx_time + ':00' : input.get_tx_time;
                    }
                    let secret = '';
                    if (action === 'create' && input.platform_cookie) {
                        try {
                            secret = host.encryptPlatformSecret(String(input.platform_cookie));
                        }
                        catch (error) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: error instanceof RangeError ? 'Cookie 长度超出存储限制' : '服务端 RSA 公钥未配置' }, { status: error instanceof RangeError ? 400 : 503, headers });
                        }
                    }
                    const platformHash = input.platform_name === 3 ? '' : input.platform_hash;
                    if (action === 'create') {
                        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`premium-platform:${input.bot_rid}:${input.platform_name === 3 ? 'telegram-stars' : platformHash}`]);
                        const duplicate = input.platform_name === 3
                            ? await client.query('SELECT 1 FROM t_premium_platform WHERE bot_rid=$1 AND platform_name=3 LIMIT 1', [input.bot_rid])
                            : await client.query('SELECT 1 FROM t_premium_platform WHERE bot_rid=$1 AND platform_hash=$2 LIMIT 1', [input.bot_rid, platformHash]);
                        if (duplicate.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '机器人对应会员平台已存在' }, { status: 409, headers });
                        }
                        const created = await client.query('INSERT INTO t_premium_platform(bot_rid,platform_name,tg_admin_uid,platform_hash,platform_cookie,tg_notice_obj_receive,tg_notice_obj_send,receive_wallet,get_tx_time,comments,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING rid', [input.bot_rid, input.platform_name, input.tg_admin_uid, platformHash, secret, input.tg_notice_obj_receive, input.tg_notice_obj_send, input.receive_wallet, transactionTime, input.comments]);
                        rid = created.rows[0].rid;
                        message = '会员平台已添加';
                    }
                    else {
                        rid = Number(input.rid);
                        const old = await client.query('SELECT rid,bot_rid,platform_name FROM t_premium_platform WHERE rid=$1 FOR UPDATE', [rid]);
                        if (!old.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '会员平台不存在' }, { status: 404, headers });
                        }
                        if (Number(old.rows[0].bot_rid) !== input.bot_rid || Number(old.rows[0].platform_name) !== input.platform_name) {
                            const pending = await client.query('SELECT count(*)::int AS count FROM t_premium_platform_order WHERE premium_platform_rid=$1 AND status IN (0,1,6)', [rid]);
                            if (Number(pending.rows[0]?.count) > 0) {
                                await client.query('ROLLBACK');
                                return Response.json({ message: '平台机器人或类型有未完成订单，暂不能修改' }, { status: 409, headers });
                            }
                        }
                        const duplicate = await client.query('SELECT 1 FROM t_premium_platform WHERE bot_rid=$1 AND platform_name=$2 AND rid<>$3 LIMIT 1', [input.bot_rid, input.platform_name, rid]);
                        if (duplicate.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '该机器人对应会员平台已存在' }, { status: 409, headers });
                        }
                        await client.query('UPDATE t_premium_platform SET bot_rid=$2,platform_name=$3,tg_admin_uid=$4,platform_hash=$5,platform_cookie=CASE WHEN $3=3 THEN NULL ELSE platform_cookie END,platform_phrase=CASE WHEN $3=3 THEN NULL ELSE platform_phrase END,tg_notice_obj_receive=$6,tg_notice_obj_send=$7,receive_wallet=$8,get_tx_time=$9,comments=$10,update_time=now() WHERE rid=$1', [rid, input.bot_rid, input.platform_name, input.tg_admin_uid, platformHash, input.tg_notice_obj_receive, input.tg_notice_obj_send, input.receive_wallet, transactionTime, input.comments]);
                        message = '会员平台已更新';
                    }
                }
                else if (action === 'status') {
                    const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body);
                    rid = Number(input.rid);
                    if (!(await client.query('UPDATE t_premium_platform SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [rid, input.enabled ? 0 : 1])).rowCount) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: '会员平台不存在' }, { status: 404, headers });
                    }
                    message = input.enabled ? '会员平台已启用' : '会员平台已停用';
                }
                else if (action === 'delete') {
                    const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body);
                    rid = Number(input.rid);
                    const removed = await client.query('DELETE FROM t_premium_platform WHERE rid=$1 RETURNING rid', [rid]);
                    if (!removed.rowCount) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: '会员平台不存在' }, { status: 404, headers });
                    }
                    message = '会员平台已删除';
                }
                else {
                    const column = action === 'cookie' ? 'platform_cookie' : 'platform_phrase';
                    const input = z.object({ action: z.enum(['cookie', 'phrase']), rid: id, value: z.string().trim().min(1).max(2500) }).strict().parse(body);
                    rid = Number(input.rid);
                    const existing = await client.query('SELECT platform_name FROM t_premium_platform WHERE rid=$1 FOR UPDATE', [rid]);
                    if (!existing.rowCount) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: '会员平台不存在' }, { status: 404, headers });
                    }
                    if (Number(existing.rows[0].platform_name) === 3) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: 'Telegram Stars 平台不需要平台 Cookie 或助记词' }, { status: 409, headers });
                    }
                    let encrypted;
                    try {
                        encrypted = host.encryptPlatformSecret(input.value);
                    }
                    catch (error) {
                        await client.query('ROLLBACK');
                        return Response.json({ message: error instanceof RangeError ? '内容长度超出存储限制' : '服务端 RSA 公钥未配置' }, { status: error instanceof RangeError ? 400 : 503, headers });
                    }
                    await client.query(`UPDATE t_premium_platform SET ${column}=$2,update_time=now() WHERE rid=$1`, [rid, encrypted]);
                    message = action === 'cookie' ? 'Cookie 已加密更新' : '助记词已加密更新';
                }
                await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, base + '.' + action, rid]);
                await client.query('COMMIT');
                return Response.json({ ok: true, message }, { headers });
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
        });
    };
}
export function createPremiumPackagesApi(host) {
    const { db, identity, can, run } = host;
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, base = 'admin.premium.package';
    const id = z.coerce.number().int().positive().max(2_147_483_647);
    const months = z.union([z.literal(3), z.literal(6), z.literal(12)]);
    const money = z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/, '售价格式无效');
    const permissions = { create: ['添加会员套餐', 'add'], update: ['修改能量套餐', 'update'], delete: ['删除能量套餐', 'delete'], status: ['修改能量套餐', 'change_status'], copy: ['复制会员套餐', 'copy_paste'] };
    const permitted = (user, action) => can(user, permissions[action][0], base + '.' + permissions[action][1]);
    const access = (user) => can(user, '会员管理', base + '.index') && can(user, '会员套餐', base + '.index');
    const originError = (request) => { const origin = host.platformOrigin(), expected = origin ? new URL(origin).origin : ''; return !expected || request.headers.get('origin') !== expected ? Response.json({ message: '请求来源无效' }, { status: 403, headers }) : null; };
    return function premiumPackagesApi(request) {
        return run(async () => {
            const user = await identity(request), url = new URL(request.url);
            if (!access(user))
                return Response.json({ message: '没有访问权限' }, { status: 403, headers });
            if (request.method === 'GET') {
                if (url.searchParams.get('action') === 'options') {
                    const [bots, platforms] = await Promise.all([db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC'), db.query('SELECT p.rid,p.bot_rid,p.platform_name,b.bot_firstname,b.bot_username,p.status FROM t_premium_platform p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid ORDER BY p.rid DESC')]);
                    return Response.json({ bots: bots.rows, platforms: platforms.rows }, { headers });
                }
                if (url.searchParams.get('action') === 'show') {
                    const rid = id.parse(url.searchParams.get('rid'));
                    const result = await db.query(`SELECT p.rid,p.bot_rid,p.premium_platform_rid,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.seq_sn,p.status,p.show_notes,p.package_pic,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time,b.bot_firstname,b.bot_username,pl.platform_name FROM t_premium_platform_package p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid LEFT JOIN t_premium_platform pl ON pl.rid=p.premium_platform_rid WHERE p.rid=$1`, [rid]);
                    if (!result.rowCount)
                        return Response.json({ message: '会员套餐不存在' }, { status: 404, headers });
                    return Response.json({ row: result.rows[0] }, { headers });
                }
                const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), botRid: z.union([z.literal('all'), id]).default('all'), search: z.string().trim().max(50).default('') }).parse(Object.fromEntries(url.searchParams));
                const botRid = input.botRid === 'all' ? null : input.botRid, search = '%' + input.search.replace(/[!%_]/g, c => '!' + c) + '%';
                const where = "($1::int IS NULL OR p.bot_rid=$1) AND ($2='%%' OR COALESCE(p.package_name,'') ILIKE $2 ESCAPE '!')";
                const [total, result] = await Promise.all([
                    db.query(`SELECT count(*)::int AS total FROM t_premium_platform_package p WHERE ${where}`, [botRid, search]),
                    db.query(`SELECT p.rid,p.bot_rid,b.bot_firstname,b.bot_username,p.premium_platform_rid,p.package_name,p.package_month,p.usdt_price::text AS usdt_price,p.seq_sn,p.status,p.show_notes,p.package_pic,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time,pl.platform_name FROM t_premium_platform_package p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid LEFT JOIN t_premium_platform pl ON pl.rid=p.premium_platform_rid WHERE ${where} ORDER BY p.rid DESC LIMIT $3 OFFSET $4`, [botRid, search, input.pageSize, (input.page - 1) * input.pageSize]),
                ]);
                return Response.json({ rows: result.rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canAdd: permitted(user, 'create'), canEdit: permitted(user, 'update'), canDelete: permitted(user, 'delete'), canStatus: permitted(user, 'status'), canCopy: permitted(user, 'copy') }, { headers });
            }
            if (request.method !== 'POST')
                return Response.json({ message: '请求方法不支持' }, { status: 405, headers });
            const badOrigin = originError(request);
            if (badOrigin)
                return badOrigin;
            let stored;
            try {
                const { body, upload } = await host.parsePackageBody(request);
                const action = z.object({ action: z.enum(['create', 'update', 'delete', 'status', 'copy']) }).parse(body).action;
                if (!permitted(user, action))
                    return Response.json({ message: '没有操作权限' }, { status: 403, headers });
                if (upload && action !== 'update')
                    return Response.json({ message: '仅编辑套餐时可以上传图片' }, { status: 400, headers });
                const client = await db.connect();
                try {
                    await client.query('BEGIN');
                    let rid = null, message = '';
                    if (action === 'create' || action === 'update') {
                        const shape = { premium_platform_rid: id, package_name: z.string().trim().min(1, '套餐名称不能为空').max(50), package_month: months, usdt_price: money, seq_sn: z.preprocess(v => v === '' || v === undefined || v === null ? 0 : v, z.coerce.number().int().min(0).max(2_147_483_647)), show_notes: z.string().trim().max(1000).default('') };
                        const input = z.object({ action: z.enum(['create', 'update']), ...(action === 'update' ? { rid: id } : {}), ...shape }).strict().parse(body);
                        const platform = await client.query('SELECT rid,bot_rid,platform_name FROM t_premium_platform WHERE rid=$1 FOR UPDATE', [input.premium_platform_rid]);
                        if (!platform.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '会员平台不存在' }, { status: 400, headers });
                        }
                        const starsPlatform = Number(platform.rows[0].platform_name) === 3;
                        if (!priceUnits(input.usdt_price) || (starsPlatform && telegramPremiumStarPrice(input.package_month) === null)) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: starsPlatform && telegramPremiumStarPrice(input.package_month) === null ? 'Telegram Stars 套餐月份不受支持' : 'USDT 售价必须大于 0' }, { status: 400, headers });
                        }
                        let image = '';
                        if (action === 'update') {
                            const old = await client.query('SELECT rid,package_pic FROM t_premium_platform_package WHERE rid=$1 FOR UPDATE', [input.rid]);
                            if (!old.rowCount) {
                                await client.query('ROLLBACK');
                                return Response.json({ message: '会员套餐不存在' }, { status: 404, headers });
                            }
                            image = old.rows[0].package_pic || '';
                        }
                        if (upload) {
                            try {
                                stored = await host.savePackageImage(upload);
                                image = stored.url;
                            }
                            catch (error) {
                                await client.query('ROLLBACK');
                                const response = host.serviceErrorResponse(error);
                                if (response)
                                    return response;
                                throw error;
                            }
                            if (image.length > 200) {
                                await client.query('ROLLBACK');
                                await stored.remove();
                                stored = undefined;
                                return Response.json({ message: '图片地址超过数据库限制' }, { status: 400, headers });
                            }
                        }
                        if (action === 'create') {
                            const created = await client.query('INSERT INTO t_premium_platform_package(bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,show_notes,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING rid', [platform.rows[0].bot_rid, input.premium_platform_rid, input.package_name, input.package_month, input.usdt_price, 'premium_' + randomUUID().replaceAll('-', ''), input.seq_sn, input.show_notes]);
                            rid = created.rows[0].rid;
                            message = '会员套餐已添加';
                        }
                        else {
                            const updated = await client.query('UPDATE t_premium_platform_package SET bot_rid=$2,premium_platform_rid=$3,package_name=$4,package_month=$5,usdt_price=$6,seq_sn=$7,show_notes=$8,package_pic=$9,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, platform.rows[0].bot_rid, input.premium_platform_rid, input.package_name, input.package_month, input.usdt_price, input.seq_sn, input.show_notes, image]);
                            rid = updated.rows[0]?.rid ?? null;
                            if (!rid) {
                                await client.query('ROLLBACK');
                                return Response.json({ message: '会员套餐不存在' }, { status: 404, headers });
                            }
                            message = '会员套餐已更新';
                        }
                    }
                    else if (action === 'status') {
                        const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body);
                        rid = input.rid;
                        const changed = await client.query('UPDATE t_premium_platform_package SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [rid, input.enabled ? 0 : 1]);
                        if (!changed.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '会员套餐不存在' }, { status: 404, headers });
                        }
                        message = input.enabled ? '会员套餐已启用' : '会员套餐已停用';
                    }
                    else if (action === 'delete') {
                        const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body);
                        rid = input.rid;
                        const removed = await client.query('DELETE FROM t_premium_platform_package WHERE rid=$1 RETURNING rid', [rid]);
                        if (!removed.rowCount) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '会员套餐不存在' }, { status: 404, headers });
                        }
                        message = '会员套餐已删除';
                    }
                    else {
                        const input = z.object({ action: z.literal('copy'), sourcePlatformRid: id, targetPlatformRid: id }).strict().parse(body);
                        if (input.sourcePlatformRid === input.targetPlatformRid) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '来源平台和覆盖平台不能相同' }, { status: 400, headers });
                        }
                        const platforms = await client.query('SELECT rid,bot_rid,platform_name FROM t_premium_platform WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE', [[input.sourcePlatformRid, input.targetPlatformRid]]);
                        if (platforms.rowCount !== 2) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '来源或覆盖平台不存在' }, { status: 404, headers });
                        }
                        const from = platforms.rows.find(row => Number(row.rid) === input.sourcePlatformRid), to = platforms.rows.find(row => Number(row.rid) === input.targetPlatformRid);
                        if (!from || !to) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '来源或覆盖平台不存在' }, { status: 404, headers });
                        }
                        if (Number(from.platform_name) !== Number(to.platform_name)) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '不同开通方式的平台不能直接复制套餐，请在相同开通方式之间复制' }, { status: 400, headers });
                        }
                        const source = await client.query('SELECT count(*)::int AS total FROM t_premium_platform_package WHERE premium_platform_rid=$1', [input.sourcePlatformRid]);
                        if (!Number(source.rows[0].total)) {
                            await client.query('ROLLBACK');
                            return Response.json({ message: '来源平台没有可复制套餐' }, { status: 400, headers });
                        }
                        await client.query('DELETE FROM t_premium_platform_package WHERE premium_platform_rid=$1', [input.targetPlatformRid]);
                        const copied = await client.query(`INSERT INTO t_premium_platform_package(bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,status,show_notes,package_pic,comments,create_time) SELECT $2,$3,package_name,package_month,usdt_price,'premium_'||md5(random()::text||clock_timestamp()::text||rid::text),seq_sn,status,show_notes,package_pic,comments,now() FROM t_premium_platform_package WHERE premium_platform_rid=$1 ORDER BY rid RETURNING rid`, [input.sourcePlatformRid, to.bot_rid, input.targetPlatformRid]);
                        rid = copied.rows[0]?.rid ?? null;
                        message = `已复制 ${copied.rowCount} 个套餐并覆盖目标平台`;
                    }
                    await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, base + '.' + action, rid]);
                    await client.query('COMMIT');
                    stored = undefined;
                    return Response.json({ ok: true, message }, { headers });
                }
                catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                }
                finally {
                    client.release();
                }
            }
            catch (error) {
                if (stored)
                    await stored.remove();
                const response = host.serviceErrorResponse(error);
                if (response)
                    return response;
                throw error;
            }
        });
    };
}
