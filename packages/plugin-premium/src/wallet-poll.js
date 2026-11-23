const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const safeInteger = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function premiumWalletStartTimestamp(latest, saved) {
    let result = latest && /^\d{1,16}$/.test(latest) ? BigInt(latest) : 0n;
    if (saved) {
        const raw = saved instanceof Date ? saved.toISOString() : String(saved);
        const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+08:00`);
        if (Number.isFinite(date.getTime())) {
            const threshold = BigInt(Math.max(0, date.getTime() - 10));
            if (threshold > result)
                result = threshold;
        }
    }
    return result.toString();
}
function eventData(value, wallet) {
    if (!value || typeof value !== 'object')
        return null;
    const row = value;
    if (row.type !== 'Transfer' || typeof row.transaction_id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.transaction_id) ||
        typeof row.from !== 'string' || !row.from || row.from.length > 200 ||
        row.to !== wallet || typeof row.value !== 'string' || !/^\d{1,100}$/.test(row.value) ||
        !safeInteger(row.block_timestamp))
        return null;
    const raw = BigInt(row.value);
    if (!raw)
        return null;
    const whole = raw / 1000000n;
    const fraction = (raw % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
    return { hash: row.transaction_id.toLowerCase(), from: row.from, timestamp: String(row.block_timestamp),
        amount: fraction ? `${whole}.${fraction}` : whole.toString() };
}
function nextUrl(value, address) {
    if (typeof value !== 'string' || !value)
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'api.trongrid.io' || url.port || url.username || url.password || url.hash ||
            url.pathname !== `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` ||
            url.searchParams.get('contract_address') !== contract || url.searchParams.get('only_to') !== 'true')
            return null;
        return url;
    }
    catch {
        return null;
    }
}
export function premiumWalletConfigKeys(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return [];
        }
    }
    const raw = parsed && typeof parsed === 'object' ? parsed.keys : undefined;
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
    return list.map(String).map(item => item.trim()).filter(Boolean);
}
async function insert(pool, wallet, event, now) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [event.hash]);
        const exists = await client.query('SELECT 1 FROM t_premium_wallet_trade_list WHERE tx_hash=$1 LIMIT 1', [event.hash]);
        if (exists.rowCount) {
            await client.query('COMMIT');
            return false;
        }
        await client.query("INSERT INTO t_premium_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,\"timestamp\",process_status,process_time,process_comments,get_time) VALUES($1,$2,$3,'usdt',$4,$5,1,$6,'待开通',$6)", [event.hash, event.from, wallet.receive_wallet, event.amount, event.timestamp, now]);
        await client.query('COMMIT');
        return true;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
export async function syncPremiumWalletUsdtTrades(options) {
    const enabled = options.enabled ?? false;
    const shouldContinue = options.shouldContinue ?? (() => true);
    if (!enabled || !shouldContinue())
        return { wallets: 0, inserted: 0, skipped: true };
    const pool = options.pool, request = options.request ?? fetch;
    const logger = options.logger ?? console, now = options.now ?? (() => new Date());
    const wallets = await pool.query("SELECT w.rid,w.receive_wallet,w.get_tx_time::text AS get_tx_time,COALESCE((SELECT max(t.\"timestamp\"::numeric)::text FROM t_premium_wallet_trade_list t WHERE t.transferto_address=w.receive_wallet AND t.coin_name='usdt' AND t.\"timestamp\" ~ '^[0-9]+$'),'0') AS latest_timestamp FROM t_premium_platform w WHERE w.status=0 AND length(w.receive_wallet)=34 ORDER BY w.rid");
    const keys = options.apiKeys ?? [];
    let inserted = 0, cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, wallets.rows.length) }, async () => {
        while (cursor < wallets.rows.length && shouldContinue()) {
            const wallet = wallets.rows[cursor++];
            let url = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet.receive_wallet)}/transactions/trc20`);
            url.searchParams.set('limit', '50');
            url.searchParams.set('only_to', 'true');
            url.searchParams.set('min_timestamp', premiumWalletStartTimestamp(wallet.latest_timestamp, wallet.get_tx_time));
            url.searchParams.set('contract_address', contract);
            const seen = new Set();
            try {
                while (shouldContinue()) {
                    if (seen.has(url.href))
                        throw new Error('repeated TronGrid pagination URL');
                    seen.add(url.href);
                    const key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : '';
                    const response = await request(url, {
                        headers: { Accept: 'application/json', ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
                        redirect: 'error', signal: AbortSignal.timeout(10_000),
                    });
                    if (!response.ok)
                        throw new Error(`TronGrid HTTP ${response.status}`);
                    const payload = await response.json();
                    if (!Array.isArray(payload.data))
                        throw new Error('invalid TronGrid transaction list');
                    for (const row of payload.data) {
                        if (!shouldContinue())
                            break;
                        const event = eventData(row, wallet.receive_wallet);
                        if (event && await insert(pool, wallet, event, now()))
                            inserted++;
                    }
                    const next = nextUrl(payload.meta?.links?.next, wallet.receive_wallet);
                    if (payload.meta?.links?.next && !next)
                        throw new Error('invalid TronGrid pagination URL');
                    if (!next)
                        break;
                    url = next;
                }
            }
            catch (error) {
                logger.error(`Premium USDT poll failed for wallet ${wallet.rid}: ${error instanceof Error ? error.message : 'provider error'}`);
            }
        }
    }));
    return { wallets: wallets.rows.length, inserted, skipped: false };
}
