import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type StatRow = Record<string, unknown> & { is_total: boolean; transferto_address: string | null }

export const telegramTradeStatisticsClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}' IN ('private','group','supergroup')",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,chat,id}' ~ '^-?[0-9]{1,20}$'",
  "AND u.update_body #>> '{message,from,id}' ~ '^[0-9]{1,20}$'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) IN ('统计','能量统计','统计能量')",
].join('\n')

const transitStatisticsSql = [
  "SELECT GROUPING(transferto_address)=1 AS is_total,transferto_address,",
  "COUNT(*) FILTER (WHERE get_time::date=CURRENT_DATE) AS today_count,",
  "COUNT(*) FILTER (WHERE date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp)) AS month_count,",
  "COUNT(*) AS total_count,",
  "COALESCE(SUM(CASE WHEN btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS total,",
  "COALESCE(SUM(CASE WHEN get_time::date=CURRENT_DATE THEN CASE WHEN btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END ELSE 0::numeric END),0)::text AS today_total,",
  "COALESCE(SUM(CASE WHEN date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) THEN CASE WHEN btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END ELSE 0::numeric END),0)::text AS month_total,",
  "COALESCE(SUM(CASE WHEN btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END),0)::text AS back_total,",
  "COALESCE(SUM(CASE WHEN get_time::date=CURRENT_DATE THEN CASE WHEN btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END ELSE 0::numeric END),0)::text AS today_back_total,",
  "COALESCE(SUM(CASE WHEN date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) THEN CASE WHEN btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END ELSE 0::numeric END),0)::text AS month_back_total,",
  "COUNT(*) FILTER (WHERE process_status=9) AS total_count_success,",
  "COUNT(*) FILTER (WHERE get_time::date=CURRENT_DATE AND process_status=9) AS today_count_success,",
  "COUNT(*) FILTER (WHERE date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND process_status=9) AS month_count_success,",
  "COALESCE(SUM(CASE WHEN process_status=9 AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS total_success,",
  "COALESCE(SUM(CASE WHEN get_time::date=CURRENT_DATE AND process_status=9 AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS today_total_success,",
  "COALESCE(SUM(CASE WHEN date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND process_status=9 AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS month_total_success,",
  "COALESCE(SUM(CASE WHEN process_status=9 AND btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END),0)::text AS back_total_success,",
  "COALESCE(SUM(CASE WHEN get_time::date=CURRENT_DATE AND process_status=9 AND btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END),0)::text AS today_back_total_success,",
  "COALESCE(SUM(CASE WHEN date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND process_status=9 AND btrim(sendback_amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(sendback_amount)::numeric ELSE 0::numeric END),0)::text AS month_back_total_success",
  "FROM t_transit_wallet_trade_list GROUP BY GROUPING SETS ((transferto_address),()) ORDER BY GROUPING(transferto_address),transferto_address",
].join('\n')

const energyStatisticsSql = [
  "SELECT GROUPING(transferto_address)=1 AS is_total,transferto_address,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND get_time::date=CURRENT_DATE AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS today_trx_total,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND get_time::date=CURRENT_DATE AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS today_usdt_total,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS month_trx_total,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS month_usdt_total,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS trx_total,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS usdt_total,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND process_status=9 AND get_time::date=CURRENT_DATE AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS today_trx_total_success,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND process_status=9 AND get_time::date=CURRENT_DATE AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS today_usdt_total_success,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND process_status=9 AND date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS month_trx_total_success,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND process_status=9 AND date_trunc('month',get_time)=date_trunc('month',CURRENT_DATE::timestamp) AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS month_usdt_total_success,",
  "COALESCE(SUM(CASE WHEN coin_name='trx' AND process_status=9 AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS trx_total_success,",
  "COALESCE(SUM(CASE WHEN coin_name='usdt' AND process_status=9 AND btrim(amount) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN btrim(amount)::numeric ELSE 0::numeric END),0)::text AS usdt_total_success",
  "FROM t_energy_wallet_trade_list GROUP BY GROUPING SETS ((transferto_address),()) ORDER BY GROUPING(transferto_address),transferto_address",
].join('\n')

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}
function value(row: StatRow, key: string) { return String(row[key] ?? '0') }

export async function telegramTradeStatisticsMessage(pool: Database, text: string): Promise<string | null> {
  if (text === '统计') {
    const result = await pool.query<StatRow>(transitStatisticsSql)
    const wallets = result.rows.filter(row => !row.is_total)
    if (wallets.length === 0) return '闪兑订单交易无数据'
    const total = result.rows.find(row => row.is_total)
    let reply = '💹闪兑统计\n\n'
    for (const row of wallets) {
      reply += '钱包地址：<code>' + escapeHtml(row.transferto_address) + '</code>\n'
        + '当天笔数：' + value(row, 'today_count') + ' 笔 (成功：' + value(row, 'today_count_success') + ' 笔)\n'
        + '当天进USDT：' + value(row, 'today_total') + ' USDT (成功：' + value(row, 'today_total_success') + ' USDT)\n'
        + '当天出TRX：' + value(row, 'today_back_total') + ' TRX (成功：' + value(row, 'today_back_total_success') + ' TRX)\n\n'
        + '当月笔数：' + value(row, 'month_count') + ' 笔 (成功：' + value(row, 'month_count_success') + ' 笔)\n'
        + '当月进USDT：' + value(row, 'month_total') + ' USDT (成功：' + value(row, 'month_total_success') + ' USDT)\n'
        + '当月出TRX：' + value(row, 'month_back_total') + ' TRX (成功：' + value(row, 'month_back_total_success') + ' TRX)\n\n'
        + '总笔数：' + value(row, 'total_count') + ' 笔 (成功：' + value(row, 'total_count_success') + ' 笔)\n'
        + '总进USDT：' + value(row, 'total') + ' USDT (成功：' + value(row, 'total_success') + ' USDT)\n'
        + '总出TRX：' + value(row, 'back_total') + ' TRX (成功：' + value(row, 'back_total_success') + ' TRX)\n\n'
    }
    if (total) {
      reply += '<b>所有钱包总数据</b>\n'
        + '当天笔数：' + value(total, 'today_count') + ' 笔 (成功：' + value(total, 'today_count_success') + ' 笔)\n'
        + '当天进USDT：' + value(total, 'today_total') + ' USDT (成功：' + value(total, 'today_total_success') + ' USDT)\n'
        + '当天出TRX：' + value(total, 'today_back_total') + ' TRX (成功：' + value(total, 'today_back_total_success') + ' TRX)\n\n'
        + '当月笔数：' + value(total, 'month_count') + ' 笔 (成功：' + value(total, 'month_count_success') + ' 笔)\n'
        + '当月进USDT：' + value(total, 'month_total') + ' USDT (成功：' + value(total, 'month_total_success') + ' USDT)\n'
        + '当月出TRX：' + value(total, 'month_back_total') + ' TRX (成功：' + value(total, 'month_back_total_success') + ' TRX)\n\n'
        + '总笔数：' + value(total, 'total_count') + ' 笔 (成功：' + value(total, 'total_count_success') + ' 笔)\n'
        + '总进USDT：' + value(total, 'total') + ' USDT (成功：' + value(total, 'total_success') + ' USDT)\n'
        + '总出TRX：' + value(total, 'back_total') + ' TRX (成功：' + value(total, 'back_total_success') + ' TRX)\n\n'
    }
    return reply
  }
  if (text === '能量统计' || text === '统计能量') {
    const result = await pool.query<StatRow>(energyStatisticsSql)
    const wallets = result.rows.filter(row => !row.is_total)
    if (wallets.length === 0) return '能量订单交易无数据'
    const total = result.rows.find(row => row.is_total)
    let reply = '🔋能量统计\n\n'
    for (const row of wallets) {
      reply += '钱包地址：<code>' + escapeHtml(row.transferto_address) + '</code>\n'
        + '今日：' + value(row, 'today_trx_total') + ' TRX. ' + value(row, 'today_usdt_total') + ' USDT (成功：' + value(row, 'today_trx_total_success') + ' TRX. ' + value(row, 'today_usdt_total_success') + ' USDT)\n'
        + '当月：' + value(row, 'month_trx_total') + ' TRX. ' + value(row, 'month_usdt_total') + ' USDT (成功：' + value(row, 'month_trx_total_success') + ' TRX. ' + value(row, 'month_usdt_total_success') + ' USDT)\n'
        + '总数据：' + value(row, 'trx_total') + ' TRX. ' + value(row, 'usdt_total') + ' USDT (成功：' + value(row, 'trx_total_success') + ' TRX. ' + value(row, 'usdt_total_success') + ' USDT)\n\n'
    }
    if (total) {
      reply += '<b>所有钱包总数据</b>\n'
        + '今日：' + value(total, 'today_trx_total') + ' TRX. ' + value(total, 'today_usdt_total') + ' USDT (成功：' + value(total, 'today_trx_total_success') + ' TRX. ' + value(total, 'today_usdt_total_success') + ' USDT)\n'
        + '当月：' + value(total, 'month_trx_total') + ' TRX. ' + value(total, 'month_usdt_total') + ' USDT (成功：' + value(total, 'month_trx_total_success') + ' TRX. ' + value(total, 'month_usdt_total_success') + ' USDT)\n'
        + '总数据：' + value(total, 'trx_total') + ' TRX. ' + value(total, 'usdt_total') + ' USDT (成功：' + value(total, 'trx_total_success') + ' TRX. ' + value(total, 'usdt_total_success') + ' USDT)\n\n'
    }
    return reply
  }
  return null
}
