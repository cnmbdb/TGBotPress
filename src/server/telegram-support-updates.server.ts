import { effectiveShopPrice as packageEffectiveShopPrice, shopMoney as packageShopMoney } from '@tgbotpress/plugin-shop/pricing.js'
import type { DatabaseConnection as Pool } from './database.types'
import { constants, createPrivateKey, privateDecrypt, randomBytes, randomInt, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db } from './db.server'
import { claimManagedPluginUpdate, releaseManagedPluginUpdate, type ManagedModuleId } from '../plugins/module-lifecycle.server'
import { digest } from './security'
import { analyzeMessage } from './moderation-scan.server'
import { telegramCalculatorReply } from './telegram-calculator'
import { handleTelegramKeywordReply, telegramKeyreplyClaimable, telegramKeyreplyClaimPredicate } from './telegram-keyreply.server'
import { energyBalancePurchaseCallback, energyBalancePurchaseClaimPredicate, energyBalancePurchaseReplyClaimPredicate, handleEnergyBalancePurchaseCallback } from './telegram-energy-balance-purchases.server'
import { handleTelegramEnergyBishuBind, telegramEnergyBishuBindClaimPredicate } from './telegram-energy-bishu-bind.server'
import { handleTelegramExchangeRate, telegramExchangeRateClaimPredicate } from './telegram-exchange-rate.server'
import { telegramTradeStatisticsClaimPredicate, telegramTradeStatisticsMessage } from './telegram-trade-statistics.server'
import { handleTelegramAdminActivation, telegramAdminActivationClaimPredicate } from './telegram-admin-activation.server'
import { registeredCloneProxy as cloneProxyPlugin } from '../plugins/registry.server'
const { handleToken: handleCloneProxyTokenUpdate, handleUpdate: handleTelegramCloneProxyUpdate, claimPredicate: telegramCloneProxyClaimPredicate } = cloneProxyPlugin.telegram
import { handlePremiumTelegramCallback, handleTelegramPremiumUsernameReply, isPremiumCallbackUpdate, isPremiumUsernameReplyCandidate, isPremiumUsernameReplyForPrompt, premiumCancelUnpaidClaimPredicate, premiumChooseAgainClaimPredicate, premiumPackageCallbackClaimPredicate, premiumUsernameReplyClaimPredicate, premiumWalletPayClaimPredicate } from './telegram-premium-purchases.server'
import { DISABLED_SECRET_COMMAND_REPLY, DISABLED_SECRET_COMMAND_PREFIXES, isDisabledSensitiveTelegramCommand } from './telegram-disabled-secret-commands.server'

type Database = Pick<Pool, 'query'>
type Message = Record<string, any> & { message_id: number | string; chat: { id: number | string; type: string }; from?: { id?: number | string; username?: string; first_name?: string; last_name?: string; is_bot?: boolean } }
type CallbackQuery = { id?: number | string; data?: string; from?: { id?: number | string; is_bot?: boolean; username?: string }; message?: Message }
type Update = { rid: number; bot_rid: number; received_at: Date | string; update_body: { update_id?: number; message?: Message; edited_message?: Message; callback_query?: CallbackQuery } }
type Config = { bot_token: string | null; bot_username: string | null; bot_admin_username: string | null; support_enabled: boolean; support_captcha_enabled: boolean; support_verified_minutes: number; ad_score_threshold: number; ad_keywords: string | null }
type Tg = { ok?: boolean; description?: string; result?: { message_id?: number } }
const textOf = (m: Message) => String(m.text ?? m.caption ?? '').trim()
const preview = (m: Message) => [m.text, m.caption].filter((v): v is string => typeof v === 'string').join(' ').slice(0, 450)
function privateMessage(update: Update['update_body']) {
  const m = update?.message ?? update?.edited_message
  return m && m.chat?.type === 'private' && !m.from?.is_bot && /^\d{1,20}$/.test(String(m.from?.id ?? '')) && /^\d{1,20}$/.test(String(m.chat.id)) && /^\d{1,20}$/.test(String(m.message_id)) ? m : null
}
function isStart(value: string) { return /^\/support(?:@[a-z0-9_]+)?$/iu.test(value) || ['人工客服','联系客服'].includes(value) }
function isEnd(value: string) { return /^\/endsupport(?:@[a-z0-9_]+)?$/iu.test(value) || value === '结束客服' }

const supportCandidatePredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND (',
  " lower(trim(COALESCE(u.update_body #>> '{message,text}',''))) ~ '^(/support(@[a-z0-9_]+)?|人工客服|联系客服)$'",
  " OR lower(trim(COALESCE(u.update_body #>> '{message,text}',''))) ~ '^(/endsupport(@[a-z0-9_]+)?|结束客服)$'",
  " OR EXISTS (SELECT 1 FROM t_telegram_verification v WHERE v.bot_rid=u.bot_rid AND v.user_id::text=u.update_body #>> '{message,from,id}' AND v.verification_type='support' AND v.status IN ('pending','verified') AND v.expires_at>now())",
  " OR EXISTS (SELECT 1 FROM t_telegram_support_message sm WHERE sm.bot_rid=u.bot_rid AND sm.direction='user_to_support' AND sm.support_chat_id::text=u.update_body #>> '{message,chat,id}' AND sm.support_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}' AND lower(COALESCE(u.update_body #>> '{message,from,username}',''))=lower(trim(b.bot_admin_username,'@')))",
  ')',
].join('\n')

const verificationStartPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~* '^/start(@[a-z0-9_]+)?[[:space:]]+[a-z0-9]{64}$'",
  "AND EXISTS (SELECT 1 FROM t_telegram_verification v WHERE v.bot_rid=u.bot_rid AND v.token_hash=encode(digest(substring(trim(COALESCE(u.update_body #>> '{message,text}','')) from '[[:space:]]+([a-z0-9]{64})$'),'sha256'),'hex'))",
].join('\n')

const privateStartPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND (lower(trim(COALESCE(u.update_body #>> '{message,text}','')))='/start' OR lower(trim(COALESCE(u.update_body #>> '{message,text}','')))=lower('/start@'||trim(COALESCE(b.bot_username,''),'@')))",
].join('\n')

const privateSharedIdPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND (',
  " (u.update_body #>> '{message,user_shared,request_id}' IN ('1','3') AND u.update_body #>> '{message,user_shared,user_id}' ~ '^[0-9]{1,20}$')",
  " OR (u.update_body #>> '{message,chat_shared,request_id}' IN ('2','4') AND u.update_body #>> '{message,chat_shared,chat_id}' ~ '^-?[0-9]{1,20}$')",
  ')',
].join('\n')

const bindASendNCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND u.update_body #>> '{callback_query,data}' IN ('bindA','bindABind','bindAUnbind')",
].join('\n')
const privateWalletBindCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='userbindaddress'",
].join('\n')
const privateWalletAddressReplyPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s',
  ' WHERE s.bot_rid=u.bot_rid',
  " AND s.chat_id::text=u.update_body #>> '{message,chat,id}'",
  " AND s.user_id::text=u.update_body #>> '{message,from,id}'",
  " AND s.state='wallet_address' AND s.expires_at>now()",
  " AND s.prompt_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}')",
].join('\n')
const bindASendNAddressReplyPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s',
  ' WHERE s.bot_rid=u.bot_rid',
  " AND s.chat_id::text=u.update_body #>> '{message,chat,id}'",
  " AND s.user_id::text=u.update_body #>> '{message,from,id}'",
  " AND s.state='bindA_address' AND s.expires_at>now()",
  " AND s.prompt_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}')",
].join('\n')
const privateTronAddressPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'",
].join('\n')
const privateEvmAddressPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^0[xX][0-9a-fA-F]{40}$'",
].join('\n')
const privateBishuDirectPurchasePredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND u.update_body #>> '{message,chat,id}'=u.update_body #>> '{message,from,id}'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^(添加笔数|增加笔数)([[:space:]]|$)'",
].join('\n')
const privateTronHistoryCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^search(usdt|trx)list(all|ain|out)T[1-9A-HJ-NP-Za-km-z]{33}$'",
].join('\n')
const privateTronApprovalCommandPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^查授权[[:space:]]*T[1-9A-HJ-NP-Za-km-z]{33}$'",
].join('\n')
const privateTronApprovalCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^查授权T[1-9A-HJ-NP-Za-km-z]{33}$'",
].join('\n')
const privateOkxC2cFilterCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' IN ('z0','z1','z2','z3')",
  "AND COALESCE(u.update_body #>> '{callback_query,message,text}',u.update_body #>> '{callback_query,message,caption}','') LIKE '%Okex商家C2C实时top10%'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=9)",
].join('\n')
const privateEnergyBishuCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' IN ('energybishusy','energybishubind','energybishusearch','energybishubalanceadd')",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=10)",
].join('\n')
const energyBishuPackageCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='energybishu'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=10)",
].join('\n')
const trusteeshipMyAddressCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='aitrusteeshipmyaddress'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (5,11))",
].join('\n')
const trusteeshipAddAddressCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='aitrusteeshipaddaddress'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (5,11))",
].join('\n')
const trusteeshipDeleteAddressCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='aitrusteeshipdeleteaddress'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (5,11))",
].join('\n')
const trusteeshipEnergySettingsCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND (u.update_body #>> '{callback_query,data}'='aitrusteeshipupdate' OR u.update_body #>> '{callback_query,data}' ~ '^aitrusteeshipupdate_[0-9]{1,12}$' OR u.update_body #>> '{callback_query,data}' ~ '^aitrusteeshipupdateconfirm_[0-9]{1,12}_[12]$')",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=11)",
].join('\n')
const trusteeshipCancelRechargeCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='cancelaitrusteeshiprechargeunpaid'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=11)",
].join('\n')
const legacyEnergyFeeInfoCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='重新选择套餐energy'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n')
const energyPlatformPackageCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^energy_[0-9a-f]{32}$'",
  "AND EXISTS (SELECT 1 FROM t_energy_platform_package p JOIN t_energy_platform_bot eb ON eb.bot_rid=p.bot_rid AND eb.status=0 WHERE p.bot_rid=u.bot_rid AND p.status=0 AND p.callback_data=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n')
const privateGoodsPageCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,message,chat,id}' ~ '^-?[0-9]{1,20}$'",
  "AND u.update_body #>> '{callback_query,from,id}' ~ '^[0-9]{1,20}$'",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND u.update_body #>> '{callback_query,data}' ~ '^buygoods[1-9][0-9]{0,9}_[1-9][0-9]{0,3}$'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=7)",
].join('\n')
const privateGoodsSelectionCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,message,chat,id}' ~ '^-?[0-9]{1,20}$'",
  "AND u.update_body #>> '{callback_query,from,id}' ~ '^[0-9]{1,20}$'",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND u.update_body #>> '{callback_query,data}' ~ '^buygoodscdkey[1-9][0-9]{0,9}$'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=7)",
].join('\n')
const privateGoodsPurchaseCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^buygoodscdkeyconfirm(trx|usdt)[1-9][0-9]{0,9}$'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=7)",
].join('\n')
const trusteeshipRechargeCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^aitrusteeship(recharge(trx|usdt)|recharge(trx|usdt)(10|100|500|1000|2000|5000))$'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (5,8,11))",
].join('\n')
const trusteeshipSwapTrxCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='aitrusteeshipusdtswaptrx'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type IN (5,8,11))",
].join('\n')
const trusteeshipMenuCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND (u.update_body #>> '{callback_query,message,chat,type}'<>'private' OR u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}'='aitrusteeship'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=11)",
].join('\n')
const privateEnergyBishuToggleCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{callback_query,data}' ~ '^togglebishu_[0-9]+_[YN]$'",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=10)",
].join('\n')
const privateEnergyBishuReplyPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s',
  ' WHERE s.bot_rid=u.bot_rid',
  " AND s.chat_id::text=u.update_body #>> '{message,chat,id}'",
  " AND s.user_id::text=u.update_body #>> '{message,from,id}'",
  " AND s.state IN ('bishu_balance_query','bishu_bind_notice','bishu_add_address','bishu_add_count','trusteeship_add_address','trusteeship_delete_address','trusteeship_usdt_to_trx') AND s.expires_at>now()",
  " AND s.prompt_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}')",
].join('\n')
const monitorWalletCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}'='private'",
  "AND u.update_body #>> '{callback_query,message,chat,id}'=u.update_body #>> '{callback_query,from,id}'",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  "AND (u.update_body #>> '{callback_query,data}' IN ('monitorddaddress','monitordeleteaddress','monitorwalletbuy','buywalletmonitor5','buywalletmonitor10','buywalletmonitor20','buywalletmonitor50','buywalletmonitor100','buywalletmonitor200') OR u.update_body #>> '{callback_query,data}' ~ '^monitorwallet_[1-9][0-9]{0,4}$' OR u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdate_[1-9][0-9]{0,4}$' OR u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdatewallet_[1-9][0-9]{0,9}$' OR u.update_body #>> '{callback_query,data}' ~ '^monitorwalletfunc_[1-9][0-9]{0,4}$' OR u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdatefunc_[1-9][0-9]{0,9}$' OR u.update_body #>> '{callback_query,data}' ~ '^monitorwalletupdatefunc(usdt|trxa|appr|mult|pled)_[1-9][0-9]{0,9}$')",
  "AND EXISTS (SELECT 1 FROM t_telegram_bot_keyreply kr WHERE kr.bot_rid=u.bot_rid AND kr.status=0 AND kr.opt_type=6)",
  "AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(u.update_body #> '{callback_query,message,reply_markup,inline_keyboard}','[]'::jsonb)) AS keyboard_row(row_json) CROSS JOIN LATERAL jsonb_array_elements(keyboard_row.row_json) AS button(button_json) WHERE button.button_json->>'callback_data'=u.update_body #>> '{callback_query,data}')",
].join('\n')
const monitorWalletReplyPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND EXISTS (SELECT 1 FROM t_platform_telegram_conversation_state s',
  ' WHERE s.bot_rid=u.bot_rid',
  " AND s.chat_id::text=u.update_body #>> '{message,chat,id}'",
  " AND s.user_id::text=u.update_body #>> '{message,from,id}'",
  " AND s.state IN ('monitor_add_address','monitor_delete_address','monitor_update_comment') AND s.expires_at>now()",
  " AND s.prompt_message_id::text=u.update_body #>> '{message,reply_to_message,message_id}')",
].join('\n')

const privateCalculatorPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,from,id}' ~ '^[0-9]{1,20}$'",
  "AND u.update_body #>> '{message,chat,id}' ~ '^[0-9]{1,20}$'",
  "AND u.update_body #>> '{message,message_id}' ~ '^[0-9]{1,20}$'",
  "AND length(trim(COALESCE(u.update_body #>> '{message,text}',''))) BETWEEN 1 AND 4096",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^[-0-9.()+*/ ]+$'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '[+*/-]'",
].join('\n')
const disabledSecretMessagePredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  'AND (' + DISABLED_SECRET_COMMAND_PREFIXES.map(prefix => "left(trim(COALESCE(u.update_body #>> '{message,text}','')) ," + prefix.length + ")='" + prefix + "'").join(' OR ') + ')',
].join('\n')
const disabledSecretCallbackPredicate = [
  "u.update_body ? 'callback_query' AND u.update_body #>> '{callback_query,message,chat,type}' IN ('private','group','supergroup')",
  "AND COALESCE(u.update_body #>> '{callback_query,from,is_bot}','false')<>'true'",
  'AND (' + DISABLED_SECRET_COMMAND_PREFIXES.map(prefix => "left(COALESCE(u.update_body #>> '{callback_query,data}','')," + prefix.length + ")='" + prefix + "'").join(' OR ') + ')',
].join('\n')

const cloneProxyTokenClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,from,id}'=u.update_body #>> '{message,chat,id}'",
  "AND EXISTS (SELECT 1 FROM t_telegram_clone_proxy_order o",
  " LEFT JOIN t_platform_cloneproxy_token_waiter w ON w.master_bot_rid=o.master_bot_rid AND w.pay_user_tg_uid=o.pay_user_tg_uid",
  " WHERE o.master_bot_rid=u.bot_rid AND o.pay_user_tg_uid::text=u.update_body #>> '{message,from,id}' AND o.order_type='opening' AND o.status=1",
  " AND ((w.master_bot_rid IS NOT NULL AND w.clone_proxy_order_rid=o.rid AND w.consumed_at IS NULL AND w.expires_at>now())",
  " OR ((w.master_bot_rid IS NULL OR (w.consumed_at IS NULL AND w.expires_at<=now())) AND trim(COALESCE(u.update_body #>> '{message,text}','')) ~ '^\\d{6,12}:[A-Za-z0-9_-]{20,}$')))",
].join('\n')
const baseOtherClaimablePredicate = `(${disabledSecretMessagePredicate}) OR (${disabledSecretCallbackPredicate}) OR (${cloneProxyTokenClaimPredicate}) OR (${telegramExchangeRateClaimPredicate}) OR (${telegramEnergyBishuBindClaimPredicate}) OR (${telegramTradeStatisticsClaimPredicate}) OR (${telegramAdminActivationClaimPredicate}) OR (c.support_enabled=true AND (${supportCandidatePredicate})) OR (${verificationStartPredicate}) OR (${privateStartPredicate}) OR (${privateSharedIdPredicate}) OR (${bindASendNCallbackPredicate}) OR (${privateWalletBindCallbackPredicate}) OR (${privateWalletAddressReplyPredicate}) OR (${privateEnergyBishuReplyPredicate}) OR (${monitorWalletCallbackPredicate}) OR (${monitorWalletReplyPredicate}) OR (${bindASendNAddressReplyPredicate}) OR (${privateTronAddressPredicate}) OR (${privateEvmAddressPredicate}) OR (${privateBishuDirectPurchasePredicate}) OR (${privateTronHistoryCallbackPredicate}) OR (${privateTronApprovalCommandPredicate}) OR (${privateTronApprovalCallbackPredicate}) OR (${privateOkxC2cFilterCallbackPredicate}) OR (${privateEnergyBishuCallbackPredicate}) OR (${energyBishuPackageCallbackPredicate}) OR (${energyBalancePurchaseClaimPredicate}) OR (${energyBalancePurchaseReplyClaimPredicate}) OR (${trusteeshipMyAddressCallbackPredicate}) OR (${trusteeshipAddAddressCallbackPredicate}) OR (${trusteeshipDeleteAddressCallbackPredicate}) OR (${trusteeshipEnergySettingsCallbackPredicate}) OR (${trusteeshipCancelRechargeCallbackPredicate}) OR (${premiumWalletPayClaimPredicate}) OR (${premiumCancelUnpaidClaimPredicate}) OR (${premiumChooseAgainClaimPredicate}) OR (${legacyEnergyFeeInfoCallbackPredicate}) OR (${energyPlatformPackageCallbackPredicate}) OR (${privateGoodsPurchaseCallbackPredicate}) OR (${privateGoodsSelectionCallbackPredicate}) OR (${privateGoodsPageCallbackPredicate}) OR (${trusteeshipRechargeCallbackPredicate}) OR (${trusteeshipSwapTrxCallbackPredicate}) OR (${trusteeshipMenuCallbackPredicate}) OR (${privateEnergyBishuToggleCallbackPredicate})`
const otherClaimablePredicate = `(${baseOtherClaimablePredicate}) OR (${telegramCloneProxyClaimPredicate}) OR (${premiumPackageCallbackClaimPredicate})`
const claimablePredicate = `${otherClaimablePredicate} OR (${privateCalculatorPredicate}) OR (${telegramKeyreplyClaimPredicate})`
const editedPrivateCandidatePredicate = [
  "u.update_body ? 'edited_message' AND u.update_body #>> '{edited_message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{edited_message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{edited_message,from,id}' ~ '^[0-9]{1,20}$'",
  "AND u.update_body #>> '{edited_message,chat,id}' ~ '^[0-9]{1,20}$'",
  "AND u.update_body #>> '{edited_message,message_id}' ~ '^[0-9]{1,20}$'",
].join('\n')
const forEditedMessage = (predicate: string) => predicate
  .replaceAll("u.update_body ? 'message'", "u.update_body ? 'edited_message'")
  .replaceAll('{message,', '{edited_message,')
const editedClaimablePredicate = `(${editedPrivateCandidatePredicate}) AND (${forEditedMessage(claimablePredicate)}) AND NOT (${forEditedMessage(telegramTradeStatisticsClaimPredicate)}) AND NOT (${forEditedMessage(telegramAdminActivationClaimPredicate)}) AND NOT (${forEditedMessage(premiumUsernameReplyClaimPredicate)})`
const workerClaimablePredicate = `(${claimablePredicate}) OR (${premiumUsernameReplyClaimPredicate}) OR (${editedClaimablePredicate})`

export async function telegramSupportUpdateClaimable(pool: Database, botRid: number, update: Record<string, unknown>) {
  const editedMessage = update.edited_message != null && update.message == null
  const message = (update.message ?? update.edited_message) as Message | undefined
  const isCalculator = !editedMessage && message?.chat?.type === 'private' && !message.from?.is_bot && telegramCalculatorReply(textOf(message)) !== null
  const isKeyreply = !editedMessage && !isCalculator && message?.chat?.type === 'private' && !message.from?.is_bot && await telegramKeyreplyClaimable(pool, botRid, update)
  const isPremiumUsernameReply = !editedMessage && isPremiumUsernameReplyCandidate(update as Update['update_body'])
  const predicate = editedMessage ? editedClaimablePredicate : isPremiumUsernameReply ? `(${otherClaimablePredicate}) OR (${premiumUsernameReplyClaimPredicate})` : isCalculator || isKeyreply ? claimablePredicate : otherClaimablePredicate
  const result = await pool.query<{ claimable: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM t_telegram_bot b
    LEFT JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid
    CROSS JOIN (SELECT $1::bigint AS bot_rid,$2::jsonb AS update_body) u
    WHERE b.rid=u.bot_rid AND (${predicate})
  ) AS claimable`, [botRid, JSON.stringify(update)])
  return result.rows[0]?.claimable === true
}

async function claim(pool: Database, owner: string, limit: number): Promise<Update[]> {
  const sql = [
    'WITH candidates AS (',
    ' SELECT u.rid FROM t_platform_telegram_update u',
    ' JOIN t_telegram_bot b ON b.rid=u.bot_rid',
    ' LEFT JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid',
    ` WHERE (${workerClaimablePredicate}) AND u.attempts<8`,
    " AND ((u.status IN ('pending','failed') AND u.next_attempt_at<=now()) OR (u.status='processing' AND u.lease_until<now()))",
    ' ORDER BY u.rid LIMIT $1 FOR UPDATE OF u SKIP LOCKED',
    ') UPDATE t_platform_telegram_update u SET status=\'processing\',attempts=u.attempts+1,lease_owner=$2,lease_until=now()+interval \'30 seconds\'',
    'FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body,u.received_at',
  ].join('\n')
  return (await pool.query<Update>(sql, [limit, owner])).rows
}

async function supportPluginForUpdate(pool: Database, update: Update['update_body'], botRid: number): Promise<ManagedModuleId | null> {
  if (energyBalancePurchaseCallback(update) || energyBishuPackageCallback(update) || trusteeshipMenuCallback(update) || bindASendNCallback(update) || privateEnergyBishuCallback(update) || privateEnergyBishuBindCallback(update) || privateEnergyBishuAddCallback(update) || privateEnergyBishuSearchCallback(update) || privateEnergyBishuToggleCallback(update) || trusteeshipMyAddressCallback(update) || trusteeshipAddAddressCallback(update) || trusteeshipDeleteAddressCallback(update) || trusteeshipEnergySettingsCallback(update) || trusteeshipCancelRechargeCallback(update) || trusteeshipRechargeCallback(update) || trusteeshipSwapTrxCallback(update) || energyPlatformPackageCallback(update) || legacyEnergyFeeInfoCallback(update)) return 'energy'
  if (monitorWalletCallback(update)) return 'monitor'
  if (isPremiumCallbackUpdate(update)) return 'premium'
  if (privateGoodsPageCallback(update) || privateGoodsSelectionCallback(update) || privateGoodsPurchaseCallback(update)) return 'shop'
  if (privateWalletBindCallback(update)) return 'transit'
  const message=update.message
  if(message?.chat?.type==='private' && /^(添加笔数|增加笔数)(?:\s|$)/u.test(String(message.text??'').trim()))return 'energy'
  if(message?.chat?.type==='private'&&message.reply_to_message?.message_id!=null){
    if(await isPremiumUsernameReplyForPrompt(pool,botRid,update))return 'premium'
    const state=await pool.query<{energy:boolean;transit:boolean;monitor:boolean}>(`SELECT
      EXISTS(SELECT 1 FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id::text=$2 AND user_id::text=$3 AND state IN ('bindA_address','bishu_balance_query','bishu_bind_notice','bishu_add_address','bishu_add_count','trusteeship_add_address','trusteeship_delete_address','trusteeship_usdt_to_trx') AND expires_at>now() AND prompt_message_id::text=$4) AS energy,
      EXISTS(SELECT 1 FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id::text=$2 AND user_id::text=$3 AND state='wallet_address' AND expires_at>now() AND prompt_message_id::text=$4) AS transit,
      EXISTS(SELECT 1 FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id::text=$2 AND user_id::text=$3 AND state IN ('monitor_add_address','monitor_delete_address','monitor_update_comment') AND expires_at>now() AND prompt_message_id::text=$4) AS monitor`,[botRid,String(message.chat.id),String(message.from?.id??''),String(message.reply_to_message.message_id)])
    if(state.rows[0]?.energy)return 'energy'
    if(state.rows[0]?.transit)return 'transit'
    if(state.rows[0]?.monitor)return 'monitor'
    if(String(message.reply_to_message.text??'').startsWith('请回复要购买能量的 TRON 地址（套餐：'))return 'energy'
  }
  return null
}

async function rejectDisabledPluginUpdate(pool: Database, fetcher: typeof fetch, item: Update, owner: string, pluginId: ManagedModuleId) {
  const callback=item.update_body.callback_query
  const text='此功能目前已停用，暂不接受新操作。'
  if (callback?.id) {
    const token=await botTokenFor(pool,item.bot_rid)
    await tg(fetcher,token,'answerCallbackQuery',{callback_query_id:String(callback.id),text,show_alert:true})
  } else {
    const message=item.update_body.message
    if (message?.chat?.id!=null) {
      const token=await botTokenFor(pool,item.bot_rid)
      await tg(fetcher,token,'sendMessage',{chat_id:String(message.chat.id),text,reply_to_message_id:message.message_id,allow_sending_without_reply:true})
    }
  }
  await processed(pool,item.rid,owner)
}

async function tg(fetcher: typeof fetch, token: string, method: string, payload: Record<string, unknown>): Promise<Tg> {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false }
  try {
    const r = await fetcher('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    return await r.json() as Tg
  } catch { return { ok: false } }
}
async function configFor(pool: Database, rid: number) {
  const r = await pool.query<Config>('SELECT b.bot_token,b.bot_username,b.bot_admin_username,c.support_enabled,c.support_captcha_enabled,c.support_verified_minutes,c.ad_score_threshold,c.ad_keywords FROM t_telegram_bot b JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid WHERE b.rid=$1', [rid])
  return r.rows[0]
}
function verificationStartToken(m: Message) {
  return /^\/start(?:@[a-z0-9_]+)?\s+([a-z0-9]{64})$/iu.exec(textOf(m))?.[1] ?? null
}
function isPrivateStart(m: Message) {
  return /^\/start(?:@[a-z0-9_]+)?$/iu.test(textOf(m))
}
function bindASendNCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId) return null
  if (!['bindA', 'bindABind', 'bindAUnbind'].includes(data)) return null
  return { callback, message, chatId, userId, data }
}
function privateWalletBindCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || callback?.data !== 'userbindaddress') return null
  return { chatId, userId }
}
function privateTronHistoryCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? ''), userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId) return null
  if (!/^search(usdt|trx)list(all|ain|out)T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(data)) return null
  return { callback, chatId, data }
}
async function handlePrivateTronHistory(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const callback = privateTronHistoryCallback(update)
  if (!callback) return false
  const { parseTronHistoryCallback, lookupTronTransfers } = await import('./telegram-address-lookup.server')
  const parsed = parseTronHistoryCallback(callback.data)
  if (!parsed) return false
  const botToken = await botTokenFor(pool, botRid)
  const result = await lookupTronTransfers({ pool, fetcher, address: parsed.address, kind: parsed.kind })
  const sent = await tg(fetcher, botToken, 'sendMessage', { chat_id: callback.chatId, text: result.text.slice(0, 3900), parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: result.replyMarkup })
  if (!sent.ok) throw new Error('tron_history_reply_failed')
  return true
}
function privateTronApprovalCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? ''), userId = String(callback?.from?.id ?? '')
  const match = /^查授权(T[1-9A-HJ-NP-Za-km-z]{33})$/u.exec(String(callback?.data ?? ''))
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || !match) return null
  return { callback, chatId, address: match[1] }
}
function privateOkxC2cFilterCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '').toLowerCase()
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type) || !/^[-]?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot) return null
  if (!['z0', 'z1', 'z2', 'z3'].includes(data) || !/Okex商家C2C实时top10/u.test(textOf(message))) return null
  const keyboard = message.reply_markup?.inline_keyboard
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => ['z0', 'z1', 'z2', 'z3'].includes(String(button?.callback_data ?? '').toLowerCase())))) return null
  return { callback, message, data }
}
function privateEnergyBishuMenuCallback(update: Update['update_body'], allowed: string[]) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const data = String(callback?.data ?? '')
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !allowed.includes(data)) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId }
}
function monitorWalletCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const packages = { buywalletmonitor5: 5, buywalletmonitor10: 10, buywalletmonitor20: 20, buywalletmonitor50: 50, buywalletmonitor100: 100, buywalletmonitor200: 200 } as const
  const page = data.match(/^monitorwallet_([1-9][0-9]{0,4})$/u)
  const notePage = data.match(/^monitorwalletupdate_([1-9][0-9]{0,4})$/u)
  const noteWallet = data.match(/^monitorwalletupdatewallet_([1-9][0-9]{0,9})$/u)
  const functionPage = data.match(/^monitorwalletfunc_([1-9][0-9]{0,4})$/u)
  const selectedFunctionWallet = data.match(/^monitorwalletupdatefunc_([1-9][0-9]{0,9})$/u)
  const toggle = data.match(/^monitorwalletupdatefunc(usdt|trxa|appr|mult|pled)_([1-9][0-9]{0,9})$/u)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || (!page && !notePage && !noteWallet && !functionPage && !selectedFunctionWallet && !toggle && !['monitorddaddress', 'monitordeleteaddress', 'monitorwalletbuy', ...Object.keys(packages)].includes(data))) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  const action = page ? 'list' as const : notePage ? 'note-list' as const : noteWallet ? 'select-note' as const : functionPage ? 'function-list' as const : selectedFunctionWallet ? 'select-function' as const : toggle ? 'toggle-function' as const : data === 'monitorddaddress' ? 'add' as const : data === 'monitordeleteaddress' ? 'delete' as const : data === 'monitorwalletbuy' ? 'buy' as const : 'purchase' as const
  const setting = toggle ? ({ usdt: 'monitor_usdt_transaction', trxa: 'monitor_trx_transaction', appr: 'monitor_approve_transaction', mult: 'monitor_multi_transaction', pled: 'monitor_pledge_transaction' } as const)[toggle[1] as 'usdt'|'trxa'|'appr'|'mult'|'pled'] : null
  return { callback, chatId, userId, action, page: Number(page?.[1] ?? notePage?.[1] ?? functionPage?.[1] ?? 1), walletRid: Number(noteWallet?.[1] ?? selectedFunctionWallet?.[1] ?? toggle?.[2] ?? 0), setting, packageWallets: packages[data as keyof typeof packages] ?? null }
}
function energyBishuPackageCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== 'energybishu') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, data }
}
function trusteeshipMyAddressCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== 'aitrusteeshipmyaddress') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, chatId, userId }
}
function trusteeshipAddAddressCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== 'aitrusteeshipaddaddress') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, chatId, userId }
}
function trusteeshipDeleteAddressCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== 'aitrusteeshipdeleteaddress') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, chatId, userId }
}
function trusteeshipEnergySettingsCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const selected = /^aitrusteeshipupdate_(\d{1,12})$/u.exec(data)
  const confirm = /^aitrusteeshipupdateconfirm_(\d{1,12})_([12])$/u.exec(data)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !(data === 'aitrusteeshipupdate' || selected || confirm)) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId, action: data === 'aitrusteeshipupdate' ? 'list' as const : confirm ? 'confirm' as const : 'select' as const, rid: Number(selected?.[1] ?? confirm?.[1] ?? 0), level: confirm?.[2] === '2' ? 131000 : 65000 }
}
function trusteeshipCancelRechargeCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || data !== 'cancelaitrusteeshiprechargeunpaid') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId }
}
function legacyEnergyFeeInfoCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatType = message?.chat?.type
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(chatType ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (chatType === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== '重新选择套餐energy') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback }
}
function energyPlatformPackageCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatType = message?.chat?.type
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(chatType ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (chatType === 'private' && userId !== chatId) || callback?.from?.is_bot || !/^energy_[0-9a-f]{32}$/iu.test(data)) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, chatId, data, username: String(callback?.from?.username ?? '') }
}
function privateGoodsPageCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatType = message?.chat?.type
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^buygoods([1-9][0-9]{0,9})_([1-9][0-9]{0,3})$/u.exec(data)
  if (!message || !['private', 'group', 'supergroup'].includes(chatType ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (chatType === 'private' && userId !== chatId) || callback?.from?.is_bot || !match) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId, isPrivate: chatType === 'private', goodsRid: Number(match[1]), page: Number(match[2]) }
}
function privateGoodsSelectionCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatType = message?.chat?.type
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^buygoodscdkey([1-9][0-9]{0,9})$/u.exec(data)
  if (!message || !['private', 'group', 'supergroup'].includes(chatType ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (chatType === 'private' && userId !== chatId) || callback?.from?.is_bot || !match) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId, isPrivate: chatType === 'private', cdkeyRid: Number(match[1]) }
}
function privateGoodsPurchaseCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^buygoodscdkeyconfirm(trx|usdt)([1-9][0-9]{0,9})$/u.exec(data)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !match) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId, cdkeyRid: Number(match[2]), payment: match[1] as 'trx' | 'usdt' }
}
function trusteeshipRechargeCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^aitrusteeshiprecharge(trx|usdt)(?:(10|100|500|1000|2000|5000))?$/u.exec(data)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !match) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId, coin: match[1] as 'trx' | 'usdt', amount: match[2] ? Number(match[2]) : null }
}
function trusteeshipSwapTrxCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || data !== 'aitrusteeshipusdtswaptrx') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, chatId, userId }
}
function trusteeshipMenuCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  if (!message || !['private', 'group', 'supergroup'].includes(message.chat?.type ?? '') || !/^-?\d{1,20}$/u.test(chatId) || !/^\d{1,20}$/u.test(userId) || (message.chat.type === 'private' && userId !== chatId) || callback?.from?.is_bot || data !== 'aitrusteeship') return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, data }
}
function privateEnergyBishuCallback(update: Update['update_body']) { return privateEnergyBishuMenuCallback(update, ['energybishusy']) }
function privateEnergyBishuBindCallback(update: Update['update_body']) { return privateEnergyBishuMenuCallback(update, ['energybishubind']) }
function privateEnergyBishuSearchCallback(update: Update['update_body']) { return privateEnergyBishuMenuCallback(update, ['energybishusearch']) }
function privateEnergyBishuAddCallback(update: Update['update_body']) { return privateEnergyBishuMenuCallback(update, ['energybishubalanceadd']) }
function privateEnergyBishuToggleCallback(update: Update['update_body']) {
  const callback = update?.callback_query
  const message = callback?.message
  const chatId = String(message?.chat?.id ?? '')
  const userId = String(callback?.from?.id ?? '')
  const data = String(callback?.data ?? '')
  const keyboard = message?.reply_markup?.inline_keyboard
  const match = /^togglebishu_(\d{1,12})_([YN])$/u.exec(data)
  if (!message || message.chat?.type !== 'private' || !/^\d{1,20}$/u.test(chatId) || userId !== chatId || callback?.from?.is_bot || !match) return null
  if (!Array.isArray(keyboard) || !keyboard.some((row: unknown) => Array.isArray(row) && row.some((button: any) => button?.callback_data === data))) return null
  return { callback, message, chatId, userId, rid: Number(match[1]), status: match[2] as 'Y' | 'N' }
}
async function sendPrivateTronApprovals(pool: Database, fetcher: typeof fetch, botRid: number, chatId: string, address: string, replyToMessageId?: string, callbackId?: string) {
  const token = await botTokenFor(pool, botRid)
  if (callbackId) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: callbackId })
  let messages: string[], replyMarkup: Record<string, unknown>
  try {
    const { lookupTronApprovals } = await import('./telegram-tron-approval-lookup.server')
    const result = await lookupTronApprovals({ pool, fetcher, address })
    messages = result.messages
    replyMarkup = result.replyMarkup
  } catch {
    messages = [`查询地址：<code>${address}</code>\n查询失败，请稍后重试。`]
    replyMarkup = { inline_keyboard: [[{ text: '波场链上查询', url: `https://tronscan.org/#/address/${address}` }]] }
  }
  for (const [index, text] of messages.entries()) {
    const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true }
    if (index === 0 && replyToMessageId) payload.reply_to_message_id = replyToMessageId
    if (index === messages.length - 1) payload.reply_markup = replyMarkup
    const sent = await tg(fetcher, token, 'sendMessage', payload)
    if (!sent.ok) throw new Error('tron_approval_reply_failed')
  }
}
async function handlePrivateTronApprovalCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const callback = privateTronApprovalCallback(update)
  if (!callback) return false
  await sendPrivateTronApprovals(pool, fetcher, botRid, callback.chatId, callback.address, undefined, String(callback.callback.id ?? ''))
  return true
}
async function handlePrivateTronAddress(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  const address = textOf(message)
  if (message.chat.type !== 'private' || !isTronAddressText(address)) return false
  const botToken = await botTokenFor(pool, botRid)
  const bot = await pool.query<{ bot_username: string | null }>('SELECT bot_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  let reply: { text: string; replyMarkup: Record<string, unknown> }
  try {
    const { lookupTronAddress } = await import('./telegram-address-lookup.server')
    reply = await lookupTronAddress({ pool, fetcher, address, botUsername: bot.rows[0]?.bot_username })
  } catch {
    reply = { text: `查询地址：<code>${address}</code>\n查询失败，请稍后重试。`, replyMarkup: { inline_keyboard: [] } }
  }
  const sent = await tg(fetcher, botToken, 'sendMessage', { chat_id: String(message.chat.id), text: reply.text.slice(0, 3900), parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: reply.replyMarkup })
  if (!sent.ok) throw new Error('tron_address_reply_failed')
  return true
}
async function handlePrivateEvmAddress(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  const address = textOf(message)
  if (message.chat.type !== 'private' || !/^0[xX][0-9a-fA-F]{40}$/u.test(address)) return false
  const botToken = await botTokenFor(pool, botRid)
  let result: { text: string; replyMarkup: Record<string, unknown> }
  try {
    const { lookupEvmAddress } = await import('./telegram-evm-address-lookup.server')
    result = await lookupEvmAddress({ pool, fetcher, address })
  } catch {
    result = { text: `查询：<code>${address}</code>\n查询失败，请检查 API 服务配置或稍后重试。`, replyMarkup: { inline_keyboard: [] } }
  }
  const sent = await tg(fetcher, botToken, 'sendMessage', { chat_id: String(message.chat.id), text: result.text.slice(0, 3900), parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: result.replyMarkup })
  if (!sent.ok) throw new Error('evm_address_reply_failed')
  return true
}
function isTronAddressText(value: string) { return /^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(value) }
async function bindASendNConfig(pool: Database, botRid: number) {
  return (await pool.query<{ is_enable: number; activate_threshold: string; energy_platform_bot_rid: number | null }>(
    'SELECT is_enable,activate_threshold,energy_platform_bot_rid FROM t_bind_a_send_n_config WHERE bot_rid=$1 OR bot_rid IS NULL ORDER BY (bot_rid=$1) DESC,rid DESC LIMIT 1',
    [botRid],
  )).rows[0]
}
async function sendBindASendNText(pool: Database, fetcher: typeof fetch, botRid: number, chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  const token = await botTokenFor(pool, botRid)
  const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true }
  if (replyMarkup) payload.reply_markup = replyMarkup
  const result = await tg(fetcher, token, 'sendMessage', payload)
  if (!result.ok) throw new Error('bindasendn_telegram_send_failed')
  return result.result?.message_id
}
const escapeTelegramHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
async function walletBindingReplyMarkup(pool: Database, botRid: number) {
  const result = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const username = String(result.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const buttons: Array<{ text: string; url?: string; callback_data?: string }> = []
  if (/^[a-z0-9_]{5,32}$/iu.test(username)) buttons.push({ text: '👨联系客服', url: 'https://t.me/' + username })
  buttons.push({ text: '🕐重新开始', callback_data: '/start' })
  return { inline_keyboard: [buttons] }
}
async function handlePrivateWalletBindCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const callback = privateWalletBindCallback(update)
  if (!callback) return false
  await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'wallet_address',NULL,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='wallet_address',prompt_message_id=NULL,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, callback.chatId, callback.userId],
  )
  const sent = await tg(fetcher, await botTokenFor(pool, botRid), 'sendMessage', {
    chat_id: callback.chatId,
    text: '<b>请在2分钟内回复此消息，直接回复您要绑定的波场地址</b>\n\n点击 /start 重新开始',
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { force_reply: true, input_field_placeholder: '请输入需要绑定的波场地址' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('wallet_bind_prompt_failed')
  await pool.query("UPDATE t_platform_telegram_conversation_state SET prompt_message_id=$4,updated_at=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='wallet_address'", [botRid, callback.chatId, callback.userId, String(promptMessageId)])
  return true
}
async function handlePrivateEnergyBishuCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateEnergyBishuCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text: '<b>请在2分钟内回复此消息，直接回复您要查询的波场地址</b>\n<b>查询后会回复您该地址购买的能量笔数套餐剩余次数</b>\n\n点击 /start 重新开始',
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { force_reply: true, input_field_placeholder: '请输入需要查询的波场地址' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('bishu_balance_prompt_failed')
  await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'bishu_balance_query',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='bishu_balance_query',prompt_message_id=$4,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  return true
}
async function handleTrusteeshipMyAddressCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipMyAddressCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  if (selected.message.chat.type !== 'private') {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '能量智能托管请私聊机器人！', parse_mode: 'Markdown', allow_sending_without_reply: true })
    if (!sent.ok) throw new Error('trusteeship_my_address_private_chat_failed')
    return true
  }
  const user = await pool.query<{ tg_uid: string }>('SELECT tg_uid::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
  if (!user.rows[0]) {
    const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
    const username = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const replyMarkup = /^[A-Za-z0-9_]{5,32}$/u.test(username) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${username}` }]] } : undefined
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管', allow_sending_without_reply: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('trusteeship_my_address_user_missing_failed')
    return true
  }
  const wallets = await pool.query<{ wallet_addr: string }>('SELECT wallet_addr FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid', [botRid, selected.chatId])
  let text = '<b>一个账号最大允许托管10个地址</b>\n自动监控地址能量,不足65000或者131000时,自动给与能量补足\n'
    + `当前已托管：${wallets.rows.length} 个\n`
  const icons = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']
  wallets.rows.slice(0, 9).forEach((row, index) => { text += `${icons[index]}  <code>${escapeTelegramHtml(String(row.wallet_addr))}</code>\n` })
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text,
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: [
      [
        { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
        { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
      ],
      [
        { text: '⬅️返回上一步', callback_data: 'aitrusteeship' },
        { text: '🔄刷新', callback_data: 'aitrusteeshipmyaddress' },
      ],
      [{ text: '⚙️监控能量设置', callback_data: 'aitrusteeshipupdate' }],
    ] },
  })
  if (!sent.ok) throw new Error('trusteeship_my_address_list_failed')
  return true
}
async function handleTrusteeshipAddAddressCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipAddAddressCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  if (selected.message.chat.type !== 'private') {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '能量智能托管请私聊机器人！', parse_mode: 'Markdown', allow_sending_without_reply: true })
    if (!sent.ok) throw new Error('trusteeship_add_address_private_chat_failed')
    return true
  }
  const user = await pool.query<{ tg_uid: string }>('SELECT tg_uid::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
  if (!user.rows[0]) {
    const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
    const username = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const replyMarkup = /^[A-Za-z0-9_]{5,32}$/u.test(username) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${username}` }]] } : undefined
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管', allow_sending_without_reply: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('trusteeship_add_address_user_missing_failed')
    return true
  }
  const wallets = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2', [botRid, selected.chatId])
  const total = Number(wallets.rows[0]?.total ?? 0)
  const slots = Math.max(0, 10 - total)
  const text = '<b>一个账号最大允许托管10个地址</b>\n'
    + `当前已托管：${total} 个\n`
    + (slots > 0 ? `还可以托管：${slots} 个\n<b>请在2分钟内回复此消息已激活的波场地址</b>` : '已无法添加,可删除无需托管的地址后再添加')
    + '\n\n点击 /start 重新开始'
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text,
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { force_reply: slots > 0, input_field_placeholder: slots > 0 ? '请输入需要托管的已激活波场地址' : '当前无可用数量' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('trusteeship_add_address_prompt_failed')
  if (slots > 0) await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'trusteeship_add_address',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='trusteeship_add_address',prompt_message_id=$4,context=NULL,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  else await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_add_address'", [botRid, selected.chatId, selected.userId])
  return true
}
async function handleTrusteeshipAddAddressReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id), promptMessageId = String(message.reply_to_message.message_id)
  const state = await pool.query<{ state: string }>(
    "DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_add_address' AND expires_at>now() AND prompt_message_id=$4 RETURNING state",
    [botRid, chatId, userId, promptMessageId],
  )
  if (state.rows[0]?.state !== 'trusteeship_add_address') return false
  const token = await botTokenFor(pool, botRid), address = textOf(message), safeAddress = escapeTelegramHtml(address)
  if (!isTronAddressText(address)) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `托管地址：<code>${safeAddress}</code>\n添加结果：请输入有效的波场地址！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('trusteeship_add_address_invalid_reply_failed')
    return true
  }
  const client = await (pool as Pool).connect()
  let outcome: 'added' | 'blacklisted' | 'duplicate' | 'limit' = 'added'
  let wallets: Array<{ wallet_addr: string }> = []
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-user:' || $1 || ':' || $2,0))", [botRid, chatId])
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-address:' || $1,0))", [address])
    const user = await client.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, chatId])
    if (!user.rows[0]) {
      outcome = 'limit'
    } else {
      const black = await client.query('SELECT 1 FROM t_transit_wallet_black WHERE black_wallet=$1 LIMIT 1', [address])
      const duplicate = await client.query('SELECT rid FROM t_energy_ai_trusteeship WHERE wallet_addr=$1 ORDER BY rid LIMIT 1 FOR UPDATE', [address])
      const count = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2', [botRid, chatId])
      if (black.rows[0]) outcome = 'blacklisted'
      else if (duplicate.rows[0]) outcome = 'duplicate'
      else if (Number(count.rows[0]?.total ?? 0) >= 10) outcome = 'limit'
      else {
        await client.query('INSERT INTO t_energy_ai_trusteeship(bot_rid,tg_uid,wallet_addr,status,create_by,create_time) VALUES($1,$2,$3,0,0,now())', [botRid, chatId, address])
      }
    }
    wallets = (await client.query<{ wallet_addr: string }>('SELECT wallet_addr FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid LIMIT 10', [botRid, chatId])).rows
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const resultText = outcome === 'added'
    ? '<b>智能托管地址已添加成功</b>'
    : outcome === 'blacklisted'
      ? '该地址在黑名单中，无法绑定。若地址属于您，请联系客服。'
      : outcome === 'duplicate'
        ? '该地址已存在，如果您的托管地址列表不存在，请联系客服处理。'
        : '当前托管地址已达上限，或用户信息不存在；请发送 /start 初始化后再试。'
  const numbers = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']
  const list = wallets.map((row, index) => `${numbers[index]}  <code>${escapeTelegramHtml(String(row.wallet_addr))}</code>`).join('\n')
  const text = `${resultText}\n当前已托管：${wallets.length} 个\n还可以托管：${10 - wallets.length} 个${list ? `\n${list}` : ''}`
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_to_message_id: String(message.message_id),
    reply_markup: { inline_keyboard: [
      [{ text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' }, { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' }],
      [{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }, { text: '🔄刷新', callback_data: 'aitrusteeshipmyaddress' }],
    ] },
  })
  if (!sent.ok) throw new Error('trusteeship_add_address_reply_failed')
  return true
}
async function handleTrusteeshipDeleteAddressCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipDeleteAddressCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  if (selected.message.chat.type !== 'private') {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '能量智能托管请私聊机器人！', parse_mode: 'Markdown', allow_sending_without_reply: true })
    if (!sent.ok) throw new Error('trusteeship_delete_address_private_chat_failed')
    return true
  }
  const user = await pool.query<{ tg_uid: string }>('SELECT tg_uid::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
  if (!user.rows[0]) {
    const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
    const username = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const replyMarkup = /^[A-Za-z0-9_]{5,32}$/u.test(username) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${username}` }]] } : undefined
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管', allow_sending_without_reply: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('trusteeship_delete_address_user_missing_failed')
    return true
  }
  const wallets = await pool.query<{ wallet_addr: string }>('SELECT wallet_addr FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid LIMIT 10', [botRid, selected.chatId])
  const numbers = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']
  const list = wallets.rows.map((row, index) => `${numbers[index]}  <code>${escapeTelegramHtml(String(row.wallet_addr))}</code>`).join('\n')
  const available = wallets.rows.length > 0
  const text = available
    ? `<b>请在2分钟内回复此消息需要删除的波场地址</b>\n当前已托管：${wallets.rows.length} 个\n\n点击 /start 重新开始\n${list}`
    : '<b>当前账号无托管地址</b>'
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_markup: { force_reply: available, input_field_placeholder: available ? '请输入需要删除的托管地址' : '当前无智能托管地址' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('trusteeship_delete_address_prompt_failed')
  if (available) await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'trusteeship_delete_address',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='trusteeship_delete_address',prompt_message_id=$4,context=NULL,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  else await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_delete_address'", [botRid, selected.chatId, selected.userId])
  return true
}
async function handleTrusteeshipDeleteAddressReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id), promptMessageId = String(message.reply_to_message.message_id)
  const state = await pool.query<{ state: string }>(
    "DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_delete_address' AND expires_at>now() AND prompt_message_id=$4 RETURNING state",
    [botRid, chatId, userId, promptMessageId],
  )
  if (state.rows[0]?.state !== 'trusteeship_delete_address') return false
  const token = await botTokenFor(pool, botRid), address = textOf(message), safeAddress = escapeTelegramHtml(address)
  if (!isTronAddressText(address)) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `删除地址：<code>${safeAddress}</code>\n删除结果：请输入有效的波场地址！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('trusteeship_delete_address_invalid_reply_failed')
    return true
  }
  const client = await (pool as Pool).connect()
  let deleted = false
  let wallets: Array<{ wallet_addr: string }> = []
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-user:' || $1 || ':' || $2,0))", [botRid, chatId])
    const owned = await client.query<{ rid: number }>('SELECT rid FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 AND wallet_addr=$3 ORDER BY rid LIMIT 1 FOR UPDATE', [botRid, chatId, address])
    if (owned.rows[0]) {
      const result = await client.query('DELETE FROM t_energy_ai_trusteeship WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3', [owned.rows[0].rid, botRid, chatId])
      deleted = Boolean(result.rowCount)
    }
    wallets = (await client.query<{ wallet_addr: string }>('SELECT wallet_addr FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid LIMIT 10', [botRid, chatId])).rows
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const numbers = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']
  const list = wallets.map((row, index) => `${numbers[index]}  <code>${escapeTelegramHtml(String(row.wallet_addr))}</code>`).join('\n')
  const text = `${deleted ? '<b>智能托管地址已删除成功</b>' : '该地址不存在，请输入该账号下的托管地址'}\n当前已托管：${wallets.length} 个\n还可以托管：${10 - wallets.length} 个${list ? `\n${list}` : ''}`
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_to_message_id: String(message.message_id),
    reply_markup: { inline_keyboard: [
      [{ text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' }, { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' }],
      [{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }, { text: '🔄刷新', callback_data: 'aitrusteeshipmyaddress' }],
    ] },
  })
  if (!sent.ok) throw new Error('trusteeship_delete_address_reply_failed')
  return true
}
function monitorWalletInlineKeyboard(botAdminUsername: unknown) {
  const admin = String(botAdminUsername ?? '').replace(/^@/u, '')
  return { inline_keyboard: [
    [{ text: '➕添加监控地址', callback_data: 'monitorddaddress' }, { text: '➖删除监控地址', callback_data: 'monitordeleteaddress' }],
    [{ text: '⬅️返回上一步', callback_data: 'monitorwallet_1' }, ...( /^[A-Za-z0-9_]{5,32}$/u.test(admin) ? [{ text: '👨联系客服', url: `https://t.me/${admin}` }] : [])],
  ] }
}
async function monitorWalletQuota(pool: Database, botRid: number, userId: string) {
  const [user, quota, wallets] = await Promise.all([
    pool.query<{ max_monitor_wallet: number }>('SELECT max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, userId]),
    pool.query<{ free_limit: number }>('SELECT COALESCE((SELECT free_monitor_wallet FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1),4)::int AS free_limit', [botRid]),
    pool.query<{ monitor_wallet: string }>('SELECT monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC', [botRid, userId]),
  ])
  const freeLimit = Math.max(0, Number(quota.rows[0]?.free_limit ?? 4))
  const totalLimit = Math.max(0, Number(user.rows[0]?.max_monitor_wallet ?? 0)) + freeLimit
  const used = wallets.rows.length
  return { exists: Boolean(user.rows[0]), used, totalLimit, remaining: Math.max(0, totalLimit - used), wallets: wallets.rows }
}
function monitorWalletPageMarkup(page: number, totalPages: number, contact: string | null) {
  const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
    [{ text: '➕添加监控地址', callback_data: 'monitorddaddress' }, { text: '➖删除监控地址', callback_data: 'monitordeleteaddress' }],
    [{ text: '💎购买监控包', callback_data: 'monitorwalletbuy' }, ...(contact ? [{ text: '👨联系客服', url: `https://t.me/${contact}` }] : [])],
  ]
  const navigation: Array<{ text: string; callback_data: string }> = []
  if (page > 1) navigation.push({ text: '⬅️上一页', callback_data: `monitorwallet_${page - 1}` })
  if (page < totalPages) navigation.push({ text: '➡️下一页', callback_data: `monitorwallet_${page + 1}` })
  navigation.push({ text: '🛠修改监控', callback_data: 'monitorwalletfunc_1' })
  if (navigation.length) rows.push(navigation)
  return { inline_keyboard: rows }
}
async function monitorWalletListing(pool: Database, fetcher: typeof fetch, token: string, botRid: number, chatId: string, page: number) {
  const user = await pool.query<{ cash_trx: string; cash_usdt: string; max_monitor_wallet: number }>('SELECT cash_trx::text,cash_usdt::text,max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, chatId])
  if (!user.rows[0]) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控' })
    if (!sent.ok) throw new Error('monitor_wallet_user_missing_failed')
    return
  }
  const [quota, total, admin] = await Promise.all([
    pool.query<{ free_limit: number }>('SELECT COALESCE((SELECT free_monitor_wallet FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1),4)::int AS free_limit', [botRid]),
    pool.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId]),
    pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid]),
  ])
  const count = Number(total.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(count / 10))
  const currentPage = Math.min(Math.max(page, 1), totalPages)
  const offset = (currentPage - 1) * 10
  const wallets = await pool.query<{ monitor_wallet: string }>('SELECT monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 10 OFFSET $3', [botRid, chatId, offset])
  const free = Math.max(0, Number(quota.rows[0]?.free_limit ?? 4))
  const purchased = Math.max(0, Number(user.rows[0].max_monitor_wallet) || 0)
  const remaining = Math.max(0, purchased + free - count)
  const list = wallets.rows.map(row => `  <code>${escapeTelegramHtml(row.monitor_wallet)}</code>`).join('\n')
  const username = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const contact = /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username : null
  const text = `<b>TRX余额为：</b><code>${escapeTelegramHtml(user.rows[0].cash_trx)} TRX</code>\n<b>USDT余额为：</b><code>${escapeTelegramHtml(user.rows[0].cash_usdt)} USDT</code>\n\n<b>剩余可监控数量：</b><code>${remaining}</code>\n<b>可点击下方购买监控套餐！</b>\n当前已监控地址：${count} 个${totalPages > 1 ? `（${currentPage}/${totalPages}）` : ''}${list ? `\n${list}` : ''}`
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: monitorWalletPageMarkup(currentPage, totalPages, contact) })
  if (!sent.ok) throw new Error('monitor_wallet_list_failed')
}
async function monitorWalletFunctionList(pool: Database, fetcher: typeof fetch, token: string, botRid: number, chatId: string, page: number) {
  const user = await pool.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, chatId])
  if (!user.rowCount) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控' })
    if (!sent.ok) throw new Error('monitor_wallet_user_missing_failed')
    return
  }
  const total = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId])
  const count = Number(total.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(count / 10))
  const currentPage = Math.min(Math.max(page, 1), totalPages)
  const wallets = await pool.query<{ rid: number; monitor_wallet: string }>('SELECT rid,monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 10 OFFSET $3', [botRid, chatId, (currentPage - 1) * 10])
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = wallets.rows.map(row => [{ text: row.monitor_wallet, callback_data: `monitorwalletupdatefunc_${row.rid}` }])
  const navigation: Array<{ text: string; callback_data: string }> = []
  if (currentPage > 1) navigation.push({ text: '⬅️上一页', callback_data: `monitorwalletfunc_${currentPage - 1}` })
  if (currentPage < totalPages) navigation.push({ text: '➡️下一页', callback_data: `monitorwalletfunc_${currentPage + 1}` })
  if (navigation.length) keyboard.push(navigation)
  keyboard.push([{ text: '↩️返回监控列表', callback_data: 'monitorwallet_1' }])
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `当前已监控地址：${count} 个\n请选择要设置的监控钱包${totalPages > 1 ? `（${currentPage}/${totalPages}）` : ''}`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: { inline_keyboard: keyboard } })
  if (!sent.ok) throw new Error('monitor_wallet_function_list_failed')
}
async function monitorWalletNoteList(pool: Database, fetcher: typeof fetch, token: string, botRid: number, chatId: string, page: number) {
  const user = await pool.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, chatId])
  if (!user.rowCount) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控' })
    if (!sent.ok) throw new Error('monitor_wallet_note_user_missing_failed')
    return
  }
  const total = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId])
  const count = Number(total.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(count / 10))
  const currentPage = Math.min(Math.max(page, 1), totalPages)
  const wallets = await pool.query<{ rid: number; monitor_wallet: string; comments: string | null }>(
    'SELECT rid,monitor_wallet,comments FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 10 OFFSET $3',
    [botRid, chatId, (currentPage - 1) * 10],
  )
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = wallets.rows.map(row => {
    const address = String(row.monitor_wallet)
    const note = String(row.comments ?? '').trim()
    const label = note ? `${address.slice(0, 34)} · ${note}` : address
    return [{ text: Array.from(label).slice(0, 64).join(''), callback_data: `monitorwalletupdatewallet_${row.rid}` }]
  })
  const navigation: Array<{ text: string; callback_data: string }> = []
  if (currentPage > 1) navigation.push({ text: '⬅️上一页', callback_data: `monitorwalletupdate_${currentPage - 1}` })
  if (currentPage < totalPages) navigation.push({ text: '➡️下一页', callback_data: `monitorwalletupdate_${currentPage + 1}` })
  if (navigation.length) keyboard.push(navigation)
  keyboard.push([{ text: '↩️返回监控列表', callback_data: 'monitorwallet_1' }])
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: chatId,
    text: `当前已监控地址：${count} 个\n请选择要修改备注的钱包${totalPages > 1 ? `（${currentPage}/${totalPages}）` : ''}`,
    parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: keyboard },
  })
  if (!sent.ok) throw new Error('monitor_wallet_note_list_failed')
}
async function handleMonitorWalletNoteSelection(pool: Database, fetcher: typeof fetch, token: string, botRid: number, chatId: string, userId: string, walletRid: number) {
  const user = await pool.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, userId])
  if (!user.rowCount) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控' })
    if (!sent.ok) throw new Error('monitor_wallet_note_user_missing_failed')
    return
  }
  const wallet = await pool.query<{ monitor_wallet: string }>(
    'SELECT monitor_wallet FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3 LIMIT 1',
    [walletRid, botRid, chatId],
  )
  if (!wallet.rows[0]) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '钱包已不存在或不属于当前账号，请重新选择。' })
    if (!sent.ok) throw new Error('monitor_wallet_note_missing_failed')
    return
  }
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: chatId,
    text: `正在设置地址：<code>${escapeTelegramHtml(wallet.rows[0].monitor_wallet)}</code>\n<b>请在2分钟内回复此消息，输入50个汉字内的备注</b>\n<b>直接发送文字无效</b>\n\n点击 /start 重新开始`,
    parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_markup: { force_reply: true, input_field_placeholder: '请输入备注,不超过50个汉字' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('monitor_wallet_note_prompt_failed')
  await pool.query(
    `INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,context,expires_at) VALUES($1,$2,$3,'monitor_update_comment',$4,$5::jsonb,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='monitor_update_comment',prompt_message_id=$4,context=$5::jsonb,expires_at=now()+interval '2 minutes',updated_at=now()`,
    [botRid, chatId, userId, String(promptMessageId), JSON.stringify({ walletRid })],
  )
}
async function handleMonitorWalletCommentReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return null
  const chatId = String(message.chat.id), userId = String(message.from.id), promptMessageId = String(message.reply_to_message.message_id)
  const state = await pool.query<{ context: { walletRid?: unknown } | string | null }>(
    "SELECT context FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='monitor_update_comment' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, promptMessageId],
  )
  if (!state.rows[0]) return null
  const context = typeof state.rows[0].context === 'string' ? JSON.parse(state.rows[0].context) : state.rows[0].context
  const walletRid = Number(context?.walletRid)
  if (!Number.isSafeInteger(walletRid) || walletRid <= 0) return null
  const comment = Array.from(textOf(message)).slice(0, 50).join('')
  const updated = await pool.query<{ monitor_wallet: string }>(
    'UPDATE t_monitor_wallet SET comments=$1 WHERE rid=$2 AND bot_rid=$3 AND tg_notice_obj=$4 RETURNING monitor_wallet',
    [comment, walletRid, botRid, chatId],
  )
  const token = await botTokenFor(pool, botRid)
  const text = updated.rows[0]
    ? `备注修改成功：<code>${escapeTelegramHtml(updated.rows[0].monitor_wallet)}</code>\n备注：${escapeTelegramHtml(comment || '（空）')}`
    : '钱包已不存在或不属于当前账号，请重新选择。'
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
  if (!sent.ok) throw new Error('monitor_wallet_note_reply_failed')
  return { chatId, userId, promptMessageId }
}
async function processedMonitorWalletComment(pool: Database, updateRid: number, owner: string, state: { chatId: string; userId: string; promptMessageId: string }) {
  const client = await (pool as Pool).connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=(SELECT bot_rid FROM t_platform_telegram_update WHERE rid=$1) AND chat_id=$2 AND user_id=$3 AND state='monitor_update_comment' AND prompt_message_id=$4", [updateRid, state.chatId, state.userId, state.promptMessageId])
    await client.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [updateRid, owner])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}
async function monitorWalletFunctionDetails(pool: Database, fetcher: typeof fetch, token: string, botRid: number, chatId: string, walletRid: number, updateRid: number, callbackId: string, setting: string | null) {
  const flags = ['monitor_usdt_transaction', 'monitor_trx_transaction', 'monitor_approve_transaction', 'monitor_multi_transaction', 'monitor_pledge_transaction'] as const
  type Wallet = { rid: number; monitor_wallet: string; monitor_usdt_transaction: string; monitor_trx_transaction: string; monitor_approve_transaction: string; monitor_multi_transaction: string; monitor_pledge_transaction: string }
  if (setting) {
    const client = await (pool as Pool).connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-monitor-wallet-toggle:' || $1,0))", [callbackId || String(updateRid)])
      const prior = await client.query('SELECT update_rid FROM t_platform_telegram_monitor_wallet_toggle WHERE update_rid=$1 OR ($2<>\'\' AND callback_query_id=$2) LIMIT 1', [updateRid, callbackId])
      if (!prior.rowCount) {
        const current = await client.query<Wallet>(`SELECT rid,monitor_wallet,${flags.join(',')} FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3 FOR UPDATE`, [walletRid, botRid, chatId])
        if (!current.rows[0]) { await client.query('ROLLBACK'); await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '钱包已不存在或不属于当前账号，请重新选择。' }); return }
        const before = current.rows[0][setting as typeof flags[number]]
        const after = before === 'YY' ? 'NN' : 'YY'
        await client.query(`UPDATE t_monitor_wallet SET ${setting}=$1,update_time=now() WHERE rid=$2 AND bot_rid=$3 AND tg_notice_obj=$4`, [after, walletRid, botRid, chatId])
        await client.query('INSERT INTO t_platform_telegram_monitor_wallet_toggle(update_rid,callback_query_id,bot_rid,chat_id,wallet_rid,setting,before_value,after_value) VALUES($1,NULLIF($2,\'\'),$3,$4,$5,$6,$7,$8)', [updateRid, callbackId, botRid, chatId, walletRid, setting, before, after])
      }
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  const current = await pool.query<Wallet>(`SELECT rid,monitor_wallet,${flags.join(',')} FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3 LIMIT 1`, [walletRid, botRid, chatId])
  const wallet = current.rows[0]
  if (!wallet) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: '钱包已不存在或不属于当前账号，请重新选择。' })
    if (!sent.ok) throw new Error('monitor_wallet_not_found_failed')
    return
  }
  const status = (value: string) => value === 'YY' ? '✅已开启' : '❌已关闭'
  const text = `正在设置地址：<code>${escapeTelegramHtml(wallet.monitor_wallet)}</code>\n当前地址监控功能如下：\nUSDT交易监听：<u>${status(wallet.monitor_usdt_transaction)}</u>\nTRX交易监听：<u>${status(wallet.monitor_trx_transaction)}</u>\n授权监听：<u>${status(wallet.monitor_approve_transaction)}</u>\n多签监听：<u>${status(wallet.monitor_multi_transaction)}</u>\n能量监听：<u>${status(wallet.monitor_pledge_transaction)}</u>\n\n<b>点击下面功能即可开启/关闭功能</b>`
  const controls = [
    [{ text: 'USDT交易监听', callback_data: `monitorwalletupdatefuncusdt_${wallet.rid}` }, { text: 'TRX交易监听', callback_data: `monitorwalletupdatefunctrxa_${wallet.rid}` }],
    [{ text: '授权监听', callback_data: `monitorwalletupdatefuncappr_${wallet.rid}` }, { text: '多签监听', callback_data: `monitorwalletupdatefuncmult_${wallet.rid}` }, { text: '能量监听', callback_data: `monitorwalletupdatefuncpled_${wallet.rid}` }],
    [{ text: '↩️返回监控列表', callback_data: 'monitorwallet_1' }],
  ]
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: { inline_keyboard: controls } })
  if (!sent.ok) throw new Error('monitor_wallet_function_details_failed')
}
async function handleMonitorWalletCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body'], updateRid: number) {
  const selected = monitorWalletCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  if (selected.action === 'purchase') return false
  if (selected.action === 'list') { await monitorWalletListing(pool, fetcher, token, botRid, selected.chatId, selected.page); return true }
  if (selected.action === 'note-list') { await monitorWalletNoteList(pool, fetcher, token, botRid, selected.chatId, selected.page); return true }
  if (selected.action === 'select-note') {
    if (!selected.walletRid) return false
    await handleMonitorWalletNoteSelection(pool, fetcher, token, botRid, selected.chatId, selected.userId, selected.walletRid)
    return true
  }
  if (selected.action === 'function-list') { await monitorWalletFunctionList(pool, fetcher, token, botRid, selected.chatId, selected.page); return true }
  if (selected.action === 'select-function' || selected.action === 'toggle-function') {
    if (!selected.walletRid) return false
    await monitorWalletFunctionDetails(pool, fetcher, token, botRid, selected.chatId, selected.walletRid, updateRid, String(selected.callback.id ?? ''), selected.action === 'toggle-function' ? selected.setting : null)
    return true
  }
  if (selected.action === 'buy') {
    const [user, config, admin] = await Promise.all([
      pool.query<{ cash_trx: string | number; cash_usdt: string | number; max_monitor_wallet: number }>('SELECT cash_trx::text,cash_usdt::text,max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId]),
      pool.query<{ free_monitor_wallet: number; price_usdt_5: string | number; price_usdt_10: string | number; price_usdt_20: string | number; price_usdt_50: string | number; price_usdt_100: string | number; price_usdt_200: string | number }>('SELECT free_monitor_wallet,price_usdt_5::text,price_usdt_10::text,price_usdt_20::text,price_usdt_50::text,price_usdt_100::text,price_usdt_200::text FROM t_monitor_bot WHERE bot_rid=$1 AND status=0 LIMIT 1', [botRid]),
      pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid]),
    ])
    const adminName = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const contact = /^[A-Za-z0-9_]{5,32}$/u.test(adminName) ? { text: '👨联系客服', url: `https://t.me/${adminName}` } : null
    const markup = contact ? { inline_keyboard: [[contact]] } : undefined
    const record = user.rows[0]
    const monitorBot = config.rows[0]
    const monitorCount = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, selected.chatId])
    const count = Number(monitorCount.rows[0]?.count ?? 0)
    let text = record
      ? `<b>TRX余额为：</b><code>${escapeTelegramHtml(String(record.cash_trx))} TRX</code>\n<b>USDT余额为：</b><code>${escapeTelegramHtml(String(record.cash_usdt))} USDT</code>\n\n<b>总可监控数量：</b><code>${Math.max(0, Number(record.max_monitor_wallet) || 0) + Math.max(0, Number(monitorBot?.free_monitor_wallet ?? 4))}</code>\n<b>剩余可监控数量：</b><code>${Math.max(0, Number(record.max_monitor_wallet) + Number(monitorBot?.free_monitor_wallet ?? 4) - count)}</code>\n<b>点击下方购买监控套餐数量！</b>`
      : '用户信息为空，请发送 /start 初始化用户，然后再进行购买'
    const buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>> = []
    if (record && monitorBot) {
      const choices = [5, 10, 20, 50, 100, 200] as const
      for (const amount of choices) {
        const price = monitorBot[`price_usdt_${amount}` as keyof typeof monitorBot]
        if (Number(price) <= 0) continue
        const row = buttons.at(-1)
        if (!row || row.length >= 3) buttons.push([])
        buttons.at(-1)!.push({ text: `🔥${amount}个(${Number(price)} U)`, callback_data: `buywalletmonitor${amount}` })
      }
    } else if (record && !monitorBot) text = '<b>当前机器人未配置监控套餐，请联系管理员</b>'
    if (buttons.length || contact) buttons.push([{ text: '⬅️返回上一步', callback_data: 'monitorwallet_1' }, ...(contact ? [contact] : [])])
    const replyMarkup = buttons.length ? { inline_keyboard: buttons } : markup
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('monitor_wallet_buy_menu_failed')
    return true
  }
  const [quota, admin] = await Promise.all([
    monitorWalletQuota(pool, botRid, selected.chatId),
    pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid]),
  ])
  if (!quota.exists) {
    const username = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const support = /^[A-Za-z0-9_]{5,32}$/u.test(username) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${username}` }]] } : undefined
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行钱包监控', allow_sending_without_reply: true, ...(support ? { reply_markup: support } : {}) })
    if (!sent.ok) throw new Error('monitor_wallet_user_missing_failed')
    return true
  }
  const adding = selected.action === 'add'
  const available = adding ? quota.remaining > 0 : quota.used > 0
  const walletList = quota.wallets.slice(0, 30).map(row => `  <code>${escapeTelegramHtml(String(row.monitor_wallet))}</code>`).join('\n')
  const text = adding
    ? `<b>当前已监控：</b>${quota.used} 个\n${available ? `还可以监控：${quota.remaining} 个\n<b>请在2分钟内回复此消息波场地址</b>` : '已无法添加，可购买监控包或者删除无需监控的地址后再添加'}\n\n点击 /start 重新开始`
    : available
      ? `<b>请在2分钟内回复此消息需要删除的波场监控地址</b>\n当前已监控：${quota.used} 个\n剩余可监控：${quota.remaining} 个\n\n点击 /start 重新开始\n${walletList}`
      : '<b>当前账号无监控地址</b>'
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true,
    reply_markup: { force_reply: available, input_field_placeholder: available ? (adding ? '请输入需要监控的波场地址' : '请输入需要删除的监控地址') : (adding ? '当前无可用数量' : '当前无监控地址') },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('monitor_wallet_prompt_failed')
  const state = adding ? 'monitor_add_address' : 'monitor_delete_address'
  if (available) await pool.query(
    `INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'${state}',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='${state}',prompt_message_id=$4,context=NULL,expires_at=now()+interval '2 minutes',updated_at=now()`,
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  else await pool.query('DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state=$4', [botRid, selected.chatId, selected.userId, state])
  return true
}
function scaledDecimal(value: bigint, scale: number) {
  const divisor = 10n ** BigInt(scale)
  return `${value / divisor}.${String(value % divisor).padStart(scale, '0')}`
}
async function handleMonitorWalletPackageCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body'], updateRid: number) {
  const selected = monitorWalletCallback(update)
  if (!selected || selected.action !== 'purchase' || selected.packageWallets == null) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const callbackId = String(selected.callback.id ?? '')
  const client = await (pool as Pool).connect()
  type Purchase = { outcome: string; package_wallets: number; price_usdt: string | null; balance_before: string | null; balance_after: string | null; quota_before: number | null; quota_after: number | null }
  let purchase: Purchase
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-monitor-wallet-purchase:' || $1,0))", [callbackId || String(updateRid)])
    const prior = await client.query<Purchase>('SELECT outcome,package_wallets,price_usdt::text,balance_before::text,balance_after::text,quota_before,quota_after FROM t_platform_telegram_monitor_wallet_purchase WHERE update_rid=$1 OR ($2<>\'\' AND callback_query_id=$2) LIMIT 1 FOR UPDATE', [updateRid, callbackId])
    if (prior.rows[0]) {
      purchase = prior.rows[0]
      await client.query('COMMIT')
    } else {
      const user = await client.query<{ rid: number; cash_usdt: string; max_monitor_wallet: number }>('SELECT rid,cash_usdt::text,max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, selected.chatId])
      if (!user.rows[0]) {
        purchase = { outcome: 'user_missing', package_wallets: selected.packageWallets, price_usdt: null, balance_before: null, balance_after: null, quota_before: null, quota_after: null }
      } else {
        const config = await client.query<Record<string, string>>('SELECT price_usdt_5::text,price_usdt_10::text,price_usdt_20::text,price_usdt_50::text,price_usdt_100::text,price_usdt_200::text FROM t_monitor_bot WHERE bot_rid=$1 AND status=0 LIMIT 1', [botRid])
        const priceText = config.rows[0]?.[`price_usdt_${selected.packageWallets}`]
        const priceUnits = scaledUnits(priceText, 6)
        const balanceUnits = scaledUnits(user.rows[0].cash_usdt, 6)
        const quotaBefore = Math.max(0, Number(user.rows[0].max_monitor_wallet) || 0)
        if (priceUnits == null || priceUnits <= 0n) {
          purchase = { outcome: 'package_unavailable', package_wallets: selected.packageWallets, price_usdt: null, balance_before: user.rows[0].cash_usdt, balance_after: user.rows[0].cash_usdt, quota_before: quotaBefore, quota_after: quotaBefore }
        } else if (balanceUnits == null || balanceUnits < priceUnits) {
          purchase = { outcome: 'insufficient_balance', package_wallets: selected.packageWallets, price_usdt: scaledDecimal(priceUnits, 6), balance_before: user.rows[0].cash_usdt, balance_after: user.rows[0].cash_usdt, quota_before: quotaBefore, quota_after: quotaBefore }
        } else {
          const balanceAfter = balanceUnits - priceUnits
          const quotaAfter = quotaBefore + selected.packageWallets
          await client.query('UPDATE t_telegram_bot_user SET cash_usdt=$1,max_monitor_wallet=$2 WHERE rid=$3 AND bot_rid=$4 AND tg_uid=$5', [scaledDecimal(balanceAfter, 6), quotaAfter, user.rows[0].rid, botRid, selected.chatId])
          purchase = { outcome: 'purchased', package_wallets: selected.packageWallets, price_usdt: scaledDecimal(priceUnits, 6), balance_before: user.rows[0].cash_usdt, balance_after: scaledDecimal(balanceAfter, 6), quota_before: quotaBefore, quota_after: quotaAfter }
        }
      }
      await client.query('INSERT INTO t_platform_telegram_monitor_wallet_purchase(update_rid,callback_query_id,bot_rid,chat_id,package_wallets,price_usdt,outcome,balance_before,balance_after,quota_before,quota_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [updateRid, callbackId || null, botRid, selected.chatId, purchase.package_wallets, purchase.price_usdt, purchase.outcome, purchase.balance_before, purchase.balance_after, purchase.quota_before, purchase.quota_after])
      await client.query('COMMIT')
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>> = []
  const adminName = String(admin.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const support = /^[A-Za-z0-9_]{5,32}$/u.test(adminName) ? { text: '👨联系客服', url: `https://t.me/${adminName}` } : null
  let text: string
  if (purchase.outcome === 'purchased') text = `恭喜您！监控套餐购买成功！\n扣除USDT：${escapeTelegramHtml(String(purchase.price_usdt))}\n增加监控数量：${purchase.package_wallets}`
  else if (purchase.outcome === 'user_missing') text = '用户信息为空，请发送 /start 初始化用户，然后再购买监控套餐'
  else if (purchase.outcome === 'package_unavailable') text = '对应无监控套餐，请联系客服！'
  else {
    text = 'USDT余额不足，请充值USDT！'
    buttons.push(
      [{ text: '10 USDT', callback_data: 'aitrusteeshiprechargeusdt10' }, { text: '100 USDT', callback_data: 'aitrusteeshiprechargeusdt100' }, { text: '500 USDT', callback_data: 'aitrusteeshiprechargeusdt500' }],
      [{ text: '1000 USDT', callback_data: 'aitrusteeshiprechargeusdt1000' }, { text: '2000 USDT', callback_data: 'aitrusteeshiprechargeusdt2000' }, { text: '5000 USDT', callback_data: 'aitrusteeshiprechargeusdt5000' }],
    )
  }
  buttons.push([{ text: '⬅️返回上一步', callback_data: 'monitorwallet_1' }, ...(support ? [support] : [])])
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: { inline_keyboard: buttons } })
  if (!sent.ok) throw new Error('monitor_wallet_purchase_reply_failed')
  return true
}
async function consumeMonitorWalletReply(pool: Database, botRid: number, message: Message, stateName: 'monitor_add_address' | 'monitor_delete_address') {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const state = await pool.query<{ state: string }>(
    'DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state=$4 AND expires_at>now() AND prompt_message_id=$5 RETURNING state',
    [botRid, String(message.chat.id), String(message.from.id), stateName, String(message.reply_to_message.message_id)],
  )
  return state.rows[0]?.state === stateName
}
async function handleMonitorWalletAddReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (!await consumeMonitorWalletReply(pool, botRid, message, 'monitor_add_address')) return false
  const chatId = String(message.chat.id), address = textOf(message), safeAddress = escapeTelegramHtml(address), token = await botTokenFor(pool, botRid)
  if (!isTronAddressText(address)) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `监控地址：<code>${safeAddress}</code>\n添加结果：请输入有效的波场地址！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('monitor_wallet_add_invalid_reply_failed')
    return true
  }
  const client = await (pool as Pool).connect()
  let outcome: 'added' | 'blacklisted' | 'duplicate' | 'limit' | 'user_missing' = 'added'
  let wallets: Array<{ monitor_wallet: string }> = [], remaining = 0
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-monitor-wallet-user:' || $1 || ':' || $2,0))", [botRid, chatId])
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-monitor-wallet-address:' || $1,0))", [address])
    const user = await client.query<{ max_monitor_wallet: number }>('SELECT max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, chatId])
    if (!user.rows[0]) outcome = 'user_missing'
    else {
      const blacklist = await client.query('SELECT rid FROM t_transit_wallet_black WHERE black_wallet=$1 LIMIT 1', [address])
      const duplicate = await client.query('SELECT rid FROM t_monitor_wallet WHERE monitor_wallet=$1 ORDER BY rid LIMIT 1 FOR UPDATE', [address])
      const count = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId])
      const free = await client.query<{ free_limit: number }>('SELECT COALESCE((SELECT free_monitor_wallet FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1),4)::int AS free_limit', [botRid])
      const totalLimit = Math.max(0, Number(user.rows[0].max_monitor_wallet ?? 0)) + Math.max(0, Number(free.rows[0]?.free_limit ?? 4))
      const used = Number(count.rows[0]?.total ?? 0)
      if (blacklist.rows[0]) outcome = 'blacklisted'
      else if (duplicate.rows[0]) outcome = 'duplicate'
      else if (used >= totalLimit) outcome = 'limit'
      else await client.query("INSERT INTO t_monitor_wallet(chain_type,monitor_wallet,status,bot_rid,tg_notice_obj,create_time) VALUES('trc',$1,0,$2,$3,now())", [address, botRid, chatId])
    }
    const after = await client.query<{ monitor_wallet: string }>('SELECT monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 30', [botRid, chatId])
    wallets = after.rows
    if (user.rows[0]) {
      const free = await client.query<{ free_limit: number }>('SELECT COALESCE((SELECT free_monitor_wallet FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1),4)::int AS free_limit', [botRid])
      const limit = Math.max(0, Number(user.rows[0].max_monitor_wallet ?? 0)) + Math.max(0, Number(free.rows[0]?.free_limit ?? 4))
      const count = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId])
      remaining = Math.max(0, limit - Number(count.rows[0]?.total ?? 0))
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const resultText = outcome === 'added' ? '<b>监控钱包地址已添加成功</b>' : outcome === 'blacklisted' ? `地址:<code>${safeAddress}</code> 为禁止地址(黑钱包)，如果该地址为您的真实地址，请联系客服` : outcome === 'duplicate' ? '该地址已存在，如果您的监控地址列表不存在，请联系客服处理' : outcome === 'limit' ? '监控额度已用完；请删除无需监控的地址或购买监控包' : '用户信息为空，请发送 /start 初始化用户后再试'
  const text = `${resultText}\n当前已监控：${wallets.length} 个\n还可以监控：${remaining} 个${wallets.length ? `\n最近添加：\n${wallets.map(row => `  <code>${escapeTelegramHtml(row.monitor_wallet)}</code>`).join('\n')}` : ''}`
  const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 3900), parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: monitorWalletInlineKeyboard(admin.rows[0]?.bot_admin_username) })
  if (!sent.ok) throw new Error('monitor_wallet_add_reply_failed')
  return true
}
async function handleMonitorWalletDeleteReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (!await consumeMonitorWalletReply(pool, botRid, message, 'monitor_delete_address')) return false
  const chatId = String(message.chat.id), address = textOf(message), safeAddress = escapeTelegramHtml(address), token = await botTokenFor(pool, botRid)
  if (!isTronAddressText(address)) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `删除地址：<code>${safeAddress}</code>\n删除结果：请输入有效的波场地址！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('monitor_wallet_delete_invalid_reply_failed')
    return true
  }
  const client = await (pool as Pool).connect()
  let deleted = false, used = 0, remaining = 0
  let wallets: Array<{ monitor_wallet: string }> = []
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-monitor-wallet-user:' || $1 || ':' || $2,0))", [botRid, chatId])
    const user = await client.query<{ max_monitor_wallet: number }>('SELECT max_monitor_wallet FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, chatId])
    const owned = await client.query<{ rid: number }>('SELECT rid FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 AND monitor_wallet=$3 ORDER BY rid LIMIT 1 FOR UPDATE', [botRid, chatId, address])
    if (owned.rows[0]) {
      const result = await client.query('DELETE FROM t_monitor_wallet WHERE rid=$1 AND bot_rid=$2 AND tg_notice_obj=$3', [owned.rows[0].rid, botRid, chatId])
      deleted = Boolean(result.rowCount)
    }
    const after = await client.query<{ monitor_wallet: string }>('SELECT monitor_wallet FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2 ORDER BY rid DESC LIMIT 30', [botRid, chatId])
    wallets = after.rows
    used = Number((await client.query<{ total: number }>('SELECT count(*)::int AS total FROM t_monitor_wallet WHERE bot_rid=$1 AND tg_notice_obj=$2', [botRid, chatId])).rows[0]?.total ?? 0)
    const free = await client.query<{ free_limit: number }>('SELECT COALESCE((SELECT free_monitor_wallet FROM t_monitor_bot WHERE bot_rid=$1 LIMIT 1),4)::int AS free_limit', [botRid])
    const limit = Math.max(0, Number(user.rows[0]?.max_monitor_wallet ?? 0)) + Math.max(0, Number(free.rows[0]?.free_limit ?? 4))
    remaining = Math.max(0, limit - used)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const admin = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const list = wallets.map(row => `  <code>${escapeTelegramHtml(row.monitor_wallet)}</code>`).join('\n')
  const text = `${deleted ? '<b>监控地址已删除成功</b>' : '该地址不存在，请输入该账号下的监控地址'}\n当前已监控：${used} 个\n还可以监控：${remaining} 个${list ? `\n最近添加：\n${list}` : ''}`
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 3900), parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: monitorWalletInlineKeyboard(admin.rows[0]?.bot_admin_username) })
  if (!sent.ok) throw new Error('monitor_wallet_delete_reply_failed')
  return true
}
async function handleTrusteeshipEnergySettingsCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipEnergySettingsCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const user = await pool.query<{ tg_uid: string }>('SELECT tg_uid::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
  if (!user.rows[0]) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管', allow_sending_without_reply: true })
    if (!sent.ok) throw new Error('trusteeship_energy_settings_user_missing_failed')
    return true
  }
  let text = ''
  let keyboard: Array<Array<{ text: string; callback_data: string }>> = []
  if (selected.action === 'list') {
    const wallets = await pool.query<{ rid: number; wallet_addr: string; min_energy_quantity: number }>('SELECT rid,wallet_addr,min_energy_quantity FROM t_energy_ai_trusteeship WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid LIMIT 10', [botRid, selected.chatId])
    if (!wallets.rows.length) {
      text = '<b>一个账号最大允许托管10个地址</b>\n当前已托管：0 个，请先添加后再修改设置。'
      keyboard = [
        [{ text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' }, { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' }],
        [{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }, { text: '🔄刷新', callback_data: 'aitrusteeshipmyaddress' }],
      ]
    } else {
      text = `当前已智能托管地址：${wallets.rows.length} 个\n请选择需要设置的地址。支持 65,000 或 131,000 能量。`
      keyboard = wallets.rows.map(wallet => [{ text: `${wallet.wallet_addr} 托管:${wallet.min_energy_quantity}`, callback_data: `aitrusteeshipupdate_${wallet.rid}` }])
      keyboard.push([{ text: '↩️返回托管列表', callback_data: 'aitrusteeshipmyaddress' }])
    }
  } else if (selected.action === 'select') {
    const result = await pool.query<{ wallet_addr: string; min_energy_quantity: number }>('SELECT wallet_addr,min_energy_quantity FROM t_energy_ai_trusteeship WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3 LIMIT 1', [selected.rid, botRid, selected.chatId])
    const wallet = result.rows[0]
    if (wallet) {
      text = `设置智能托管地址：<code>${escapeTelegramHtml(wallet.wallet_addr)}</code>\n当前托管能量：<b>${wallet.min_energy_quantity}</b>\n请选择每次代理的能量数量。`
      keyboard = [[
        { text: '托管 65,000 能量', callback_data: `aitrusteeshipupdateconfirm_${selected.rid}_1` },
        { text: '托管 131,000 能量', callback_data: `aitrusteeshipupdateconfirm_${selected.rid}_2` },
      ], [{ text: '⬅️返回上一步', callback_data: 'aitrusteeshipupdate' }]]
    } else {
      text = '<b>当前选择的智能托管地址不存在，请重新选择</b>'
      keyboard = [[{ text: '⬅️返回上一步', callback_data: 'aitrusteeshipupdate' }]]
    }
  } else {
    const client = await (pool as Pool).connect()
    let saved: { wallet_addr: string } | undefined
    try {
      await client.query('BEGIN')
      const current = await client.query<{ rid: number }>('SELECT rid FROM t_energy_ai_trusteeship WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3 FOR UPDATE', [selected.rid, botRid, selected.chatId])
      if (current.rows[0]) {
        const changed = await client.query<{ wallet_addr: string }>('UPDATE t_energy_ai_trusteeship SET min_energy_quantity=$4,per_buy_energy_quantity=$4,update_time=now() WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3 RETURNING wallet_addr', [selected.rid, botRid, selected.chatId, selected.level])
        saved = changed.rows[0]
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
    text = saved
      ? `智能托管地址设置成功：<code>${escapeTelegramHtml(saved.wallet_addr)}</code>\n当前代理能量：<b>${selected.level}</b>`
      : '<b>当前选择的智能托管地址不存在，请重新选择</b>'
    keyboard = [[{ text: '⬅️返回上一步', callback_data: 'aitrusteeshipupdate' }]]
  }
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: { inline_keyboard: keyboard } })
  if (!sent.ok) throw new Error('trusteeship_energy_settings_reply_failed')
  return true
}
async function handleTrusteeshipCancelRechargeCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipCancelRechargeCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const client = await (pool as Pool).connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-recharge:' || $1 || ':' || $2,0))", [botRid, selected.chatId])
    const pending = await client.query<{ rid: number }>('SELECT rid FROM t_fms_recharge_order WHERE bot_rid=$1 AND status=0 AND recharge_tg_uid=$2 ORDER BY rid FOR UPDATE', [botRid, selected.chatId])
    if (pending.rows.length) {
      await client.query('UPDATE t_fms_recharge_order SET status=3,cancel_time=now() WHERE bot_rid=$1 AND status=0 AND recharge_tg_uid=$2', [botRid, selected.chatId])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text: '您的未完成充值订单已取消，可重新发起充值！',
    parse_mode: 'Markdown',
    allow_sending_without_reply: true,
  })
  if (!sent.ok) throw new Error('trusteeship_cancel_recharge_reply_failed')
  return true
}
async function handleLegacyEnergyFeeInfoCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = legacyEnergyFeeInfoCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  const sent = await tg(fetcher, token, 'answerCallbackQuery', {
    callback_query_id: String(selected.callback.id ?? ''),
    text: '波场手续费（⚠️务必仔细阅读⚠️）\n🔴对方有U，消耗约3.2万，燃烧13.44TRX\n🔴对方无U，消耗约6.5万，燃烧27.30TRX\n➖➖➖转账还需少量带宽➖➖➖\n🟢通过租赁能量，节省一大笔TRX\n🟢可选择租赁次数，租赁时长，能量24小时会恢复',
    show_alert: true,
  })
  if (!sent.ok) throw new Error('legacy_energy_fee_info_callback_failed')
  return true
}
async function handleEnergyPlatformPackageCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = energyPlatformPackageCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  const result = await pool.query<{ rid: number; package_name: string; energy_amount: number; trx_price: string; show_notes: string | null; receive_wallet: string | null; package_pic: string | null }>('SELECT p.rid,p.package_name,p.energy_amount,p.trx_price::text AS trx_price,p.show_notes,p.package_pic,b.receive_wallet\n    FROM t_energy_platform_package p JOIN t_energy_platform_bot b ON b.bot_rid=p.bot_rid\n    WHERE p.bot_rid=$1 AND p.callback_data=$2 AND p.status=0 AND b.status=0 LIMIT 1', [botRid, selected.data])
  const packageData = result.rows[0]
  const replyMarkup = packageData ? { inline_keyboard: [
    [{ text: 'TRX 余额购买', callback_data: 'balancebuytrx' + packageData.rid }, { text: 'USDT 余额购买', callback_data: 'balancebuyusd' + packageData.rid }],
    [{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }],
  ] } : { inline_keyboard: [[{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }]] }
  const username = selected.username ? '@' + escapeTelegramHtml(selected.username) + ' ' : ''
  const text = packageData
    ? username + '<b>您好！请仔细核对支付金额和支付地址</b>\n\n' + (packageData.show_notes ?? '') + '\n➖➖➖➖➖➖➖➖\n<b>🟢当前套餐：' + escapeTelegramHtml(packageData.package_name) + '</b>\n<b>🟢套餐能量：</b>' + packageData.energy_amount + ' (24小时恢复满)\n<b>🟢支付金额：</b><code>' + escapeTelegramHtml(packageData.trx_price) + '</code> <b>TRX</b> (点击金额复制)\n<b>🟢支付地址：</b><code>' + escapeTelegramHtml(String(packageData.receive_wallet ?? '')) + '</code>\n➖➖➖➖➖➖➖➖\n⚠️付款成功后,能量将自动发货到付款地址\n⚠️<b>点击地址复制，点击金额复制，金额或者地址错误将无法追回！</b>'
    : username + '<b>您好！该套餐已暂停购买，请选择其他套餐！</b>'
  const photo = packageData?.package_pic
  let sent: Tg
  if (photo && text.length <= 1024 && /^https:\/\//iu.test(photo)) {
    try {
      const parsed = new URL(photo)
      if (parsed.username || parsed.password) throw new Error('unsafe_photo_url')
      sent = await tg(fetcher, token, 'sendPhoto', { chat_id: selected.chatId, photo: parsed.toString(), caption: text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
    } catch {
      sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
    }
  } else {
    sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
  }
  if (!sent.ok) throw new Error('energy_platform_package_reply_failed')
  return true
}
function exactDecimal(value: unknown) {
  const match = String(value ?? '').trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/u)
  if (!match) return null
  const fraction = match[3] ?? ''
  const magnitude = BigInt(match[2]) * 10n ** BigInt(fraction.length) + BigInt(fraction || '0')
  return { units: match[1] === '-' ? -magnitude : magnitude, scale: fraction.length }
}
function exactDecimalText(units: bigint, scale: number) {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const divisor = 10n ** BigInt(scale)
  const whole = absolute / divisor
  if (scale === 0) return `${negative ? '-' : ''}${whole}`
  const fraction = String(absolute % divisor).padStart(scale, '0').replace(/0+$/u, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
function decryptShopCdkey(value: string | null) {
  if (!value) throw new Error('shop_cdkey_ciphertext_missing')
  const path = process.env.TRON_RSA_PRIVATE_KEY_PATH
  const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim()
  if (!raw) throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE')
  const key: KeyObject = createPrivateKey(raw)
  const bytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8
  const versioned = value.startsWith('v2:')
  const encoded = (versioned ? value.slice(3) : value).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('RSA_CIPHERTEXT_INVALID')
  const encrypted = Buffer.from(encoded, 'base64')
  if (!bytes || bytes < 256 || bytes % 1 !== 0 || !encrypted.length || encrypted.length % bytes !== 0) throw new Error('RSA_CIPHERTEXT_INVALID')
  const parts: Buffer[] = []
  for (let offset = 0; offset < encrypted.length; offset += bytes) {
    parts.push(privateDecrypt(versioned
      ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
      : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)))
  }
  return Buffer.concat(parts).toString('utf8')
}
function userBalanceText(value: unknown) {
  const amount = exactDecimal(value)
  return amount ? exactDecimalText(amount.units, amount.scale) : '0'
}
async function handlePrivateGoodsPageCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateGoodsPageCallback(update)
  if (!selected) return false
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = bot.rows[0]?.bot_token
  if (!token) throw new Error('shop_bot_missing')
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })

  let text: string
  const keyboard: Array<Array<Record<string, string>>> = []
  const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const contact = /^[A-Za-z0-9_]{5,32}$/u.test(adminName) ? { text: '👨联系客服', url: `https://t.me/${adminName}` } : null
  if (!selected.isPrivate) {
    text = '购买商品请私聊机器人！'
  } else {
    const user = await pool.query('SELECT 1 FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
    if (!user.rows.length) {
      text = '用户信息为空，请发送 /start 初始化用户，然后再进行购买'
      if (contact) keyboard.push([contact])
    } else {
      const count = await pool.query<{ total: number }>(`SELECT count(*)::int AS total
        FROM t_shop_goods_cdkey a JOIN t_shop_goods b ON b.rid=a.goods_rid
        WHERE a.status=1 AND b.status=0 AND b.rid=$1`, [selected.goodsRid])
      const total = Math.max(0, Number(count.rows[0]?.total ?? 0))
      const totalPages = Math.ceil(total / 10)
      const available = await pool.query<{ rid: number; cdkey_no: string; show_notes: string | null }>(`SELECT a.rid,a.cdkey_no,b.show_notes
        FROM t_shop_goods_cdkey a JOIN t_shop_goods b ON b.rid=a.goods_rid
        WHERE a.status=1 AND b.status=0 AND b.rid=$1
        ORDER BY a.seq_sn DESC,a.rid DESC LIMIT 10 OFFSET $2`, [selected.goodsRid, (selected.page - 1) * 10])
      if (available.rows.length) {
        const notes = escapeTelegramHtml(String(available.rows[0].show_notes ?? ''))
        text = `请选择商品${notes ? `\n${notes}` : ''}`
        for (const item of available.rows) {
          const code = Array.from(String(item.cdkey_no ?? '')).slice(0, 64).join('')
          keyboard.push([{ text: code || `商品 #${item.rid}`, callback_data: `buygoodscdkey${item.rid}` }])
        }
      } else {
        text = '<b>当前商品不可购买！</b>'
      }
      const footer: Array<Record<string, string>> = [{ text: '🔥我要充值', callback_data: 'aitrusteeshiprechargetrx' }]
      if (contact) footer.push(contact)
      keyboard.push(footer)
      if (available.rows.length) {
        const navigation: Array<Record<string, string>> = []
        if (selected.page > 1) navigation.push({ text: '⬅️上一页', callback_data: `buygoods${selected.goodsRid}_${selected.page - 1}` })
        if (selected.page < totalPages) navigation.push({ text: '➡️下一页', callback_data: `buygoods${selected.goodsRid}_${selected.page + 1}` })
        if (navigation.length) keyboard.push(navigation)
      }
    }
  }
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId, text,
    parse_mode: selected.isPrivate ? 'HTML' : 'Markdown',
    allow_sending_without_reply: true,
    ...(selected.isPrivate ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
  if (!sent.ok) throw new Error('shop_goods_page_reply_failed')
  return true
}
async function handlePrivateGoodsSelectionCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateGoodsSelectionCallback(update)
  if (!selected) return false
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = bot.rows[0]?.bot_token
  if (!token) throw new Error('shop_bot_missing')
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })

  let text: string
  const keyboard: Array<Array<Record<string, string>>> = []
  const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const contact = /^[A-Za-z0-9_]{5,32}$/u.test(adminName) ? { text: '👨联系客服', url: `https://t.me/${adminName}` } : null
  if (!selected.isPrivate) {
    text = '购买商品请私聊机器人！'
  } else {
    const account = await pool.query('SELECT 1 FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, selected.chatId])
    if (!account.rows.length) {
      text = '用户信息为空，请发送 /start 初始化用户，然后再进行购买'
      if (contact) keyboard.push([contact])
    } else {
      const item = await pool.query<{
        rid: number; cdkey_no: string; cdkey_usdt_price: string; cdkey_trx_price: string
        goods_usdt_price: string; goods_trx_price: string; goods_usdt_discount: string; goods_trx_discount: string
        cash_trx: string; cash_usdt: string
      }>(`SELECT a.rid,a.cdkey_no,a.cdkey_usdt_price::text,a.cdkey_trx_price::text,
          b.goods_usdt_price::text,b.goods_trx_price::text,c.goods_usdt_discount::text,c.goods_trx_discount::text,
          u.cash_trx::text,u.cash_usdt::text
        FROM t_shop_goods_cdkey a
        JOIN t_shop_goods b ON b.rid=a.goods_rid
        JOIN t_shop_goods_bot c ON c.goods_rid=b.rid AND c.bot_rid=$1 AND c.status=0
        JOIN t_telegram_bot_user u ON u.bot_rid=$1 AND u.tg_uid=$2
        WHERE a.rid=$3 AND a.status=1 AND b.status=0 LIMIT 1`, [botRid, selected.chatId, selected.cdkeyRid])
      const record = item.rows[0]
      const trxPrice = record && packageEffectiveShopPrice(record.cdkey_trx_price, record.goods_trx_price, record.goods_trx_discount)
      const usdtPrice = record && packageEffectiveShopPrice(record.cdkey_usdt_price, record.goods_usdt_price, record.goods_usdt_discount)
      if (!record || (!trxPrice && !usdtPrice)) {
        text = '❌该商品已无法购买,请选择其他商品'
        if (contact) keyboard.push([contact])
      } else {
        text = `您正在购买商品：\n<code>${escapeTelegramHtml(record.cdkey_no)}</code>\n购买需要支付TRX：${trxPrice ?? '不支持'} 或者支付USDT：${usdtPrice ?? '不支持'}\n\n<b>请选择支付方式</b>\n<b>TRX 余额</b>：<code>${escapeTelegramHtml(userBalanceText(record.cash_trx))}</code>\n<b>USDT 余额</b>：<code>${escapeTelegramHtml(userBalanceText(record.cash_usdt))}</code>`
        const paymentOptions: Array<Record<string, string>> = []
        if (trxPrice) paymentOptions.push({ text: 'TRX 余额支付', callback_data: `buygoodscdkeyconfirmtrx${record.rid}` })
        if (usdtPrice) paymentOptions.push({ text: 'USDT 余额支付', callback_data: `buygoodscdkeyconfirmusdt${record.rid}` })
        if (paymentOptions.length) keyboard.push(paymentOptions)
      }
    }
  }
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId, text,
    parse_mode: selected.isPrivate ? 'HTML' : 'Markdown',
    allow_sending_without_reply: true,
    ...(selected.isPrivate ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
  if (!sent.ok) throw new Error('shop_goods_selection_reply_failed')
  return true
}
async function handlePrivateGoodsPurchaseCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update) {
  const selected = privateGoodsPurchaseCallback(update.update_body)
  if (!selected) return false
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = bot.rows[0]?.bot_token
  if (!token) throw new Error('shop_bot_missing')
  if (selected.callback.id != null) {
    const answered = await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
    if (!answered.ok) throw new Error('shop_purchase_callback_answer_failed')
  }

  type Purchase = {
    update_rid: number; outcome: 'purchased' | 'user_missing' | 'item_unavailable' | 'unsupported_price' | 'insufficient_balance'
    delivery_status: 'none' | 'pending' | 'sending' | 'sent' | 'uncertain'; order_rid: number | null
  }
  const client = await (pool as Pool).connect()
  let purchase: Purchase
  try {
    await client.query('BEGIN')
    const prior = selected.callback.id != null
      ? await client.query<Purchase>("SELECT update_rid,outcome,delivery_status,order_rid FROM t_platform_telegram_shop_purchase WHERE callback_query_id=$1 FOR UPDATE", [String(selected.callback.id)])
      : { rows: [] as Purchase[] }
    if (prior.rows[0]) {
      purchase = prior.rows[0]
      await client.query('COMMIT')
    } else {
      const user = await client.query<{ rid: number; cash_trx: string; cash_usdt: string }>(
        'SELECT rid,cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1 FOR UPDATE',
        [botRid, selected.userId],
      )
      const saveOutcome = async (outcome: Purchase['outcome'], args: { payment?: number; price?: string; delivery?: Purchase['delivery_status']; orderRid?: number } = {}) => {
        const result = await client.query<Purchase>(`INSERT INTO t_platform_telegram_shop_purchase
          (update_rid,callback_query_id,bot_rid,chat_id,cdkey_rid,payment_type,price,outcome,delivery_status,order_rid)
          VALUES($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10)
          RETURNING update_rid,outcome,delivery_status,order_rid`,
        [update.rid, selected.callback.id == null ? null : String(selected.callback.id), botRid, selected.chatId, selected.cdkeyRid,
          args.payment ?? (selected.payment === 'trx' ? 1 : 2), args.price ?? null, outcome, args.delivery ?? 'none', args.orderRid ?? null])
        purchase = result.rows[0]
      }

      if (!user.rows[0]) {
        await saveOutcome('user_missing')
        await client.query('COMMIT')
      } else {
        const card = await client.query<{
          rid: number; cdkey_no: string; cdkey_pwd: string; cdkey_usdt_price: string; cdkey_trx_price: string
          goods_usdt_price: string; goods_trx_price: string; goods_usdt_discount: string; goods_trx_discount: string
        }>(`SELECT a.rid,a.cdkey_no,a.cdkey_pwd,a.cdkey_usdt_price::text,a.cdkey_trx_price::text,
            b.goods_usdt_price::text,b.goods_trx_price::text,c.goods_usdt_discount::text,c.goods_trx_discount::text
          FROM t_shop_goods_cdkey a
          JOIN t_shop_goods b ON b.rid=a.goods_rid AND b.status=0
          JOIN t_shop_goods_bot c ON c.goods_rid=b.rid AND c.bot_rid=$1 AND c.status=0
          WHERE a.rid=$2 AND a.status=1
          LIMIT 1 FOR UPDATE OF a,b,c`, [botRid, selected.cdkeyRid])
        const item = card.rows[0]
        if (!item) {
          await saveOutcome('item_unavailable')
          await client.query('COMMIT')
        } else {
          const rawPrice = selected.payment === 'trx'
            ? packageEffectiveShopPrice(item.cdkey_trx_price, item.goods_trx_price, item.goods_trx_discount)
            : packageEffectiveShopPrice(item.cdkey_usdt_price, item.goods_usdt_price, item.goods_usdt_discount)
          const price = rawPrice ? packageShopMoney(rawPrice) : null
          if (!price) {
            await saveOutcome('unsupported_price')
            await client.query('COMMIT')
          } else {
            // Validate the ciphertext before committing the debit so missing or invalid RSA keys cannot charge without delivery.
            decryptShopCdkey(item.cdkey_pwd)
            const paymentType = selected.payment === 'trx' ? 1 : 2
            const debit = await client.query<{ cash_after: string }>(`UPDATE t_telegram_bot_user
              SET ${selected.payment === 'trx' ? 'cash_trx' : 'cash_usdt'}=${selected.payment === 'trx' ? 'cash_trx' : 'cash_usdt'}-$2::numeric
              WHERE rid=$1 AND ${selected.payment === 'trx' ? 'cash_trx' : 'cash_usdt'} >= $2::numeric
              RETURNING ${selected.payment === 'trx' ? 'cash_trx' : 'cash_usdt'}::text AS cash_after`, [user.rows[0].rid, price])
            if (!debit.rowCount) {
              await saveOutcome('insufficient_balance', { payment: paymentType, price })
              await client.query('COMMIT')
            } else {
              const claimed = await client.query('UPDATE t_shop_goods_cdkey SET status=2,update_time=now() WHERE rid=$1 AND status=1 RETURNING rid', [item.rid])
              if (!claimed.rowCount) throw new Error('shop_cdkey_claim_failed')
              const order = await client.query<{ rid: number }>(`INSERT INTO t_shop_order
                (bot_rid,tg_uid,tg_username,cdkey_no,cdkey_pwd,pay_type,pay_price,pay_time)
                VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING rid`,
              [botRid, selected.chatId, selected.callback.from?.username ?? '', item.cdkey_no, item.cdkey_pwd, paymentType, price])
              if (!order.rows[0]) throw new Error('shop_order_insert_failed')
              await saveOutcome('purchased', { payment: paymentType, price, delivery: 'pending', orderRid: order.rows[0].rid })
              await client.query('COMMIT')
            }
          }
        }
      }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }

  if (purchase!.outcome === 'purchased') {
    const delivery = await pool.query<{ cdkey_no: string; cdkey_pwd: string }>(`UPDATE t_platform_telegram_shop_purchase p
      SET delivery_status='sending',updated_at=now()
      FROM t_shop_order o
      WHERE p.update_rid=$1 AND p.outcome='purchased' AND p.delivery_status='pending' AND p.order_rid=o.rid
      RETURNING o.cdkey_no,o.cdkey_pwd`, [purchase!.update_rid])
    const item = delivery.rows[0]
    if (item) {
      let text: string
      try {
        const secret = escapeTelegramHtml(decryptShopCdkey(item.cdkey_pwd))
        text = `<b>✅恭喜您，已成功购买商品</b>：\n<b>购买商品</b>：<code>${escapeTelegramHtml(item.cdkey_no)}</code>\n<b>卡密</b>：<code>${secret}</code>\n<b>⚠️请注意保存商品信息，该卡密只显示一次！！</b>`
      } catch {
        await pool.query("UPDATE t_platform_telegram_shop_purchase SET delivery_status='uncertain',updated_at=now() WHERE update_rid=$1 AND delivery_status='sending'", [purchase!.update_rid])
        throw new Error('shop_purchase_delivery_unavailable')
      }
      const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
      const keyboard: Array<Record<string, string>> = [{ text: '🔥我要充值', callback_data: 'aitrusteeshiprechargetrx' }]
      if (/^[A-Za-z0-9_]{5,32}$/u.test(adminName)) keyboard.push({ text: '👨联系客服', url: `https://t.me/${adminName}` })
      let sent: Tg
      try {
        sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: { inline_keyboard: [keyboard] } })
      } catch {
        sent = { ok: false }
      }
      if (sent.ok && sent.result?.message_id != null) {
        await pool.query("UPDATE t_platform_telegram_shop_purchase SET delivery_status='sent',telegram_message_id=$2,updated_at=now() WHERE update_rid=$1 AND delivery_status='sending'", [purchase!.update_rid, sent.result.message_id])
      } else {
        // Telegram may have accepted the message before the connection failed; never automatically resend a one-time credential.
        await pool.query("UPDATE t_platform_telegram_shop_purchase SET delivery_status='uncertain',updated_at=now() WHERE update_rid=$1 AND delivery_status='sending'", [purchase!.update_rid])
      }
    }
    return true
  }

  const message = purchase!.outcome === 'user_missing'
    ? '用户信息为空，请发送 /start 初始化用户，然后再进行购买'
    : purchase!.outcome === 'insufficient_balance'
      ? '❌购买失败，请查看余额是否足够'
      : '❌该商品已无法购买，请选择其他商品'
  const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const keyboard: Array<Record<string, string>> = []
  if (/^[A-Za-z0-9_]{5,32}$/u.test(adminName)) keyboard.push({ text: '👨联系客服', url: `https://t.me/${adminName}` })
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId, text: message, parse_mode: 'HTML', allow_sending_without_reply: true,
    ...(keyboard.length ? { reply_markup: { inline_keyboard: [keyboard] } } : {}),
  })
  if (!sent.ok) throw new Error('shop_purchase_result_reply_failed')
  return true
}
function formatRechargePrice(value: string | number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  return parsed.toFixed(2).replace(/\.0+$/u, '').replace(/(\.\d*[1-9])0+$/u, '$1')
}
async function handleTrusteeshipRechargeCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipRechargeCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const reply = async (text: string, replyMarkup?: Record<string, unknown>) => {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('trusteeship_recharge_reply_failed')
  }
  const user = await pool.query<{ cash_trx: string | number; cash_usdt: string | number }>(
    'SELECT cash_trx::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
    [botRid, selected.chatId],
  )
  if (!user.rows[0]) {
    await reply('用户信息为空，请发送 /start 初始化用户，然后再进行智能托管')
    return true
  }
  const amountKeyboard = { inline_keyboard: [
    [10, 100, 500].map(amount => ({ text: `${amount} TRX`, callback_data: `aitrusteeshiprechargetrx${amount}` })),
    [1000, 2000, 5000].map(amount => ({ text: `${amount} TRX`, callback_data: `aitrusteeshiprechargetrx${amount}` })),
    [10, 100, 500].map(amount => ({ text: `${amount} USDT`, callback_data: `aitrusteeshiprechargeusdt${amount}` })),
    [1000, 2000, 5000].map(amount => ({ text: `${amount} USDT`, callback_data: `aitrusteeshiprechargeusdt${amount}` })),
    [{ text: '⬅️返回上一步', callback_data: 'aitrusteeship' }],
  ] }
  if (selected.amount == null) {
    await reply(`<b>TRX余额为：</b><code>${escapeTelegramHtml(String(user.rows[0].cash_trx))} TRX</code>\n<b>USDT余额为：</b><code>${escapeTelegramHtml(String(user.rows[0].cash_usdt))} USDT</code>\n\n⚠️TRX余额不足时，不再执行智能托管，请及时充值\n⚠️充值的USDT可转换为相应价值的TRX，能量使用TRX购买\n<b>请保证余额充足,点击下方可充值余额！</b>`, amountKeyboard)
    return true
  }
  const bot = await pool.query<{ recharge_wallet_addr: string | null }>('SELECT recharge_wallet_addr FROM t_telegram_bot WHERE rid=$1', [botRid])
  const wallet = String(bot.rows[0]?.recharge_wallet_addr ?? '').trim()
  if (!wallet) {
    await reply('暂未查询到可用充值钱包，请联系客服配置！')
    return true
  }

  const client = await (pool as Pool).connect()
  let pending: { recharge_pay_price: string; need_pay_price: string; recharge_coin_name: string; expire_time: string | Date } | undefined
  let order: { rid: number; need_pay_price: string; expire_time: string | Date } | undefined
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-recharge:' || $1 || ':' || $2,0))", [botRid, selected.chatId])
    pending = (await client.query<{ recharge_pay_price: string; need_pay_price: string; recharge_coin_name: string; expire_time: string | Date }>(
      'SELECT recharge_pay_price::text,need_pay_price::text,recharge_coin_name,expire_time::text FROM t_fms_recharge_order WHERE bot_rid=$1 AND status=0 AND recharge_tg_uid=$2 ORDER BY rid LIMIT 1 FOR UPDATE',
      [botRid, selected.chatId],
    )).rows[0]
    if (!pending) {
      const baseCents = selected.amount * 100
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-trusteeship-recharge-amounts',0))")
      let inserted = false
      for (let attempt = 0; attempt < 100 && !inserted; attempt++) {
        const cents = randomInt(1, 100)
        const payPrice = selected.amount.toFixed(2)
        const needPayPrice = ((baseCents + cents) / 100).toFixed(2)
        const duplicate = await client.query('SELECT rid FROM t_fms_recharge_order WHERE status=0 AND need_pay_price=$1::numeric LIMIT 1', [needPayPrice])
        if (duplicate.rows.length) continue
        order = (await client.query<{ rid: number; need_pay_price: string; expire_time: string | Date }>(
          "INSERT INTO t_fms_recharge_order(bot_rid,recharge_tg_uid,recharge_tg_username,recharge_coin_name,recharge_pay_price,need_pay_price,status,create_time,expire_time) VALUES($1,$2,$3,$4,$5::numeric,$6::numeric,0,now(),now()+interval '15 minutes') RETURNING rid,need_pay_price::text,expire_time::text",
          [botRid, selected.chatId, String(selected.callback.from?.username ?? ''), selected.coin, payPrice, needPayPrice],
        )).rows[0]
        inserted = Boolean(order)
      }
      if (!inserted || !order) throw new Error('trusteeship_recharge_unique_amount_unavailable')
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  if (pending) {
    await reply(`您还有未完成的充值订单，暂时无法继续提交。如果需要重新提交，请点击下方取消未完成的充值订单\n<b>充值金额：</b>${formatRechargePrice(pending.recharge_pay_price)} ${escapeTelegramHtml(pending.recharge_coin_name)}\n<b>应支付金额：</b><code>${formatRechargePrice(pending.need_pay_price)} ${escapeTelegramHtml(pending.recharge_coin_name)}</code>\n<b>过期时间：</b>${escapeTelegramHtml(String(pending.expire_time))}`, { inline_keyboard: [[{ text: '取消未充值的订单', callback_data: 'cancelaitrusteeshiprechargeunpaid' }]] })
    return true
  }
  const expire = order!.expire_time instanceof Date ? order!.expire_time.toISOString().replace('T', ' ').slice(0, 19) : String(order!.expire_time)
  await reply(`<b>下单成功，请核对金额和地址充值</b>\n提示：充值后,将会在10秒内入账！\n充值订单：${order!.rid}\n➖➖➖➖➖➖➖➖\n<b>🟢支付金额：</b><code>${formatRechargePrice(order!.need_pay_price)}</code> <b>${selected.coin}</b> (点击金额复制)\n<b>🟢支付地址：</b><code>${escapeTelegramHtml(wallet)}</code>\n<b>🟢失效时间：${escapeTelegramHtml(expire)}</b>\n➖➖➖➖➖➖➖➖\n⚠️<b>请在订单失效时间支付，订单过期后请重新发起！</b>\n⚠️<b>点击地址和金额复制，金额或者地址错误将无法追回！</b>\n当前时间：${escapeTelegramHtml(new Date().toISOString().replace('T', ' ').slice(0, 19))}`, amountKeyboard)
  return true
}
const trusteeshipReplyKeyboard = { inline_keyboard: [
  [
    { text: '🔥TRX充值', callback_data: 'aitrusteeshiprechargetrx' },
    { text: '🔥USDT充值', callback_data: 'aitrusteeshiprechargeusdt' },
    { text: '🔀U转TRX', callback_data: 'aitrusteeshipusdtswaptrx' },
  ],
  [
    { text: '➕添加托管地址', callback_data: 'aitrusteeshipaddaddress' },
    { text: '➖删除托管地址', callback_data: 'aitrusteeshipdeleteaddress' },
  ],
  [{ text: '👑我的托管地址', callback_data: 'aitrusteeshipmyaddress' }],
] }
async function handleTrusteeshipSwapTrxCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = trusteeshipSwapTrxCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const user = await pool.query<{ tg_uid: string; cash_usdt: string | number }>(
    'SELECT tg_uid::text,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1',
    [botRid, selected.chatId],
  )
  let text = ''
  let replyMarkup: Record<string, unknown> = { force_reply: false, input_field_placeholder: '转换失败，请充值后转换' }
  if (!user.rows[0]) {
    text = '用户信息为空，请发送 /start 初始化用户，然后再进行智能托管'
  } else if (Number(user.rows[0].cash_usdt) >= 1) {
    text = `<b>请在2分钟内回复此消息需要转换的USDT数量</b>\n<b>当前USDT余额：</b><code>${escapeTelegramHtml(String(user.rows[0].cash_usdt))}</code>\n\n<b>请输入 1 个USDT以上的数量！</b>\n\n点击 /start 重新开始`
    replyMarkup = { force_reply: true, input_field_placeholder: '请输入需要转换的USDT数量' }
  } else {
    text = `<b>转换失败，请充值后转换，当前USDT余额：</b>${escapeTelegramHtml(String(user.rows[0].cash_usdt))}\nUSDT大于1时才能转换为TRX！`
  }
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('trusteeship_swap_trx_prompt_failed')
  if (replyMarkup.force_reply) {
    await pool.query(
      "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'trusteeship_usdt_to_trx',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='trusteeship_usdt_to_trx',prompt_message_id=$4,context=NULL,expires_at=now()+interval '2 minutes',updated_at=now()",
      [botRid, selected.chatId, selected.userId, String(promptMessageId)],
    )
  } else {
    await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_usdt_to_trx'", [botRid, selected.chatId, selected.userId])
  }
  return true
}
async function handleTrusteeshipSwapTrxReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const rawAmount = textOf(message)
  if (!/^\d{1,9}$/u.test(rawAmount)) return false
  const chatId = String(message.chat.id), userId = String(message.from.id), amount = BigInt(rawAmount)
  const promptMessageId = String(message.reply_to_message.message_id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_usdt_to_trx' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, promptMessageId],
  )
  if (state.rows[0]?.state !== 'trusteeship_usdt_to_trx') return false
  const token = await botTokenFor(pool, botRid)
  let text = ''
  if (amount < 1n) {
    text = '<b>转换失败，请充值后转换</b>\nUSDT大于1时才能转换为TRX！'
  } else {
    let rateCents = 0
    try {
      const response = await fetcher('https://www.okx.com/api/v5/market/index-tickers?instId=TRX-USDT&quoteCcy=USDT', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('okx_rate_http_error')
      const payload = await response.json() as { data?: Array<{ idxPx?: string | number }> }
      const price = Number(payload.data?.[0]?.idxPx)
      if (!Number.isFinite(price) || price <= 0) throw new Error('okx_rate_invalid')
      const reciprocalCents = Math.floor((1 / price) * 100 + 0.5)
      rateCents = Math.floor(reciprocalCents * 95 / 100)
      if (rateCents <= 0) throw new Error('okx_rate_invalid')
    } catch {
      text = '<b>获取汇率失败，请重试</b>'
    }
    if (rateCents > 0) {
      const client = await (pool as Pool).connect()
      let outcome: 'success' | 'insufficient' | 'missing' = 'missing'
      let balances: { cash_trx: string; cash_usdt: string } | undefined
      try {
        await client.query('BEGIN')
        const currentState = await client.query<{ state: string }>(
          "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_usdt_to_trx' AND expires_at>now() AND prompt_message_id=$4 FOR UPDATE",
          [botRid, chatId, userId, promptMessageId],
        )
        if (currentState.rows[0]) {
          const user = await client.query<{ rid: number }>('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [botRid, chatId])
          if (user.rows[0]) {
            if (amount >= 1n) {
              const rate = `${Math.floor(rateCents / 100)}.${String(rateCents % 100).padStart(2, '0')}`
              const updated = await client.query<{ cash_trx: string; cash_usdt: string }>(
                'UPDATE t_telegram_bot_user SET cash_trx=cash_trx+$3::numeric*$4::numeric,cash_usdt=cash_usdt-$3::numeric WHERE rid=$1 AND bot_rid=$2 AND cash_usdt >= $3::numeric RETURNING cash_trx::text,cash_usdt::text',
                [user.rows[0].rid, botRid, rawAmount, rate],
              )
              if (updated.rows[0]) {
                balances = updated.rows[0]
                outcome = 'success'
              } else outcome = 'insufficient'
            } else outcome = 'insufficient'
          }
          await client.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='trusteeship_usdt_to_trx' AND prompt_message_id=$4", [botRid, chatId, userId, promptMessageId])
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally { client.release() }
      text = outcome === 'success' && balances
        ? `<b>恭喜您！USDT 转 TRX 成功！</b>\n<b>TRX余额为：</b><code>${escapeTelegramHtml(balances.cash_trx)} TRX</code>\n<b>USDT余额为：</b><code>${escapeTelegramHtml(balances.cash_usdt)} USDT</code>\n\n⚠️TRX余额不足时，不再执行智能托管，请及时充值\n⚠️充值的USDT可点击下方转换为TRX\n\n<b>请保证余额充足,点击下方可充值余额！</b>`
        : outcome === 'insufficient'
          ? '<b>转换失败，请充值后转换</b>\nUSDT余额不足或必须至少转换1 USDT。'
          : '本次转换已处理，请重新发起。'
    }
  }
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: trusteeshipReplyKeyboard })
  if (!sent.ok) throw new Error('trusteeship_swap_trx_reply_failed')
  return true
}
async function handlePrivateEnergyBishuBindCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateEnergyBishuBindCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text: '<b>请在2分钟内回复此消息，直接回复您要绑定的波场地址</b>\n<b>笔数套餐是通过直接转入USDT下单，如您想要接收地址的能量通知，需要手工绑定。只有下单了笔数套餐的地址才能绑定！</b>\n\n点击 /start 重新开始',
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { force_reply: true, input_field_placeholder: '请输入需要绑定通知的波场地址' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('bishu_bind_prompt_failed')
  await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,expires_at) VALUES($1,$2,$3,'bishu_bind_notice',$4,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='bishu_bind_notice',prompt_message_id=$4,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  return true
}
async function handlePrivateEnergyBishuAddCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateEnergyBishuAddCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: selected.chatId,
    text: '<b>请在2分钟内回复此消息，直接回复您要增加笔数的波场地址</b>\n<b>增加笔数扣除钱包USDT余额，请保证USDT余额充足</b>\n\n点击 /start 重新开始',
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_markup: { force_reply: true, input_field_placeholder: '请输入需要增加笔数的波场地址' },
  })
  const promptMessageId = sent.result?.message_id
  if (!sent.ok || promptMessageId == null) throw new Error('bishu_add_address_prompt_failed')
  await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,context,expires_at) VALUES($1,$2,$3,'bishu_add_address',$4,NULL,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='bishu_add_address',prompt_message_id=$4,context=NULL,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, selected.chatId, selected.userId, String(promptMessageId)],
  )
  return true
}
async function energyBishuList(pool: Database, botRid: number, chatId: string) {
  const [count, records, bot] = await Promise.all([
    pool.query<{ total: number }>('SELECT count(*)::int AS total FROM t_energy_ai_bishu WHERE bot_rid=$1 AND tg_uid=$2', [botRid, chatId]),
    pool.query<{ rid: number; wallet_addr: string; is_active: string | null }>('SELECT rid,wallet_addr,is_active FROM t_energy_ai_bishu WHERE bot_rid=$1 AND tg_uid=$2 ORDER BY rid DESC LIMIT 10', [botRid, chatId]),
    pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid]),
  ])
  const all = Number(count.rows[0]?.total ?? 0)
  const shown = records.rows.slice(0, 9)
  const numberIcons = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣']
  const lines = ['<b>📋 已绑定的能量地址列表</b>', `<b>当前已绑定：${all} 个</b>`, '', '💡 <i>点击地址按钮可切换激活/停用状态</i>', '🔴 <i>已激活 = 能量将正常下发</i>', '⚪ <i>未激活 = 能量暂停下发</i>', '']
  const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = []
  const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const firstRow: Array<{ text: string; url?: string; callback_data?: string }> = []
  if (/^[A-Za-z0-9_]{5,32}$/u.test(adminName)) firstRow.push({ text: '👨联系客服', url: `https://t.me/${adminName}` })
  firstRow.push({ text: '⏳剩余笔数', callback_data: 'energybishusy' })
  keyboard.push(firstRow)
  shown.forEach((record, index) => {
    const address = String(record.wallet_addr ?? '')
    const short = address.length > 14 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address
    const active = record.is_active === 'Y'
    const emoji = active ? '🔴' : '⚪'
    const status = active ? '已激活' : '未激活'
    lines.push(`${numberIcons[index]} <code>${escapeTelegramHtml(short)}</code> ${emoji}${status}`)
    keyboard.push([{ text: `${short} ${emoji}${status}`, callback_data: `togglebishu_${record.rid}_${active ? 'N' : 'Y'}` }])
  })
  if (all > 9) lines.push('', '⚠️ <i>只显示最新9个地址</i>')
  keyboard.push([{ text: '📣地址绑定通知', callback_data: 'energybishubind' }, { text: '✏️已绑通知地址', callback_data: 'energybishusearch' }])
  keyboard.push([{ text: '➕增加地址笔数', callback_data: 'energybishubalanceadd' }])
  return { text: lines.join('\n'), replyMarkup: { inline_keyboard: keyboard } }
}
async function handlePrivateEnergyBishuSearchCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateEnergyBishuSearchCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id) })
  const listing = await energyBishuList(pool, botRid, selected.chatId)
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: selected.chatId, text: listing.text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: listing.replyMarkup })
  if (!sent.ok) throw new Error('bishu_address_list_failed')
  return true
}
async function handlePrivateEnergyBishuToggleCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const selected = privateEnergyBishuToggleCallback(update)
  if (!selected) return false
  const token = await botTokenFor(pool, botRid)
  const answer = async (text: string, showAlert = false) => {
    if (selected.callback.id != null) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(selected.callback.id), text, show_alert: showAlert })
  }
  const client = await (pool as Pool).connect()
  let wallet: { rid: number; wallet_addr: string; is_active: string | null } | undefined
  try {
    await client.query('BEGIN')
    const current = await client.query<{ rid: number; wallet_addr: string; is_active: string | null }>('SELECT rid,wallet_addr,is_active FROM t_energy_ai_bishu WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3 FOR UPDATE', [selected.rid, botRid, selected.chatId])
    wallet = current.rows[0]
    if (!wallet) await client.query('ROLLBACK')
    else {
      await client.query("UPDATE t_energy_ai_bishu SET is_active=$4,active_time=CASE WHEN $4='Y' THEN now() ELSE active_time END,update_time=now() WHERE rid=$1 AND bot_rid=$2 AND tg_uid=$3", [selected.rid, botRid, selected.chatId, selected.status])
      await client.query('COMMIT')
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  if (!wallet) {
    await answer('地址不存在或无权操作', true)
    return true
  }
  const active = selected.status === 'Y'
  await answer(active ? '✅ 地址已激活' : '⚠️ 地址已停用', true)
  const listing = await energyBishuList(pool, botRid, selected.chatId)
  const edited = await tg(fetcher, token, 'editMessageText', {
    chat_id: selected.chatId,
    message_id: selected.message.message_id,
    text: listing.text,
    parse_mode: 'HTML',
    reply_markup: listing.replyMarkup,
  })
  if (!edited.ok) throw new Error('bishu_address_list_edit_failed')
  return true
}
async function handlePrivateEnergyBishuBindReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_bind_notice' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (state.rows[0]?.state !== 'bishu_bind_notice') return false
  await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_bind_notice'", [botRid, chatId, userId])
  const address = textOf(message)
  const safeAddress = escapeTelegramHtml(address)
  let text: string
  if (!isTronAddressText(address)) {
    text = `绑定地址：<code>${safeAddress}</code>\n绑定结果：请输入有效的波场地址！`
  } else {
    const client = await (pool as Pool).connect()
    let outcome: 'missing' | 'bound' | 'already' | 'owned' = 'missing'
    let active = false
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-bishu-bind:' || $1 || ':' || $2,0))", [botRid, address])
      const found = await client.query<{ tg_uid: string | null; is_active: string | null }>('SELECT tg_uid,is_active FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2 ORDER BY rid DESC LIMIT 1 FOR UPDATE', [botRid, address])
      if (!found.rows[0]) {
        outcome = 'missing'
        await client.query('COMMIT')
      } else if (!found.rows[0].tg_uid) {
        await client.query("UPDATE t_energy_ai_bishu SET tg_uid=$3,is_active='N',update_time=now() WHERE bot_rid=$1 AND wallet_addr=$2 AND COALESCE(tg_uid,'')=''", [botRid, address, chatId])
        outcome = 'bound'
        await client.query('COMMIT')
      } else if (String(found.rows[0].tg_uid) === chatId) {
        outcome = 'already'
        active = found.rows[0].is_active === 'Y'
        await client.query('COMMIT')
      } else {
        outcome = 'owned'
        await client.query('COMMIT')
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
    text = outcome === 'missing'
      ? `绑定地址：<code>${safeAddress}</code>\n绑定结果：还未购买能量笔数套餐，请先购买后再添加通知！`
      : outcome === 'bound'
        ? `绑定地址：<code>${safeAddress}</code>\n绑定结果：恭喜您，绑定成功！\n\n⚠️ <b>当前状态：未激活</b>\n💡 请点击「✏️已绑通知地址」按钮激活后，能量才会开始下发。`
        : outcome === 'already'
          ? `绑定地址：<code>${safeAddress}</code>\n绑定结果：您已绑定该地址，无需重复绑定！\n\n💡 当前状态：<b>${active ? '🔴已激活' : '⚪未激活'}</b>\n请点击「✏️已绑通知地址」按钮查看或切换状态。`
          : `绑定地址：<code>${safeAddress}</code>\n绑定结果：该地址已被其他用户绑定，如果该地址是您的地址，请联系客服处理！`
  }
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const buttons: Array<{ text: string; url?: string; callback_data?: string }> = []
  const username = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  if (/^[A-Za-z0-9_]{5,32}$/u.test(username)) buttons.push({ text: '👨联系客服', url: `https://t.me/${username}` })
  buttons.push({ text: '🖌笔数套餐', callback_data: 'energybishu' })
  const sent = await tg(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: { inline_keyboard: [buttons] } })
  if (!sent.ok) throw new Error('bishu_bind_reply_failed')
  return true
}
async function handlePrivateEnergyBishuReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_balance_query' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (state.rows[0]?.state !== 'bishu_balance_query') return false
  await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_balance_query'", [botRid, chatId, userId])

  const address = textOf(message)
  const safeAddress = escapeTelegramHtml(address)
  const result = await pool.query<{ total_buy_usdt: string; max_buy_quantity: number; total_buy_quantity: number; energy_platform_rid: number | null }>(
    'SELECT total_buy_usdt::text,max_buy_quantity,total_buy_quantity,energy_platform_rid FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2 LIMIT 1',
    [botRid, address],
  )
  let reply: string
  if (!isTronAddressText(address)) {
    reply = `查询地址：<code>${safeAddress}</code>\n查询结果：请输入有效的波场地址！`
  } else if (!result.rows[0]) {
    reply = `查询地址：<code>${safeAddress}</code>\n查询结果：还未购买能量笔数套餐！`
  } else {
    const wallet = result.rows[0]
    const localRemaining = Number(wallet.max_buy_quantity) - Number(wallet.total_buy_quantity)
    const total = Number.isFinite(localRemaining) ? localRemaining : 0
    let remoteRemaining: number | null = null
    let remoteDelegated = false
    let queryError: 1 | 2 | null = null
    const platformBot = await pool.query<{ bishu_daili_type: number | null }>('SELECT bishu_daili_type FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1', [botRid])
    if (platformBot.rows[0] && Number(platformBot.rows[0].bishu_daili_type) !== 1 && wallet.energy_platform_rid != null) {
      const platform = await pool.query<{ platform_uid: string | null }>('SELECT platform_uid FROM t_energy_platform WHERE rid=$1 LIMIT 1', [wallet.energy_platform_rid])
      if (platform.rows[0]) {
        remoteDelegated = true
        try {
          const response = await fetcher('https://trongas.io/api/auto/data', {
            method: 'POST',
            headers: { 'Content-Type': "application/json;charset='utf-8'" },
            body: JSON.stringify({ page: 1, username: platform.rows[0].platform_uid, search: { orderId: '', state: '', receiveAddress: address, chromeIndex: '' } }),
            redirect: 'error',
            signal: AbortSignal.timeout(8_000),
          })
          if (!response.ok) queryError = 1
          else {
            const payload = await response.json() as { code?: unknown; data?: { data?: Array<{ freeze?: unknown; residue?: unknown }> } }
            if (Number(payload.code) !== 10000) queryError = 2
            else if (!Array.isArray(payload.data?.data) || payload.data.data.length === 0) remoteRemaining = null
            else {
              const entry = payload.data.data[0]
              const residue = Number(entry.residue)
              if (entry.freeze === 1 || entry.freeze === '1') remoteRemaining = 0
              else if (Number.isFinite(residue) && residue >= 0) remoteRemaining = residue
              else queryError = 2
            }
          }
        } catch { queryError = 1 }
      }
    }
    if (queryError) reply = `查询地址：<code>${safeAddress}</code>\n查询结果：查询失败${queryError}，请联系客服！`
    else if (remoteRemaining != null) reply = `查询地址：<code>${safeAddress}</code>\n总充值：${escapeTelegramHtml(String(wallet.total_buy_usdt))} USDT\n剩余次数：${remoteRemaining + total}`
    else reply = `查询地址：<code>${safeAddress}</code>\n总充值：${escapeTelegramHtml(String(wallet.total_buy_usdt))} USDT\n剩余次数：${total}${remoteDelegated ? ' 次' : ''}`
  }
  const bot = await pool.query<{ bot_token: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const buttons: Array<{ text: string; url?: string; callback_data?: string }> = []
  const adminName = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  if (/^[A-Za-z0-9_]{5,32}$/u.test(adminName)) buttons.push({ text: '👨联系客服', url: `https://t.me/${adminName}` })
  buttons.push({ text: '🔄重新查询', callback_data: 'energybishusy' })
  const sent = await tg(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', {
    chat_id: chatId,
    text: reply,
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_to_message_id: String(message.message_id),
    reply_markup: { inline_keyboard: [buttons] },
  })
  if (!sent.ok) throw new Error('bishu_balance_reply_failed')
  return true
}
type BishuPurchase = { update_rid: number; wallet_addr: string; quantity: number; unit_price: string; total_price: string; previous_quantity: number; new_quantity: number; wallet_rid: number; is_active: string; notification_sent_at?: string | Date | null }
function scaledUnits(value: unknown, scale: number): bigint | null {
  const match = /^(\d{1,18})(?:\.(\d{1,6}))?$/u.exec(String(value ?? '').trim())
  if (!match || (match[2]?.length ?? 0) > scale) return null
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? '').padEnd(scale, '0') || '0')
}
function moneyText(cents: bigint) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` }
function balanceText(value: unknown) {
  const micros = scaledUnits(value, 6)
  if (micros == null) return '0.00'
  const cents = micros / 10_000n + (micros % 10_000n >= 5_000n ? 1n : 0n)
  return moneyText(cents)
}
async function bishuPurchaseByUpdate(pool: Database, updateRid: number) {
  const result = await pool.query<BishuPurchase>('SELECT update_rid,wallet_addr,quantity,unit_price::text,total_price::text,previous_quantity,new_quantity,wallet_rid,is_active,notification_sent_at FROM t_platform_telegram_bishu_purchase WHERE update_rid=$1', [updateRid])
  return result.rows[0] ?? null
}
async function handlePrivateEnergyBishuAddAddressReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_add_address' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (state.rows[0]?.state !== 'bishu_add_address') return false
  await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_add_address'", [botRid, chatId, userId])
  const address = textOf(message), safeAddress = escapeTelegramHtml(address), token = await botTokenFor(pool, botRid)
  if (!isTronAddressText(address)) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `增加笔数地址：<code>${safeAddress}</code>\n增加结果：请输入有效的波场地址！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('bishu_add_invalid_address_reply_failed')
    return true
  }
  const existing = await pool.query<{ tg_uid: string | null }>('SELECT tg_uid FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2 ORDER BY rid ASC LIMIT 1', [botRid, address])
  if (existing.rows[0] && String(existing.rows[0].tg_uid ?? '') !== chatId) {
    const bot = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
    const admin = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
    const replyMarkup = /^[A-Za-z0-9_]{5,32}$/u.test(admin) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${admin}` }]] } : undefined
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: `增加笔数地址：<code>${safeAddress}</code>\n增加结果：该地址已被其他用户绑定，如果该地址是您的地址，请联系客服处理！`, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
    if (!sent.ok) throw new Error('bishu_add_owner_conflict_reply_failed')
    return true
  }
  const prompt = await tg(fetcher, token, 'sendMessage', {
    chat_id: chatId,
    text: `<b>请在2分钟内回复此消息，增加笔数次数。比如 100 表示给地址增加 100 次</b>\n增加地址：<code>${safeAddress}</code>\n\n点击 /start 重新开始`,
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_to_message_id: String(message.message_id),
    reply_markup: { force_reply: true, input_field_placeholder: '请输入增加的笔数,例如100' },
  })
  const promptMessageId = prompt.result?.message_id
  if (!prompt.ok || promptMessageId == null) throw new Error('bishu_add_count_prompt_failed')
  await pool.query(
    "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,prompt_message_id,context,expires_at) VALUES($1,$2,$3,'bishu_add_count',$4,$5::jsonb,now()+interval '2 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='bishu_add_count',prompt_message_id=$4,context=$5::jsonb,expires_at=now()+interval '2 minutes',updated_at=now()",
    [botRid, chatId, userId, String(promptMessageId), JSON.stringify({ walletAddr: address })],
  )
  return true
}
async function purchaseEnergyBishu(pool: Database, botRid: number, chatId: string, updateRid: number, promptMessageId: string, address: string, quantity: number, requirePromptState = true): Promise<{ purchase?: BishuPurchase; error?: 'missing_user' | 'unconfigured' | 'owned' | 'insufficient' | 'invalid_config' | 'limit' | 'state_expired' }> {
  const client = await (pool as Pool).connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-bishu-purchase:' || $1,0))", [address])
    const prior = await client.query<BishuPurchase>('SELECT update_rid,wallet_addr,quantity,unit_price::text,total_price::text,previous_quantity,new_quantity,wallet_rid,is_active,notification_sent_at FROM t_platform_telegram_bishu_purchase WHERE update_rid=$1 FOR UPDATE', [updateRid])
    if (prior.rows[0]) { await client.query('COMMIT'); return { purchase: prior.rows[0] } }
    if (requirePromptState) {
      const lockedState = await client.query<{ context: { walletAddr?: string } | string | null }>("SELECT context FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$2 AND state='bishu_add_count' AND prompt_message_id=$3 AND expires_at>now() FOR UPDATE", [botRid, chatId, promptMessageId])
      const lockedContext = typeof lockedState.rows[0]?.context === 'string' ? (() => { try { return JSON.parse(lockedState.rows[0].context as string) as { walletAddr?: string } } catch { return {} } })() : lockedState.rows[0]?.context
      if (String(lockedContext?.walletAddr ?? '') !== address) {
        const replay = await client.query<BishuPurchase>('SELECT update_rid,wallet_addr,quantity,unit_price::text,total_price::text,previous_quantity,new_quantity,wallet_rid,is_active,notification_sent_at FROM t_platform_telegram_bishu_purchase WHERE update_rid=$1 FOR UPDATE', [updateRid])
        if (replay.rows[0]) { await client.query('COMMIT'); return { purchase: replay.rows[0] } }
        await client.query('ROLLBACK')
        return { error: 'state_expired' }
      }
    }

    const config = await client.query<{ per_bishu_usdt_price: string }>('SELECT per_bishu_usdt_price::text FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1 FOR SHARE', [botRid])
    if (!config.rows[0]) { await client.query('ROLLBACK'); return { error: 'unconfigured' } }
    const unitCents = scaledUnits(config.rows[0].per_bishu_usdt_price, 2)
    if (unitCents == null || unitCents <= 0n) { await client.query('ROLLBACK'); return { error: 'invalid_config' } }
    const totalCents = unitCents * BigInt(quantity)
    if (totalCents <= 0n || totalCents >= 100_000_000_000_000n) { await client.query('ROLLBACK'); return { error: 'limit' } }
    const users = await client.query<{ rid: number; cash_usdt: string }>('SELECT rid,cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1 FOR UPDATE', [botRid, chatId])
    if (!users.rows[0]) { await client.query('ROLLBACK'); return { error: 'missing_user' } }
    const wallets = await client.query<{ rid: number; bot_rid: number; tg_uid: string | null; max_buy_quantity: number; total_buy_usdt: string; is_active: string | null }>('SELECT rid,bot_rid,tg_uid,max_buy_quantity,total_buy_usdt::text,is_active FROM t_energy_ai_bishu WHERE wallet_addr=$1 ORDER BY rid ASC LIMIT 1 FOR UPDATE', [address])
    const wallet = wallets.rows[0]
    if (wallet && (Number(wallet.bot_rid) !== botRid || String(wallet.tg_uid ?? '') !== chatId)) { await client.query('ROLLBACK'); return { error: 'owned' } }
    const previousQuantity = Number(wallet?.max_buy_quantity ?? 0)
    const newQuantity = previousQuantity + quantity
    if (!Number.isSafeInteger(previousQuantity) || previousQuantity < 0 || newQuantity > 2_147_483_647) { await client.query('ROLLBACK'); return { error: 'limit' } }
    if (wallet) {
      const previousCents = scaledUnits(wallet.total_buy_usdt, 2)
      if (previousCents == null || previousCents + totalCents >= 100_000_000_000_000n) { await client.query('ROLLBACK'); return { error: 'limit' } }
    }
    const debit = await client.query('UPDATE t_telegram_bot_user SET cash_usdt=cash_usdt-$2::numeric WHERE rid=$1 AND cash_usdt>=$2::numeric RETURNING cash_usdt::text', [users.rows[0].rid, moneyText(totalCents)])
    if (!debit.rowCount) { await client.query('ROLLBACK'); return { error: 'insufficient' } }
    let savedWallet: { rid: number; is_active: string | null }
    if (wallet) {
      const changed = await client.query<{ rid: number; is_active: string | null }>("UPDATE t_energy_ai_bishu SET max_buy_quantity=max_buy_quantity+$2,total_buy_usdt=total_buy_usdt+$3::numeric,tg_uid=$4,update_time=now() WHERE rid=$1 RETURNING rid,is_active", [wallet.rid, quantity, moneyText(totalCents), chatId])
      if (!changed.rows[0]) throw new Error('bishu_purchase_wallet_update_failed')
      savedWallet = changed.rows[0]
    } else {
      const created = await client.query<{ rid: number; is_active: string | null }>("INSERT INTO t_energy_ai_bishu(bot_rid,tg_uid,wallet_addr,status,is_buy,is_notice,is_notice_admin,total_buy_usdt,max_buy_quantity,total_buy_quantity,back_comments,create_by,create_time,is_active) VALUES($1,$2,$3,0,'Y','N','N',$4::numeric,$5,0,'',0,now(),'N') RETURNING rid,is_active", [botRid, chatId, address, moneyText(totalCents), quantity])
      if (!created.rows[0]) throw new Error('bishu_purchase_wallet_create_failed')
      savedWallet = created.rows[0]
    }
    const inserted = await client.query<BishuPurchase>("INSERT INTO t_platform_telegram_bishu_purchase(update_rid,bot_rid,chat_id,wallet_addr,quantity,unit_price,total_price,previous_quantity,new_quantity,wallet_rid,is_active) VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10,$11) RETURNING update_rid,wallet_addr,quantity,unit_price::text,total_price::text,previous_quantity,new_quantity,wallet_rid,is_active,notification_sent_at", [updateRid, botRid, chatId, address, quantity, moneyText(unitCents), moneyText(totalCents), previousQuantity, newQuantity, savedWallet.rid, savedWallet.is_active ?? 'N'])
    if (requirePromptState) await client.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$2 AND state='bishu_add_count' AND prompt_message_id=$3", [botRid, chatId, promptMessageId])
    await client.query('COMMIT')
    return { purchase: inserted.rows[0] }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}
async function sendBishuPurchaseResult(pool: Database, fetcher: typeof fetch, botRid: number, chatId: string, message: Message, purchase: BishuPurchase) {
  if (purchase.notification_sent_at) return
  const token = await botTokenFor(pool, botRid)
  const address = String(purchase.wallet_addr), active = purchase.is_active === 'Y'
  const short = `${address.slice(0, 8)}...${address.slice(-6)}`
  const text = `✅ <b>地址添加成功！</b>\n\n📍 钱包地址：<code>${escapeTelegramHtml(address)}</code>\n${purchase.previous_quantity > 0 ? `📊 原购买总次数：${purchase.previous_quantity}\n` : ''}➕ 本次新增次数：${purchase.quantity}\n💰 扣除USDT：${escapeTelegramHtml(purchase.total_price)} USDT\n\n📊 <b>当前状态：${active ? '🔴已激活' : '⚪未激活'}</b>\n💡 点击下方地址按钮可切换激活/停用状态`
  const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [[{ text: `${short} ${active ? '🔴已激活' : '⚪未激活'}`, callback_data: `togglebishu_${purchase.wallet_rid}_${active ? 'N' : 'Y'}` }]]
  const bot = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const admin = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const contactRow: Array<{ text: string; url?: string; callback_data?: string }> = []
  if (/^[A-Za-z0-9_]{5,32}$/u.test(admin)) contactRow.push({ text: '👨联系客服', url: `https://t.me/${admin}` })
  contactRow.push({ text: '✏️已绑通知地址', callback_data: 'energybishusearch' })
  keyboard.push(contactRow)
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), reply_markup: { inline_keyboard: keyboard } })
  if (!sent.ok) throw new Error('bishu_purchase_confirmation_failed')
  await pool.query('UPDATE t_platform_telegram_bishu_purchase SET notification_sent_at=COALESCE(notification_sent_at,now()) WHERE update_rid=$1', [purchase.update_rid])
}
async function handlePrivateEnergyBishuAddCountReply(pool: Database, fetcher: typeof fetch, botRid: number, updateRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const prior = await bishuPurchaseByUpdate(pool, updateRid)
  if (prior) { await sendBishuPurchaseResult(pool, fetcher, botRid, chatId, message, prior); return true }
  const state = await pool.query<{ state: string; context: { walletAddr?: string } | string | null }>(
    "SELECT state,context FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_add_count' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (state.rows[0]?.state !== 'bishu_add_count') return false
  const rawContext = state.rows[0].context
  const context = typeof rawContext === 'string' ? (() => { try { return JSON.parse(rawContext) as { walletAddr?: string } } catch { return {} } })() : rawContext
  const address = String(context?.walletAddr ?? '')
  if (!isTronAddressText(address)) {
    await pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bishu_add_count'", [botRid, chatId, userId])
    const sent = await tg(fetcher, await botTokenFor(pool, botRid), 'sendMessage', { chat_id: chatId, text: '增加地址状态已失效，请重新点击「增加地址笔数」。', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('bishu_add_state_expired_reply_failed')
    return true
  }
  const rawQuantity = textOf(message)
  if (!/^\d{1,10}$/u.test(rawQuantity) || BigInt(rawQuantity) < 1n || BigInt(rawQuantity) > 2_147_483_647n) {
    const sent = await tg(fetcher, await botTokenFor(pool, botRid), 'sendMessage', { chat_id: chatId, text: '笔数必须是 1 到 2147483647 之间的整数，请直接回复刚才的笔数提示重新输入。', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id) })
    if (!sent.ok) throw new Error('bishu_add_invalid_quantity_reply_failed')
    return true
  }
  const outcome = await purchaseEnergyBishu(pool, botRid, chatId, updateRid, String(message.reply_to_message.message_id), address, Number(rawQuantity))
  if (outcome.purchase) { await sendBishuPurchaseResult(pool, fetcher, botRid, chatId, message, outcome.purchase); return true }
  const token = await botTokenFor(pool, botRid)
  let reply = '❌ 地址添加失败，请重试或联系客服'
  if (outcome.error === 'missing_user') reply = '⚠️用户信息为空，请发送 /start 初始化用户，然后再执行添加命令'
  else if (outcome.error === 'unconfigured' || outcome.error === 'invalid_config') reply = '⚠️机器人能量笔数未配置，请联系客服'
  else if (outcome.error === 'owned') reply = `❌地址：${address} 已被其他用户绑定，请联系管理处理！`
  else if (outcome.error === 'insufficient') {
    const current = await pool.query<{ cash_usdt: string }>('SELECT cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, chatId])
    const price = await pool.query<{ per_bishu_usdt_price: string }>('SELECT per_bishu_usdt_price::text FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1', [botRid])
    const unit = scaledUnits(price.rows[0]?.per_bishu_usdt_price, 2) ?? 0n
    reply = `❌用户USDT余额不足，当前余额：${balanceText(current.rows[0]?.cash_usdt)} USDT，需要：${moneyText(unit * BigInt(Number(rawQuantity)))} USDT，请先在机器人充值USDT！`
  } else if (outcome.error === 'limit') reply = '❌ 增加笔数超过系统允许范围，请减少笔数后重试。'
  else if (outcome.error === 'state_expired') reply = '增加地址状态已过期，请重新点击「增加地址笔数」。'
  const bot = await pool.query<{ bot_admin_username: string | null }>('SELECT bot_admin_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const admin = String(bot.rows[0]?.bot_admin_username ?? '').replace(/^@/u, '')
  const keyboard = /^[A-Za-z0-9_]{5,32}$/u.test(admin) ? { inline_keyboard: [[{ text: '👨联系客服', url: `https://t.me/${admin}` }]] } : undefined
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: chatId, text: reply, parse_mode: 'HTML', allow_sending_without_reply: true, reply_to_message_id: String(message.message_id), ...(keyboard ? { reply_markup: keyboard } : {}) })
  if (!sent.ok) throw new Error('bishu_purchase_rejection_reply_failed')
  return true
}
async function handlePrivateEnergyBishuDirectPurchase(pool: Database, fetcher: typeof fetch, botRid: number, updateRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || String(message.from.id) !== String(message.chat.id)) return false
  const raw = textOf(message)
  const prefix = /^(?:添加笔数|增加笔数)(?:$|\s)/u
  if (!prefix.test(raw)) return false
  const token = await botTokenFor(pool, botRid)
  const match = /^(?:添加笔数|增加笔数)\s+(\S+)\s+(\d+)\s*$/u.exec(raw)
  if (!match || !isTronAddressText(match[1]) || !/^[1-9]\d{0,9}$/u.test(match[2]) || BigInt(match[2]) > 2_147_483_647n) {
    const sent = await tg(fetcher, token, 'sendMessage', { chat_id: String(message.chat.id), text: '⚠️请输入格式：添加笔数 Tdfal3432xxxxxx 100，表示给地址增加 100 笔免费转账次数。', reply_to_message_id: String(message.message_id), allow_sending_without_reply: true })
    if (!sent.ok) throw new Error('bishu_direct_purchase_usage_reply_failed')
    return true
  }
  const address = match[1], quantity = Number(match[2])
  const outcome = await purchaseEnergyBishu(pool, botRid, String(message.chat.id), updateRid, String(message.message_id), address, quantity, false)
  if (outcome.purchase) {
    await sendBishuPurchaseResult(pool, fetcher, botRid, String(message.chat.id), message, outcome.purchase)
    return true
  }
  let reply = '❌ 地址添加失败，请重试或联系客服'
  if (outcome.error === 'missing_user') reply = '⚠️用户信息为空，请发送 /start 初始化用户，然后再执行添加命令'
  else if (outcome.error === 'unconfigured' || outcome.error === 'invalid_config') reply = '⚠️机器人能量笔数未配置，请联系客服'
  else if (outcome.error === 'owned') reply = `❌地址：${address} 已被其他用户绑定，请联系管理处理！`
  else if (outcome.error === 'insufficient') {
    const current = await pool.query<{ cash_usdt: string }>('SELECT cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, String(message.chat.id)])
    const price = await pool.query<{ per_bishu_usdt_price: string }>('SELECT per_bishu_usdt_price::text FROM t_energy_platform_bot WHERE bot_rid=$1 LIMIT 1', [botRid])
    const unit = scaledUnits(price.rows[0]?.per_bishu_usdt_price, 2) ?? 0n
    reply = `❌用户USDT余额不足，当前余额：${balanceText(current.rows[0]?.cash_usdt)} USDT，需要：${moneyText(unit * BigInt(quantity))} USDT，请先在机器人充值USDT！`
  } else if (outcome.error === 'limit') reply = '❌ 增加笔数超过系统允许范围，请减少笔数后重试。'
  const sent = await tg(fetcher, token, 'sendMessage', { chat_id: String(message.chat.id), text: reply, parse_mode: 'HTML', reply_to_message_id: String(message.message_id), allow_sending_without_reply: true })
  if (!sent.ok) throw new Error('bishu_direct_purchase_rejection_reply_failed')
  return true
}
async function handlePrivateWalletAddressReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='wallet_address' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (!state.rows[0]) return false
  const finishState = () => pool.query("DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='wallet_address'", [botRid, chatId, userId])
  const address = textOf(message)
  const safeAddress = escapeTelegramHtml(address)
  if (!isTronAddressText(address)) {
    await sendBindASendNText(pool, fetcher, botRid, chatId, '❌ 地址格式错误，请输入有效的 TRON 地址（以 T 开头，共 34 位）')
    return true
  }
  const client = await (pool as Pool).connect()
  let duplicate = false
  let updated = false
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-wallet-binding:' || $1 || ':' || $2,0))", [botRid, address])
    const used = await client.query('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND bind_trc_wallet_addr=$2 AND tg_uid<>$3 LIMIT 1', [botRid, address, chatId])
    if (used.rowCount) {
      duplicate = true
      await client.query('ROLLBACK')
    } else {
      const result = await client.query('UPDATE t_telegram_bot_user SET bind_trc_wallet_addr=$3 WHERE bot_rid=$1 AND tg_uid=$2', [botRid, chatId, address])
      updated = Boolean(result.rowCount)
      await client.query(updated ? 'COMMIT' : 'ROLLBACK')
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  if (duplicate) {
    await sendBindASendNText(pool, fetcher, botRid, chatId, `绑定地址：<code>${safeAddress}</code>\n绑定结果：该地址已被其他用户绑定，如果该地址是您的地址，请联系客服处理！`, {
      ...(await walletBindingReplyMarkup(pool, botRid)),
    })
    await finishState()
    return true
  }
  if (!updated) {
    await sendBindASendNText(pool, fetcher, botRid, chatId, '绑定失败：未找到您的机器人用户记录，请先发送 /start 后重试。')
    await finishState()
    return true
  }
  await sendBindASendNText(pool, fetcher, botRid, chatId, `绑定地址：<code>${safeAddress}</code>\n绑定结果：绑定成功`, await walletBindingReplyMarkup(pool, botRid))
  await finishState()
  return true
}
async function handleBindASendNCallback(pool: Database, fetcher: typeof fetch, botRid: number, update: Update['update_body']) {
  const data = bindASendNCallback(update)
  if (!data) return false
  const config = await bindASendNConfig(pool, botRid)
  if (data.data === 'bindABind') {
    if (!config || Number(config.is_enable) !== 1) {
      await sendBindASendNText(pool, fetcher, botRid, data.chatId, '绑A送N功能已关闭，请联系管理员')
      return true
    }
    await pool.query(
      "INSERT INTO t_platform_telegram_conversation_state(bot_rid,chat_id,user_id,state,expires_at) VALUES($1,$2,$3,'bindA_address',now()+interval '5 minutes') ON CONFLICT(bot_rid,chat_id,user_id) DO UPDATE SET state='bindA_address',prompt_message_id=NULL,expires_at=now()+interval '5 minutes',updated_at=now()",
      [botRid, data.chatId, data.userId],
    )
    const promptMessageId = await sendBindASendNText(pool, fetcher, botRid, data.chatId,
      '请回复你的 <b>A地址</b>（TRON钱包地址，以 T 开头，长度 34 位）\n\n格式示例：\n<code>TLaQDfvFWrLPvNNFQbqBhJRG2mV7R1Bq4F</code>',
      { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'bindA' }]] },
    )
    if (promptMessageId) await pool.query("UPDATE t_platform_telegram_conversation_state SET prompt_message_id=$4,updated_at=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bindA_address'", [botRid, data.chatId, data.userId, promptMessageId])
    return true
  }
  if (data.data === 'bindAUnbind') {
    const binding = await pool.query<{ rid: number; wallet_addr: string }>(
      'SELECT rid,wallet_addr FROM t_bind_a_send_n_binding WHERE bot_rid=$1 AND tg_uid=$2 AND status IN (0,1) ORDER BY rid DESC LIMIT 1',
      [botRid, data.chatId],
    )
    if (!binding.rowCount) {
      await sendBindASendNText(pool, fetcher, botRid, data.chatId, '暂未绑定地址，无需解绑')
      return true
    }
    await pool.query("UPDATE t_bind_a_send_n_binding SET status=2,unbind_time=now(),unbind_by=0,unbind_reason='用户自助解绑' WHERE rid=$1 AND status IN (0,1)", [binding.rows[0].rid])
    await sendBindASendNText(pool, fetcher, botRid, data.chatId, `✅ 已解绑 A地址 <code>${binding.rows[0].wallet_addr}</code>`, {
      inline_keyboard: [[{ text: '🔗 重新绑定', callback_data: 'bindABind' }], [{ text: '🔄 刷新', callback_data: 'bindA' }]],
    })
    return true
  }
  if (!config || Number(config.is_enable) !== 1) {
    await sendBindASendNText(pool, fetcher, botRid, data.chatId, '绑A送N功能已关闭，请联系管理员')
    return true
  }
  const binding = await pool.query<{ wallet_addr: string; status: number }>(
    'SELECT wallet_addr,status FROM t_bind_a_send_n_binding WHERE bot_rid=$1 AND tg_uid=$2 AND status IN (0,1) ORDER BY rid DESC LIMIT 1',
    [botRid, data.chatId],
  )
  let statusText = '❌ 暂未绑定A地址'
  const keyboard: Array<{ text: string; callback_data: string }> = []
  if (binding.rowCount) {
    const current = binding.rows[0]
    statusText = Number(current.status) === 1 ? `✅ 已绑定：\n<code>${current.wallet_addr}</code>` : `⏳ 待激活：\n<code>${current.wallet_addr}</code>`
    keyboard.push({ text: '🔗 绑定新地址（需先解绑）', callback_data: 'bindABind' }, { text: '❌ 解绑A地址', callback_data: 'bindAUnbind' })
  } else keyboard.push({ text: '🔗 绑定A地址', callback_data: 'bindABind' })
  let receiveWallet = ''
  if (config.energy_platform_bot_rid) {
    const receive = await pool.query<{ receive_wallet: string | null }>('SELECT receive_wallet FROM t_energy_platform_bot WHERE rid=$1', [config.energy_platform_bot_rid])
    receiveWallet = String(receive.rows[0]?.receive_wallet ?? '')
  }
  const text = `🤖 <b>绑A送N</b>\n\n${statusText}${receiveWallet ? `\n\n💰 收款地址：<code>${receiveWallet}</code>` : ''}\n\n📋 说明：绑定你的 A 地址后，当 A 向任意 N 地址转出 USDT 时，系统自动向 N 地址发放能量。`
  keyboard.push({ text: '🔄 刷新', callback_data: 'bindA' })
  await sendBindASendNText(pool, fetcher, botRid, data.chatId, text, { inline_keyboard: [keyboard] })
  return true
}
async function handleBindASendNAddressReply(pool: Database, fetcher: typeof fetch, botRid: number, message: Message) {
  if (message.chat.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false
  const chatId = String(message.chat.id), userId = String(message.from.id)
  const state = await pool.query<{ state: string }>(
    "SELECT state FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state='bindA_address' AND expires_at>now() AND prompt_message_id=$4 LIMIT 1",
    [botRid, chatId, userId, String(message.reply_to_message.message_id)],
  )
  if (!state.rows[0]) return false
  const finishState = () => pool.query('DELETE FROM t_platform_telegram_conversation_state WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND state=\'bindA_address\'', [botRid, chatId, userId])
  const address = textOf(message)
  if (!/^[1-9A-HJ-NP-Za-km-z]{34}$/u.test(address) || !address.startsWith('T')) {
    await sendBindASendNText(pool, fetcher, botRid, chatId, '❌ 地址格式错误，请输入有效的 TRON 地址（以 T 开头，共 34 位）')
    await finishState()
    return true
  }
  const config = await bindASendNConfig(pool, botRid)
  if (!config || Number(config.is_enable) !== 1) {
    await sendBindASendNText(pool, fetcher, botRid, chatId, '绑A送N功能已关闭，请联系管理员')
    await finishState()
    return true
  }
  const client = await (pool as Pool).connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bindasendn-user:' || $1 || ':' || $2,0))", [botRid, chatId])
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bindasendn-address:' || $1,0))", [address])
    const blacklist = await client.query('SELECT rid FROM t_transit_wallet_black WHERE black_wallet=$1 LIMIT 1', [address])
    if (blacklist.rowCount) {
      await client.query('ROLLBACK')
      await sendBindASendNText(pool, fetcher, botRid, chatId, '❌ 该地址在黑名单中，无法绑定')
      await finishState()
      return true
    }
    const current = await client.query<{ wallet_addr: string }>('SELECT wallet_addr FROM t_bind_a_send_n_binding WHERE bot_rid=$1 AND tg_uid=$2 AND status IN (0,1) ORDER BY rid DESC LIMIT 1', [botRid, chatId])
    if (current.rowCount && current.rows[0].wallet_addr !== address) {
      await client.query('ROLLBACK')
      await sendBindASendNText(pool, fetcher, botRid, chatId, `⚠️ 你已绑定 A 地址 <code>${current.rows[0].wallet_addr}</code>，请先解绑后再绑定新地址`, {
        inline_keyboard: [[{ text: '❌ 解绑', callback_data: 'bindAUnbind' }], [{ text: '🔄 刷新', callback_data: 'bindA' }]],
      })
      await finishState()
      return true
    }
    if (!current.rowCount) {
      const used = await client.query('SELECT rid FROM t_bind_a_send_n_binding WHERE wallet_addr=$1 AND status IN (0,1) LIMIT 1', [address])
      if (used.rowCount) {
        await client.query('ROLLBACK')
        await sendBindASendNText(pool, fetcher, botRid, chatId, '❌ 该地址已被其他用户绑定')
        await finishState()
        return true
      }
      const threshold = String(config.activate_threshold ?? '0')
      if (threshold !== '0' && !/^0+(?:\.0+)?$/u.test(threshold)) {
        const balance = await client.query<{ enough: boolean }>('SELECT cash_trx >= $3::numeric AS enough FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [botRid, chatId, threshold])
        if (!balance.rowCount || balance.rows[0].enough !== true) {
          await client.query('ROLLBACK')
          await sendBindASendNText(pool, fetcher, botRid, chatId, `⚠️ 绑定前需账户 TRX 余额 ≥ ${threshold}，当前余额不足`)
          await finishState()
          return true
        }
      }
      await client.query('INSERT INTO t_bind_a_send_n_binding(bot_rid,tg_uid,wallet_addr,status,activate_threshold,create_by,create_time) VALUES($1,$2,$3,0,$4,0,now())', [botRid, chatId, address, threshold])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  await sendBindASendNText(pool, fetcher, botRid, chatId, `✅ A 地址绑定成功！\n\n<code>${address}</code>\n\n状态：待激活\n\n请联系管理员审核激活后即可使用。`, {
    inline_keyboard: [[{ text: '🔄 查看状态', callback_data: 'bindA' }]],
  })
  await finishState()
  return true
}
function sharedRequest(m: Message) {
  const userShared = m.user_shared && typeof m.user_shared === 'object' ? m.user_shared as Record<string, unknown> : null
  const chatShared = m.chat_shared && typeof m.chat_shared === 'object' ? m.chat_shared as Record<string, unknown> : null
  const userRequestId = Number(userShared?.request_id)
  const chatRequestId = Number(chatShared?.request_id)
  const requestId = userRequestId === 1 || userRequestId === 3 ? userRequestId : chatRequestId === 2 || chatRequestId === 4 ? chatRequestId : 0
  const id = requestId === 1 || requestId === 3 ? userShared?.user_id : requestId === 2 || requestId === 4 ? chatShared?.chat_id : null
  const labels: Record<number, string> = { 1: '用户ID：', 2: '群组ID：', 3: '机器人ID：', 4: '频道ID：' }
  const normalizedId = String(id ?? '')
  if (!requestId || !/^-?\d{1,20}$/u.test(normalizedId) || (requestId === 1 || requestId === 3) && normalizedId.startsWith('-')) return null
  return { label: labels[requestId], id: normalizedId }
}
async function handleSharedRequest(pool: Database, fetcher: typeof fetch, rid: number, m: Message) {
  const shared = sharedRequest(m)
  if (!shared) return false
  const token = await botTokenFor(pool, rid)
  const sent = await tg(fetcher, token, 'sendMessage', {
    chat_id: String(m.chat.id),
    text: shared.label + '<code>' + shared.id + '</code>',
    allow_sending_without_reply: true,
    parse_mode: 'HTML',
  })
  if (!sent.ok) throw new Error('shared_id_reply_failed')
  return true
}
async function handlePrivateStart(pool: Database, fetcher: typeof fetch, rid: number, m: Message) {
  const userId = String(m.from!.id), username = m.from?.username ?? ''
  const nickname = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
  const bot = await pool.query<{ bot_token: string | null; bot_username: string | null }>(
    'SELECT bot_token,bot_username FROM t_telegram_bot WHERE rid=$1', [rid],
  )
  const current = bot.rows[0]
  if (!current?.bot_token) throw new Error('private_start_bot_missing')
  const mention = /^\/start@([a-z0-9_]+)$/iu.exec(textOf(m))?.[1]
  const botUsername = String(current.bot_username ?? '').replace(/^@/, '')
  if (mention && (!botUsername || mention.toLowerCase() !== botUsername.toLowerCase())) return

  const client = 'connect' in pool && typeof (pool as Pool).connect === 'function' ? await (pool as Pool).connect() : null
  if (!client) throw new Error('private_start_database_transaction_unavailable')
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram-private-start:' || $1 || ':' || $2,0))", [rid, userId])
    const found = await client.query<{ rid: number }>('SELECT rid FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [rid, userId])
    if (found.rowCount) {
      await client.query('UPDATE t_telegram_bot_user SET status=1,tg_username=$2,tg_nickname=$3,last_time=now(),stop_time=NULL WHERE rid=$1', [found.rows[0].rid, username, nickname])
    } else {
      await client.query('INSERT INTO t_telegram_bot_user(bot_rid,tg_uid,tg_username,tg_nickname,status,first_time) VALUES($1,$2,$3,$4,1,now())', [rid, userId, username, nickname])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }

  const commands = await pool.query<{ command: string; description: string; command_type: number }>(
    'SELECT command,description,command_type FROM t_telegram_bot_command WHERE bot_rid=$1 ORDER BY seq_sn DESC,rid ASC', [rid],
  )
  const privateCommands = commands.rows
    .filter(row => row.command_type === 1 || row.command_type === 2)
    .map(row => ({ command: row.command, description: row.description }))
  if (privateCommands.length) {
    const result = await tg(fetcher, current.bot_token, 'setMyCommands', { commands: privateCommands, scope: { type: 'all_private_chats' } })
    if (!result.ok) console.warn('Telegram private command menu sync failed')
  }
}
async function handleVerificationMiniAppStart(pool: Database, fetcher: typeof fetch, botRid: number, m: Message, token: string) {
  const tokenHash = digest(token)
  const botToken = await botTokenFor(pool, botRid)
  const verification = await pool.query<{ rid: number; user_id: string; status: string; expires_at: Date | string; mini_app_message_id: number | null }>(
    'SELECT rid,user_id::text,status,expires_at,mini_app_message_id FROM t_telegram_verification WHERE bot_rid=$1 AND token_hash=$2 LIMIT 1',
    [botRid, tokenHash],
  )
  const current = verification.rows[0]
  let responseText = ''
  let miniAppUrl = ''
  if (!current || String(current.user_id) !== String(m.from?.id ?? '')) {
    responseText = '该验证链接无效，或不属于当前 Telegram 账号。'
  } else if (current.status === 'verified') {
    responseText = '该验证已经完成。'
  } else if (current.status !== 'pending' || new Date(current.expires_at).getTime() <= Date.now()) {
    responseText = '该验证链接已失效，请返回群组重新发起。'
  } else {
    const origin = process.env.PLATFORM_ORIGIN
    if (!origin || new URL(origin).protocol !== 'https:') throw new Error('verification_origin_not_configured')
    miniAppUrl = new URL('/api/moderation?verify=' + encodeURIComponent(token), new URL(origin).origin).toString()
    responseText = '请点击下方按钮，在 Telegram Mini App 内完成验证。'
    if (current.mini_app_message_id) {
      await tg(fetcher, botToken, 'deleteMessage', { chat_id: String(m.chat.id), message_id: current.mini_app_message_id })
    }
  }
  const payload: Record<string, unknown> = { chat_id: String(m.chat.id), text: responseText }
  if (miniAppUrl) payload.reply_markup = { inline_keyboard: [[{ text: '打开 Mini App 验证', web_app: { url: miniAppUrl } }]] }
  const sent = await tg(fetcher, botToken, 'sendMessage', payload)
  if (!sent.ok) throw new Error('verification_mini_app_message_failed')
  if (miniAppUrl && current) {
    await pool.query('UPDATE t_telegram_verification SET mini_app_message_id=$2,update_time=now() WHERE rid=$1 AND status=\'pending\'', [current.rid, sent.result?.message_id ?? null])
  }
}
async function botTokenFor(pool: Database, rid: number) {
  const result = await pool.query<{ bot_token: string | null }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [rid])
  const token = result.rows[0]?.bot_token
  if (!token) throw new Error('verification_bot_missing')
  return token
}
async function adminChat(pool: Database, rid: number, username: string | null) {
  const name = String(username ?? '').replace(/^@/, '').trim()
  if (!name || name === '-') return null
  const r = await pool.query<{ tg_uid: string }>("SELECT tg_uid::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND status=1 AND lower(trim(tg_username,'@'))=lower($2) LIMIT 1", [rid, name])
  return r.rows[0]?.tg_uid ?? null
}
async function currentSession(pool: Database, rid: number, userId: string) {
  return (await pool.query<{ rid: number; status: string; expires_at: Date | string; verification_message_id: number | null }>("SELECT rid,status,expires_at,verification_message_id FROM t_telegram_verification WHERE bot_rid=$1 AND user_id=$2 AND verification_type='support' ORDER BY rid DESC LIMIT 1", [rid, userId])).rows[0]
}
async function log(pool: Database, rid: number, chat: string, user: string, message: string | null, event: string, action: string, reason: string, body: string) {
  await pool.query('INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,now())', [rid, chat, user, message, event, action, reason, Array.from(body).slice(0, 450).join('')])
}
async function start(pool: Database, fetcher: typeof fetch, rid: number, m: Message, c: Config) {
  const user = String(m.from!.id), chat = String(m.chat.id)
  if (!await adminChat(pool, rid, c.bot_admin_username)) {
    await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '机器人管理员尚未连接客服。请管理员先私聊本机器人发送 /start。' })
    await log(pool, rid, chat, user, String(m.message_id), 'support_session', 'failed', '未找到机器人管理员私聊账号', '')
    return
  }
  await pool.query("UPDATE t_telegram_verification SET status='cancelled',update_time=now() WHERE bot_rid=$1 AND user_id=$2 AND verification_type='support' AND status IN ('pending','processing','verified')", [rid, user])
  if (c.support_captcha_enabled) {
    const token = randomBytes(32).toString('hex')
    const saved = await pool.query<{ rid: number }>("INSERT INTO t_telegram_verification(token_hash,bot_rid,chat_id,user_id,user_chat_id,verification_type,status,expires_at,create_time,update_time) VALUES($1,$2,NULL,$3,$4,'support','pending',now()+interval '10 minutes',now(),now()) RETURNING rid", [digest(token), rid, user, chat])
    const origin = process.env.PLATFORM_ORIGIN
    if (!origin || new URL(origin).protocol !== 'https:') throw new Error('support_origin_not_configured')
    const url = new URL('/api/moderation?verify=' + encodeURIComponent(token), origin).toString()
    const sent = await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '开始客服会话前，请先完成人机验证。', reply_markup: { inline_keyboard: [[{ text: '打开 Mini App 验证', web_app: { url } }]] } })
    if (!sent.ok) throw new Error('support_challenge_send_failed')
    await pool.query('UPDATE t_telegram_verification SET verification_message_id=$2,update_time=now() WHERE rid=$1', [saved.rows[0].rid, sent.result?.message_id ?? null])
    await log(pool, rid, chat, user, String(sent.result?.message_id ?? m.message_id), 'support_verification_started', 'pending', '每次开启客服均需重新验证', '')
  } else {
    await pool.query("INSERT INTO t_telegram_verification(token_hash,bot_rid,chat_id,user_id,user_chat_id,verification_type,status,expires_at,verified_at,create_time,update_time) VALUES($1,$2,NULL,$3,$4,'support','verified',now()+($5::text||' minutes')::interval,now(),now(),now())", [digest(randomBytes(32).toString('hex')), rid, user, chat, Math.max(5, Number(c.support_verified_minutes) || 1440)])
    const sent = await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '客服会话已开启，请直接发送文字、图片或文件。发送 /endsupport 可结束会话。' })
    if (!sent.ok) throw new Error('support_session_notice_failed')
    await log(pool, rid, chat, user, String(sent.result?.message_id ?? m.message_id), 'support_session', 'opened', '客服验证未启用', '')
  }
}
async function handleAdminReply(pool: Database, fetcher: typeof fetch, rid: number, m: Message, c: Config) {
  const admin = await adminChat(pool, rid, c.bot_admin_username)
  if (!admin || String(m.from?.id) !== admin || String(m.chat.id) !== admin || !m.reply_to_message?.message_id) return false
  const mapping = await pool.query<{ user_id: string }>("SELECT user_id::text FROM t_telegram_support_message WHERE bot_rid=$1 AND support_chat_id=$2 AND support_message_id=$3 AND direction='user_to_support' ORDER BY rid DESC LIMIT 1", [rid, admin, String(m.reply_to_message.message_id)])
  const user = mapping.rows[0]?.user_id
  if (!user) return false
  const copied = await tg(fetcher, c.bot_token!, 'copyMessage', { chat_id: user, from_chat_id: admin, message_id: String(m.message_id) })
  if (!copied.ok) throw new Error('support_reply_delivery_failed')
  await pool.query("INSERT INTO t_telegram_support_message(bot_rid,user_id,support_chat_id,user_message_id,support_message_id,direction,is_ad,create_time) VALUES($1,$2,$3,$4,$5,'support_to_user',false,now())", [rid, user, admin, copied.result?.message_id ?? null, String(m.message_id)])
  await log(pool, rid, admin, user, String(m.message_id), 'support_message', 'support_to_user', '客服回复已发送给用户', preview(m))
  return true
}
async function isBusinessMessage(pool: Database, rid: number, c: Config, m: Message) {
  const text = textOf(m)
  if (!text) return false
  if ((m.entities || []).some((e: any) => e?.type === 'bot_command') || /^\/[a-z0-9_]+(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text)) return true
  const username = String(c.bot_username ?? '').replace(/^@/, '')
  const normalized = (username ? text.replace('@' + username, '') : text).trim().toLocaleLowerCase('und')
  if (!normalized) return false
  const [commands, replies] = await Promise.all([
    pool.query<{ command: string }>('SELECT command FROM t_telegram_bot_command WHERE bot_rid=$1', [rid]),
    pool.query<{ monitor_word: string }>('SELECT monitor_word FROM t_telegram_bot_keyreply WHERE bot_rid=$1 AND status=0 AND key_type=1', [rid]),
  ])
  if (commands.rows.some(row => normalized.replace(/^\//, '') === String(row.command).trim().replace(/^\//, '').toLocaleLowerCase('und'))) return true
  return replies.rows.some(row => String(row.monitor_word).split(/[,，\r\n]+/u).some(word => normalized === word.trim().toLocaleLowerCase('und')))
}

async function handleUser(pool: Database, fetcher: typeof fetch, rid: number, m: Message, c: Config) {
  const user = String(m.from!.id), chat = String(m.chat.id), current = await currentSession(pool, rid, user)
  if (!current || !['pending','verified'].includes(current.status)) return false
  if (new Date(current.expires_at).getTime() <= Date.now()) {
    await pool.query("UPDATE t_telegram_verification SET status='expired',update_time=now() WHERE rid=$1 AND status IN ('pending','verified')", [current.rid])
    await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '客服会话已过期，请发送 /support 重新开始。' })
    return true
  }
  const text = textOf(m)
  if (isStart(text) || isEnd(text)) return false
  if (await isBusinessMessage(pool, rid, c, m)) {
    await pool.query("UPDATE t_telegram_verification SET status='cancelled',update_time=now() WHERE rid=$1 AND status IN ('pending','verified')", [current.rid])
    return false
  }
  if (current.status === 'pending') {
    await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '本次客服会话尚未通过验证，请点击验证按钮，或重新发送 /support。' })
    return true
  }
  const cfg = await pool.query<{ ad_score_threshold: number; ad_keywords: string | null }>('SELECT ad_score_threshold,ad_keywords FROM t_telegram_bot_moderation_config WHERE bot_rid=$1', [rid])
  const words = String(cfg.rows[0]?.ad_keywords || '').split(/[,，\r\n]+/u).map(v => v.trim()).filter(Boolean)
  const analysis = analyzeMessage(m, words, false, Number(cfg.rows[0]?.ad_score_threshold) || 4)
  if (analysis.isAd) {
    await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '消息疑似包含广告或站外引流信息，未转交客服。请移除链接和联系方式后重试。' })
    await log(pool, rid, chat, user, String(m.message_id), 'support_ad', 'reject', analysis.reasons.join('、'), analysis.preview)
    return true
  }
  const admin = await adminChat(pool, rid, c.bot_admin_username)
  if (!admin) {
    await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '机器人管理员当前未连接，消息暂未转交。请稍后重试或发送 /endsupport 结束会话。' })
    await log(pool, rid, chat, user, String(m.message_id), 'support_message', 'failed', '机器人管理员私聊账号不可用', analysis.preview)
    return true
  }
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ').trim() || '未命名用户'
  const label = '客服消息 | ' + name + ' | ID ' + user + (m.from?.username ? ' | @' + m.from.username : '') + '\n请直接回复此条用户消息。'
  const title = await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: admin, text: label })
  const copied = await tg(fetcher, c.bot_token!, 'copyMessage', { chat_id: admin, from_chat_id: chat, message_id: String(m.message_id) })
  if (!title.ok || !copied.ok || !copied.result?.message_id) throw new Error('support_forward_failed')
  await pool.query("INSERT INTO t_telegram_support_message(bot_rid,user_id,support_chat_id,user_message_id,support_message_id,direction,is_ad,create_time) VALUES($1,$2,$3,$4,$5,'user_to_support',false,now())", [rid, user, admin, String(m.message_id), copied.result.message_id])
  await log(pool, rid, admin, user, String(m.message_id), 'support_message', 'user_to_support', '用户消息已转交机器人管理员私聊', analysis.preview)
  await tg(fetcher, c.bot_token!, 'sendMessage', { chat_id: chat, text: '消息已转交客服。发送 /endsupport 可结束会话。' })
  return true
}
async function end(pool: Database, fetcher: typeof fetch, rid: number, m: Message, token: string) {
  const user = String(m.from!.id), chat = String(m.chat.id), current = await currentSession(pool, rid, user)
  if (current && ['pending','processing','verified'].includes(current.status)) {
    await pool.query("UPDATE t_telegram_verification SET status='cancelled',update_time=now() WHERE rid=$1", [current.rid])
    if (current.status === 'pending' && current.verification_message_id) void tg(fetcher, token, 'deleteMessage', { chat_id: chat, message_id: current.verification_message_id })
  }
  await tg(fetcher, token, 'sendMessage', { chat_id: chat, text: '客服会话已结束，机器人其他功能已恢复。' })
  await log(pool, rid, chat, user, String(m.message_id), 'support_session', 'closed', '用户主动结束客服会话', '')
}
const pluginUpdateLeases=new Map<number,{pluginId:ManagedModuleId;owner:string}>()
async function releasePluginUpdateLease(pool:Database,rid:number){const lease=pluginUpdateLeases.get(rid);if(!lease)return;pluginUpdateLeases.delete(rid);await releaseManagedPluginUpdate(pool,lease.pluginId,rid,lease.owner).catch(()=>undefined)}
async function processed(pool: Database, rid: number, owner: string) {
  await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [rid, owner])
  await releasePluginUpdateLease(pool,rid)
}
async function defer(pool: Database, rid: number, owner: string) {
  await pool.query("UPDATE t_platform_telegram_update SET status='pending',next_attempt_at=now()+interval '1 minute',lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [rid, owner])
  await releasePluginUpdateLease(pool,rid)
}
async function failed(pool: Database, rid: number, owner: string) {
  await pool.query("UPDATE t_platform_telegram_update SET status='failed',next_attempt_at=now()+LEAST(interval '5 minutes',interval '2 seconds'*power(2,LEAST(attempts,7))),lease_owner=NULL,lease_until=NULL,last_error_code='support_update_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2", [rid, owner])
  await releasePluginUpdateLease(pool,rid)
}
export async function syncTelegramSupportUpdates(options: { pool?: Database; fetcher?: typeof fetch; enabled?: boolean; shouldContinue?: () => boolean; logger?: Pick<Console,'error'>; batchSize?: number; lifecycleEnabled?: boolean } = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true') || process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return { skipped: true, processed: 0, failed: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, keepGoing = options.shouldContinue ?? (() => true), logger = options.logger ?? console, owner = 'support-sync-' + process.pid
  const lifecycleEnabled=options.lifecycleEnabled ?? pool===db
  let count = 0, errors = 0
  try {
    const updates = await claim(pool, owner, Math.min(100, Math.max(1, options.batchSize ?? 20)))
    for (const item of updates) {
      if (!keepGoing()) break
      try {
        const disabledSecretMessage = item.update_body.message ?? item.update_body.edited_message
        const disabledSecretCallback = item.update_body.callback_query
        const disabledSecretText = disabledSecretCallback?.data ?? (disabledSecretMessage?.chat?.type === 'private' ? textOf(disabledSecretMessage) : null)
        if (isDisabledSensitiveTelegramCommand(disabledSecretText)) {
          const token = await botTokenFor(pool, item.bot_rid)
          const source = disabledSecretCallback?.message ?? disabledSecretMessage
          if (source?.chat?.id != null) {
            const payload: Record<string, unknown> = { chat_id: String(source.chat.id), text: DISABLED_SECRET_COMMAND_REPLY }
            if (source.message_id != null) payload.reply_to_message_id = source.message_id
            const sent = await tg(fetcher, token, 'sendMessage', payload)
            if (!sent.ok) throw new Error('telegram_disabled_secret_reply_failed')
          }
          if (disabledSecretCallback?.id) await tg(fetcher, token, 'answerCallbackQuery', { callback_query_id: String(disabledSecretCallback.id), text: DISABLED_SECRET_COMMAND_REPLY, show_alert: true })
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const cloneProxy = await handleCloneProxyTokenUpdate({
          pool: pool as unknown as Pick<Pool, 'query' | 'connect'>,
          masterBotRid: item.bot_rid,
          update: { ...item.update_body, update_id: Number(item.update_body.update_id) },
          fetcher,
          shouldContinue: keepGoing,
          inboxClaim: { rid: item.rid, owner },
        })
        if (cloneProxy.handled) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (cloneProxy.reason === 'worker_stopping') {
          await defer(pool, item.rid, owner)
          break
        }
        if (cloneProxy.reason !== 'not_a_private_user_message' && cloneProxy.reason !== 'no_paid_opening_order') throw new Error('cloneproxy_token_dispatch_failed')
        if (await handleTelegramCloneProxyUpdate({
          pool: pool as unknown as Pick<Pool, 'query' | 'connect'>,
          fetcher,
          botRid: item.bot_rid,
          update: { ...item.update_body, update_id: Number(item.update_body.update_id) },
          shouldContinue: keepGoing,
        })) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }

        const statsMessage = item.update_body.message
        const statisticsText = statsMessage ? await telegramTradeStatisticsMessage(pool, textOf(statsMessage)) : null
        if (statisticsText !== null && statsMessage) {
          const token = await botTokenFor(pool, item.bot_rid)
          const sent = await tg(fetcher, token, 'sendMessage', {
            chat_id: String(statsMessage.chat.id),
            text: statisticsText,
            reply_to_message_id: statsMessage.message_id,
            parse_mode: 'HTML',
            allow_sending_without_reply: true,
          })
          if (!sent.ok) throw new Error('telegram_trade_statistics_reply_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const owningPlugin=lifecycleEnabled?await supportPluginForUpdate(pool,item.update_body,item.bot_rid):null
        if(owningPlugin){
          const lease=await claimManagedPluginUpdate(pool as Database & Pick<Pool,'connect'>,owningPlugin,item.rid,item.received_at??new Date(0))
          if(!lease.allowed){await rejectDisabledPluginUpdate(pool,fetcher,item,owner,owningPlugin);count++;continue}
          pluginUpdateLeases.set(item.rid,{pluginId:owningPlugin,owner:lease.owner})
        }
        const energyBalancePurchaseReply = String(item.update_body.message?.reply_to_message?.text ?? '').startsWith('请回复要购买能量的 TRON 地址（套餐：')
        if (energyBalancePurchaseCallback(item.update_body) || energyBalancePurchaseReply) {
          const handled = await handleEnergyBalancePurchaseCallback({ pool, fetcher, botRid: item.bot_rid, update: item })
          if (!handled) throw new Error('telegram_energy_balance_purchase_callback_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const bishuPackage = energyBishuPackageCallback(item.update_body)
        if (bishuPackage) {
          const handled = await handleTelegramKeywordReply({
            pool, fetcher, botRid: item.bot_rid, message: bishuPackage.message,
            callbackData: bishuPackage.data,
            callbackUsername: bishuPackage.callback.from?.username,
            callbackId: String(bishuPackage.callback.id ?? ''),
          })
          if (!handled) throw new Error('telegram_energy_bishu_package_callback_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const trusteeshipMenu = trusteeshipMenuCallback(item.update_body)
        if (trusteeshipMenu) {
          const handled = await handleTelegramKeywordReply({
            pool, fetcher, botRid: item.bot_rid, message: trusteeshipMenu.message,
            callbackData: trusteeshipMenu.data,
            callbackUsername: trusteeshipMenu.callback.from?.username,
            callbackId: String(trusteeshipMenu.callback.id ?? ''),
          })
          if (!handled) throw new Error('telegram_trusteeship_menu_callback_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const okxFilter = privateOkxC2cFilterCallback(item.update_body)
        if (okxFilter) {
          const handled = await handleTelegramKeywordReply({
            pool, fetcher, botRid: item.bot_rid, message: okxFilter.message,
            callbackData: okxFilter.data,
            callbackUsername: okxFilter.callback.from?.username,
            callbackId: String(okxFilter.callback.id ?? ''),
          })
          if (!handled) throw new Error('telegram_okx_c2c_callback_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (bindASendNCallback(item.update_body)) {
          await handleBindASendNCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const monitorAction = monitorWalletCallback(item.update_body)
        if (monitorAction) {
          if (monitorAction.action === 'purchase') await handleMonitorWalletPackageCallback(pool, fetcher, item.bot_rid, item.update_body, item.rid)
          else await handleMonitorWalletCallback(pool, fetcher, item.bot_rid, item.update_body, item.rid)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateWalletBindCallback(item.update_body)) {
          await handlePrivateWalletBindCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateTronHistoryCallback(item.update_body)) {
          await handlePrivateTronHistory(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateTronApprovalCallback(item.update_body)) {
          await handlePrivateTronApprovalCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipMyAddressCallback(item.update_body)) {
          await handleTrusteeshipMyAddressCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipAddAddressCallback(item.update_body)) {
          await handleTrusteeshipAddAddressCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipDeleteAddressCallback(item.update_body)) {
          await handleTrusteeshipDeleteAddressCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipEnergySettingsCallback(item.update_body)) {
          await handleTrusteeshipEnergySettingsCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipCancelRechargeCallback(item.update_body)) {
          await handleTrusteeshipCancelRechargeCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (await handlePremiumTelegramCallback(pool, fetcher, item.bot_rid, item.update_body)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (legacyEnergyFeeInfoCallback(item.update_body)) {
          await handleLegacyEnergyFeeInfoCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (energyPlatformPackageCallback(item.update_body)) {
          await handleEnergyPlatformPackageCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateGoodsPurchaseCallback(item.update_body)) {
          await handlePrivateGoodsPurchaseCallback(pool, fetcher, item.bot_rid, item)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateGoodsSelectionCallback(item.update_body)) {
          await handlePrivateGoodsSelectionCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateGoodsPageCallback(item.update_body)) {
          await handlePrivateGoodsPageCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipRechargeCallback(item.update_body)) {
          await handleTrusteeshipRechargeCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (trusteeshipSwapTrxCallback(item.update_body)) {
          await handleTrusteeshipSwapTrxCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateEnergyBishuCallback(item.update_body)) {
          await handlePrivateEnergyBishuCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateEnergyBishuBindCallback(item.update_body)) {
          await handlePrivateEnergyBishuBindCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateEnergyBishuAddCallback(item.update_body)) {
          await handlePrivateEnergyBishuAddCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateEnergyBishuSearchCallback(item.update_body)) {
          await handlePrivateEnergyBishuSearchCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (privateEnergyBishuToggleCallback(item.update_body)) {
          await handlePrivateEnergyBishuToggleCallback(pool, fetcher, item.bot_rid, item.update_body)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const m = privateMessage(item.update_body)
        if (!m) throw new Error('bad_private_message')
        if (await handleTelegramPremiumUsernameReply(pool as unknown as Pick<Pool, 'query' | 'connect'>, fetcher, item.bot_rid, item.rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const bindResult = await handleTelegramEnergyBishuBind({
          pool, botRid: item.bot_rid, update: item.update_body,
          sendMessage: async (message, text) => {
            const token = await botTokenFor(pool, item.bot_rid)
            const sent = await tg(fetcher, token, 'sendMessage', {
              chat_id: String(message.chat?.id ?? ''), text, reply_to_message_id: message.message_id,
              parse_mode: 'HTML', allow_sending_without_reply: true,
            })
            return sent.ok === true
          },
        })
        if (bindResult.kind === 'replied') {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const exchangeRateResult = await handleTelegramExchangeRate({
          pool, botRid: item.bot_rid, update: item.update_body,
          sendMessage: async (message, text) => {
            const token = await botTokenFor(pool, item.bot_rid)
            const sent = await tg(fetcher, token, 'sendMessage', {
              chat_id: String(message.chat?.id ?? ''), text, reply_to_message_id: message.message_id,
              parse_mode: 'HTML', allow_sending_without_reply: true,
            })
            return sent.ok === true
          },
        })
        if (exchangeRateResult.kind === 'replied') {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (String(m.text ?? '').trim().startsWith('激活地址')) {
          const activationResult = await handleTelegramAdminActivation({
            pool, fetcher, botRid: item.bot_rid, updateRid: item.rid, message: m,
            sendMessage: async (message, text) => {
              const token = await botTokenFor(pool, item.bot_rid)
              const sent = await tg(fetcher, token, 'sendMessage', {
                chat_id: String(message.chat?.id ?? ''), text, reply_to_message_id: message.message_id,
                parse_mode: 'HTML', allow_sending_without_reply: true,
              })
              return sent.ok === true
            },
          })
          if (activationResult === 'replied') {
            await processed(pool, item.rid, owner)
            count++
            continue
          }
        }
        if (await handlePrivateEnergyBishuDirectPurchase(pool, fetcher, item.bot_rid, item.rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handleMonitorWalletAddReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handleMonitorWalletDeleteReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id) {
          const commentState = await handleMonitorWalletCommentReply(pool, fetcher, item.bot_rid, m)
          if (commentState) {
            await processedMonitorWalletComment(pool, item.rid, owner, commentState)
            count++
            continue
          }
        }
        if (m.reply_to_message?.message_id && await handleTrusteeshipDeleteAddressReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handleTrusteeshipSwapTrxReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handleTrusteeshipAddAddressReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handlePrivateEnergyBishuAddAddressReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handlePrivateEnergyBishuAddCountReply(pool, fetcher, item.bot_rid, item.rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handlePrivateEnergyBishuReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handlePrivateEnergyBishuBindReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handlePrivateWalletAddressReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (m.reply_to_message?.message_id && await handleBindASendNAddressReply(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (sharedRequest(m)) {
          await handleSharedRequest(pool, fetcher, item.bot_rid, m)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const approvalAddress = /^查授权\s*(T[1-9A-HJ-NP-Za-km-z]{33})$/u.exec(textOf(m))?.[1]
        if (approvalAddress) {
          await sendPrivateTronApprovals(pool, fetcher, item.bot_rid, String(m.chat.id), approvalAddress, String(m.message_id))
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const verificationToken = verificationStartToken(m)
        if (verificationToken) {
          await handleVerificationMiniAppStart(pool, fetcher, item.bot_rid, m, verificationToken)
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (isPrivateStart(m)) {
          await handlePrivateStart(pool, fetcher, item.bot_rid, m)
          const startReplyHandled = await handleTelegramKeywordReply({ pool, fetcher, botRid: item.bot_rid, message: m })
          if (!startReplyHandled) {
            const token = await botTokenFor(pool, item.bot_rid)
            const sent = await tg(fetcher, token, 'sendMessage', {
              chat_id: String(m.chat.id),
              text: '✅ 初始化完成，请从 Telegram 命令菜单选择要使用的功能。',
              reply_to_message_id: m.message_id,
              allow_sending_without_reply: true,
            })
            if (!sent.ok) throw new Error('telegram_private_start_reply_failed')
          }
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (await handlePrivateTronAddress(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (await handlePrivateEvmAddress(pool, fetcher, item.bot_rid, m)) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const calculatorReply = telegramCalculatorReply(textOf(m))
        if (calculatorReply !== null) {
          const bot = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [item.bot_rid])
          const sent = await tg(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', {
            chat_id: String(m.chat.id),
            text: calculatorReply,
            reply_to_message_id: m.message_id,
            allow_sending_without_reply: true,
            parse_mode: 'HTML',
          })
          if (!sent.ok) throw new Error('telegram_calculator_delivery_failed')
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        if (await handleTelegramKeywordReply({ pool, fetcher, botRid: item.bot_rid, message: m })) {
          await processed(pool, item.rid, owner)
          count++
          continue
        }
        const c = await configFor(pool, item.bot_rid)
        if (!c?.support_enabled || !c.bot_token) { await processed(pool, item.rid, owner); count++; continue }
        const text = textOf(m)
        if (isEnd(text)) await end(pool, fetcher, item.bot_rid, m, c.bot_token)
        else if (isStart(text)) {
          const mention = /^\/support@([a-z0-9_]+)$/iu.exec(text)?.[1]
          const username = String(c.bot_username ?? '').replace(/^@/, '')
          if (mention && (!username || mention.toLowerCase() !== username.toLowerCase())) { await processed(pool, item.rid, owner); count++; continue }
          await start(pool, fetcher, item.bot_rid, m, c)
        } else {
          const handled = await handleAdminReply(pool, fetcher, item.bot_rid, m, c) || await handleUser(pool, fetcher, item.bot_rid, m, c)
          if (!handled) { await defer(pool, item.rid, owner); continue }
        }
        await processed(pool, item.rid, owner)
        count++
      } catch (error) {
        errors++
        await failed(pool, item.rid, owner).catch(() => undefined)
        logger.error('Telegram private support update failed', error)
      }
    }
    return { skipped: false, processed: count, failed: errors }
  } catch (error) {
    logger.error('Telegram private support update batch failed', error)
    return { skipped: false, processed: count, failed: errors, fatal: true }
  }
}
