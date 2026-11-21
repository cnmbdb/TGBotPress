import { cloneProxyRevenueCommission, scaledText } from "./revenue.js";
import { cloneProxyRevenueCommission as cloneProxyRevenueCommission2 } from "./revenue.js";
const silentLogger = { info() {
}, error() {
} };
function telegramId(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  try {
    const id = BigInt(text);
    if (id < -9223372036854775808n || id > 9223372036854775807n) return null;
    return id.toString();
  } catch {
    return null;
  }
}
async function loadMerchants(pool) {
  const result = await pool.query(
    "SELECT rid::text,master_bot_rid,bot_rid,owner_tg_uid::text,owner_tg_username,owner_tg_name,revenue_ratio::text FROM t_telegram_clone_proxy_merchant WHERE status=1 AND revenue_ratio>0 ORDER BY rid"
  );
  return result.rows;
}
async function hasEnergyPaymentColumns(pool) {
  const result = await pool.query(
    "SELECT count(DISTINCT column_name)::text AS count FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='t_energy_quick_order' AND column_name IN ('pay_price','pay_type','pay_time')"
  );
  return Number(result.rows[0]?.count ?? 0) === 3;
}
async function loadOrders(pool, merchant, sourceType) {
  let select;
  let where;
  const params = [merchant.bot_rid, merchant.revenue_ratio];
  if (sourceType === "premium") {
    select = "SELECT o.rid::text,o.buy_tg_uid AS tg_uid,o.buy_tg_username AS tg_username,o.need_pay_usdt::text AS amount,'usdt'::text AS coin_name,CASE WHEN COALESCE(o.tx_hash,'')<>'' THEN 'chain' ELSE 'balance' END::text AS payment_method,o.tx_hash,COALESCE(o.complete_time,o.create_time)::text AS paid_time ";
    where = "o.status=2 AND o.need_pay_usdt>0 AND round(o.need_pay_usdt*least(150::numeric,greatest(0::numeric,$2::numeric))/100,6)>0";
  } else if (sourceType === "shop") {
    select = "SELECT o.rid::text,o.tg_uid,o.tg_username,o.pay_price AS amount,CASE WHEN o.pay_type=1 THEN 'trx' ELSE 'usdt' END::text AS coin_name,'balance'::text AS payment_method,NULL::text AS tx_hash,o.pay_time::text AS paid_time ";
    where = "o.pay_time IS NOT NULL AND CASE WHEN btrim(COALESCE(o.pay_price,'')) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(o.pay_price)::numeric>0 AND round(btrim(o.pay_price)::numeric*least(150::numeric,greatest(0::numeric,$2::numeric))/100,6)>0 ELSE FALSE END";
  } else {
    select = "SELECT o.rid::text,o.tg_uid,''::text AS tg_username,o.pay_price::text AS amount,CASE WHEN lower(o.pay_type)='trx' THEN 'trx' ELSE 'usdt' END::text AS coin_name,'balance'::text AS payment_method,NULL::text AS tx_hash,o.pay_time::text AS paid_time ";
    where = "o.status=9 AND o.pay_time IS NOT NULL AND o.pay_price>0 AND round(o.pay_price*least(150::numeric,greatest(0::numeric,$2::numeric))/100,6)>0";
  }
  const table = sourceType === "premium" ? "t_premium_platform_order" : sourceType === "shop" ? "t_shop_order" : "t_energy_quick_order";
  const result = await pool.query(
    select + "FROM " + table + " o WHERE o.bot_rid=$1 AND " + where + " AND NOT EXISTS (SELECT 1 FROM t_telegram_clone_proxy_order ledger WHERE ledger.source_type=$3 AND ledger.source_order_rid=o.rid) ORDER BY o.rid LIMIT 200",
    [...params, sourceType]
  );
  return result.rows.map((row) => ({ ...row, source_type: sourceType }));
}
async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
  }
}
async function creditOrder(pool, merchant, order, shouldContinue) {
  const userId = telegramId(order.tg_uid);
  const ownerId = telegramId(merchant.owner_tg_uid);
  const computed = cloneProxyRevenueCommission(order.amount, merchant.revenue_ratio);
  if (!userId || !ownerId || !computed) return "skipped";
  if (!shouldContinue()) return "stopped";
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('plugin:cloneproxy:lifecycle',0))");
    const active = await client.query(
      "SELECT rid::text FROM t_telegram_clone_proxy_merchant WHERE rid=$1 AND status=1 FOR UPDATE",
      [merchant.rid]
    );
    if (active.rowCount !== 1) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return "skipped";
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [merchant.master_bot_rid + ":" + ownerId]);
    const inserted = await client.query(
      "INSERT INTO t_telegram_clone_proxy_order (merchant_rid,master_bot_rid,bot_rid,order_type,source_type,source_order_rid,pay_user_tg_uid,pay_user_tg_username,amount,need_pay_amount,coin_name,payment_method,status,revenue_ratio,revenue_amount,tx_hash,comments,create_time,update_time,paid_time,complete_time) VALUES($1,$2,$3,'revenue',$4,$5,$6,$7,$8,$8,$9,$10,2,$11,$12,$13,'\u6536\u76CA\u5DF2\u81EA\u52A8\u5165\u4E3B\u673A\u5668\u4EBA\u7528\u6237\u4F59\u989D',COALESCE($14::timestamp,now()),now(),COALESCE($14::timestamp,now()),now()) ON CONFLICT (source_type,source_order_rid) WHERE source_order_rid IS NOT NULL DO NOTHING RETURNING rid::text",
      [
        merchant.rid,
        merchant.master_bot_rid,
        merchant.bot_rid,
        order.source_type,
        order.rid,
        userId,
        order.tg_username ?? "",
        computed.gross,
        order.coin_name,
        order.payment_method,
        scaledText(computed.ratioHundredths, 2),
        computed.commission,
        order.tx_hash,
        order.paid_time
      ]
    );
    if (inserted.rowCount !== 1) {
      await client.query("COMMIT");
      transactionOpen = false;
      return "duplicate";
    }
    const user = await client.query(
      "SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE",
      [merchant.master_bot_rid, ownerId]
    );
    let userRid = user.rows[0]?.rid;
    if (userRid === void 0) {
      const created = await client.query(
        "INSERT INTO t_telegram_bot_user (bot_rid,tg_uid,tg_username,tg_nickname,status,cash_trx,cash_usdt,max_monitor_wallet,first_time) VALUES($1,$2,$3,$4,1,0,0,0,now()) RETURNING rid",
        [merchant.master_bot_rid, ownerId, merchant.owner_tg_username, merchant.owner_tg_name]
      );
      userRid = created.rows[0]?.rid;
    }
    if (userRid === void 0) throw new Error("clone proxy owner account could not be created");
    const balanceColumn = order.coin_name === "trx" ? "cash_trx" : "cash_usdt";
    const totalColumn = order.coin_name === "trx" ? "total_revenue_trx" : "total_revenue_usdt";
    await client.query("UPDATE t_telegram_bot_user SET " + balanceColumn + "=" + balanceColumn + "+$2 WHERE rid=$1", [userRid, computed.commission]);
    await client.query("UPDATE t_telegram_clone_proxy_merchant SET " + totalColumn + "=" + totalColumn + "+$2,update_time=now() WHERE rid=$1", [merchant.rid, computed.commission]);
    if (!shouldContinue()) {
      await rollback(client);
      transactionOpen = false;
      return "stopped";
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return "credited";
  } catch (error) {
    if (transactionOpen) await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
async function syncCloneProxyRevenue(pool, logger = silentLogger, shouldContinue = () => true) {
  const result = { merchants: 0, scanned: 0, credited: 0, duplicates: 0, skipped: 0, failed: 0, stopped: false };
  if (!shouldContinue()) {
    result.stopped = true;
    return result;
  }
  const merchants = await loadMerchants(pool);
  result.merchants = merchants.length;
  let energyColumns = false;
  if (merchants.length && shouldContinue()) {
    try {
      energyColumns = await hasEnergyPaymentColumns(pool);
    } catch (error) {
      logger.error("clone proxy revenue could not inspect optional energy payment columns");
    }
  }
  for (const merchant of merchants) {
    if (!shouldContinue()) {
      result.stopped = true;
      break;
    }
    for (const sourceType of energyColumns ? ["premium", "shop", "energy_quick"] : ["premium", "shop"]) {
      if (!shouldContinue()) {
        result.stopped = true;
        break;
      }
      let orders;
      try {
        orders = await loadOrders(pool, merchant, sourceType);
      } catch (error) {
        result.failed++;
        logger.error("clone proxy revenue could not load " + sourceType + " orders for merchant " + merchant.rid);
        continue;
      }
      for (const order of orders) {
        result.scanned++;
        if (!shouldContinue()) {
          result.stopped = true;
          break;
        }
        try {
          const outcome = await creditOrder(pool, merchant, order, shouldContinue);
          if (outcome === "credited") result.credited++;
          else if (outcome === "duplicate") result.duplicates++;
          else if (outcome === "skipped") result.skipped++;
          else {
            result.stopped = true;
            break;
          }
        } catch (error) {
          result.failed++;
          logger.error("clone proxy revenue could not settle " + sourceType + " order " + order.rid);
        }
      }
      if (result.stopped) break;
    }
    if (result.stopped) break;
  }
  return result;
}
export {
  cloneProxyRevenueCommission2 as cloneProxyRevenueCommission,
  syncCloneProxyRevenue
};
