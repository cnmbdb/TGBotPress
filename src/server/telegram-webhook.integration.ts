import assert from 'node:assert/strict'
import { test } from 'node:test'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import pg from 'pg'

const raw = process.env.TG_TELEGRAM_WEBHOOK_TEST_DB_URL
const url = raw ? new URL(raw) : null
if (!raw || !url || url.hostname !== 'postgres' ||
  !url.username.startsWith('tg_telegram_webhook_test_') ||
  !url.pathname.slice(1).startsWith('tg_telegram_webhook_test_')) {
  throw new Error('Telegram webhook integration requires a disposable tg_telegram_webhook_test_ database and role')
}
process.env.DB_HOST = url.hostname
process.env.DB_PORT = url.port || '5432'
process.env.DB_DATABASE = url.pathname.slice(1)
process.env.DB_USERNAME = url.username
process.env.DB_PASSWORD = decodeURIComponent(url.password)
process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
process.env.TELEGRAM_WEBHOOK_SECRET_KEY = 'telegram-webhook-test-secret-key-20261030'
process.env.APP_KEY = 'telegram-webhook-test-app-key-20261030'

const setup = new pg.Pool({ connectionString: raw, options: '-c timezone=Asia/Shanghai', max: 3 })
const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_fixture'
const premiumKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const premiumPrivateKey = premiumKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const premiumCookie = 'v2:' + publicEncrypt({ key: premiumKeyPair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from('fragment-session=webhook-fixture')).toString('base64url')
const oldRsaPrivateKey = process.env.TRON_RSA_PRIVATE_KEY
const oldRsaPrivateKeyPath = process.env.TRON_RSA_PRIVATE_KEY_PATH
process.env.TRON_RSA_PRIVATE_KEY = premiumPrivateKey
delete process.env.TRON_RSA_PRIVATE_KEY_PATH

try {
  const files = await import('node:fs/promises')
  const legacySchema = await files.readFile(new URL('../../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
  const emptySchema = await setup.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'")
  if (emptySchema.rows[0]?.count !== '0') throw new Error('Telegram webhook integration requires a fresh disposable database')
  await setup.query(legacySchema)
  const migrationsPath = new URL('../../migrations/', import.meta.url)
  const migrations = (await files.readdir(migrationsPath)).filter((file) => file.endsWith('.sql')).sort()
  for (const migration of migrations) await setup.query(await files.readFile(new URL(migration, migrationsPath), 'utf8'))
  await setup.query('INSERT INTO t_telegram_bot(rid,bot_token,bot_username) VALUES(1,$1,$2)', [token, 'fixturebot'])
  await setup.query("INSERT INTO t_telegram_bot_group(rid,bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,first_time,last_time,stop_time) VALUES(101,1,'supergroup',-100511,'old_fixture_group','Old Fixture Group',2,now()-interval '2 days',now()-interval '1 day',now()-interval '1 day')")
  await setup.query("INSERT INTO t_energy_platform_bot(rid,bot_rid,poll_group,status,receive_wallet,create_time) VALUES(1,1,'A',0,'TEnergyReceive',now())")
  await setup.query("INSERT INTO t_energy_platform_package(rid,bot_rid,package_name,energy_amount,energy_day,status,callback_data,show_notes,package_pic) VALUES(81,1,'Integration package',65000,1,0,'energy_0123456789abcdef0123456789abcdef','Integration notes','https://media.example.test/package.png')")
  await setup.query("INSERT INTO t_premium_platform(rid,bot_rid,platform_name,status,receive_wallet,platform_hash,platform_cookie,create_time) VALUES(2,1,1,0,'TPremiumReceive','fragment-test-hash',$1,now())", [premiumCookie])
  await setup.query("INSERT INTO t_premium_platform_package(rid,bot_rid,premium_platform_rid,package_name,package_month,usdt_price,callback_data,seq_sn,status,show_notes,create_time) VALUES(91,1,2,'Premium fixture',12,10.00,$1,1,0,'Safe notes',now())", ['premium_' + 'a'.repeat(32)])

  const { telegramWebhookApi } = await import('./telegram-webhook.server')
  const { webhookSecret } = await import('./bot-service.server')
  const secret = webhookSecret(1, token, process.env.TELEGRAM_WEBHOOK_SECRET_KEY!, process.env.APP_KEY!)
  const update = { update_id: 70301, message: { message_id: 1, chat: { id: 501, type: 'private' }, from: { id: 501, first_name: 'Test' }, text: '/start' } }
  const request = (body: unknown, receivedSecret = secret) => new Request('https://webhook.test/api/telegram/getdata?rid=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': receivedSecret },
    body: JSON.stringify(body),
  })

  await test('Telegram webhook validates secret and durably deduplicates real PostgreSQL updates', async () => {
    const first = await telegramWebhookApi(request(update))
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), { ok: true, duplicate: false })

    const duplicate = await telegramWebhookApi(request(update))
    assert.equal(duplicate.status, 200)
    assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true })

    const conflict = await telegramWebhookApi(request({ ...update, message: { ...update.message, text: '/different' } }))
    assert.equal(conflict.status, 409)

    assert.equal((await telegramWebhookApi(request(update, 'invalid-secret'))).status, 403)
    const unsupported = { update_id: 70302, poll_answer: { poll_id: 'fixture', user: { id: 501 }, option_ids: [0] } }
    const ignored = await telegramWebhookApi(request(unsupported))
    assert.equal(ignored.status, 200)
    assert.deepEqual(await ignored.json(), { ok: true, duplicate: false, ignored: true })

    const edited = { update_id: 70303, edited_message: { message_id: 2, chat: { id: 501, type: 'private' }, from: { id: 501, first_name: 'Test' }, text: '/start' } }
    const editedAccepted = await telegramWebhookApi(request(edited))
    assert.equal(editedAccepted.status, 200)
    assert.deepEqual(await editedAccepted.json(), { ok: true, duplicate: false })

    const callbackUpdate = { update_id: 70304, callback_query: { id: 'fixture-callback', data: 'userbindaddress', from: { id: 501 }, message: { message_id: 3, chat: { id: 501, type: 'private' } } } }
    const callbackAccepted = await telegramWebhookApi(request(callbackUpdate))
    assert.equal(callbackAccepted.status, 200)
    assert.deepEqual(await callbackAccepted.json(), { ok: true, duplicate: false })
    const energyFeeInfoUpdate = { update_id: 70316, callback_query: { id: 'fixture-energy-fee-info', data: '重新选择套餐energy', from: { id: 501 }, message: { message_id: 16, chat: { id: 501, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '查看能量说明', callback_data: '重新选择套餐energy' }]] } } } }
    assert.deepEqual(await telegramWebhookApi(request(energyFeeInfoUpdate)).then(response => response.json()), { ok: true, duplicate: false })
    const energyPlatformPackageUpdate = { update_id: 70323, callback_query: { id: 'fixture-energy-platform-package', data: 'energy_0123456789abcdef0123456789abcdef', from: { id: 501, username: 'fixture_user' }, message: { message_id: 23, chat: { id: 501, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Integration package', callback_data: 'energy_0123456789abcdef0123456789abcdef' }]] } } } }
    assert.deepEqual(await telegramWebhookApi(request(energyPlatformPackageUpdate)).then(response => response.json()), { ok: true, duplicate: false })
    const premiumPackageUpdate = { update_id: 70324, callback_query: { id: 'fixture-premium-select', data: 'premium_' + 'a'.repeat(32), from: { id: 555, username: 'premium_buyer' }, message: { message_id: 24, chat: { id: 555, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Premium fixture', callback_data: 'premium_' + 'a'.repeat(32) }]] } } } }
    assert.deepEqual(await telegramWebhookApi(request(premiumPackageUpdate)).then(response => response.json()), { ok: true, duplicate: false })

    const memberUpdate = { update_id: 70305, my_chat_member: { from: { id: 1 }, chat: { id: -100501, type: 'supergroup', username: 'fixture_group', title: 'Fixture Group' }, new_chat_member: { status: 'administrator' } } }
    assert.equal((await telegramWebhookApi(request(memberUpdate)).then(response => response.status)), 200)
    const joinMemberUpdate = { update_id: 70306, chat_member: { chat: { id: -100502, type: 'supergroup' }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 502, first_name: 'Join Member' } } } }
    assert.equal((await telegramWebhookApi(request(joinMemberUpdate)).then(response => response.status)), 200)
    const joinRequestUpdate = { update_id: 70307, chat_join_request: { chat: { id: -100503, type: 'supergroup' }, from: { id: 503, first_name: 'Join Request' }, user_chat_id: 503, bio: 'fixture' } }
    assert.equal((await telegramWebhookApi(request(joinRequestUpdate)).then(response => response.status)), 200)
    const retryJoinRequest = { update_id: 70310, chat_join_request: { chat: { id: -100510, type: 'supergroup' }, from: { id: 510, first_name: 'Retry Join' }, user_chat_id: 510 } }
    assert.equal((await telegramWebhookApi(request(retryJoinRequest)).then(response => response.status)), 200)
    const ignoredChatMember = { update_id: 70322, chat_member: { chat: { id: -100506, type: 'supergroup' }, old_chat_member: { status: 'member' }, new_chat_member: { status: 'left', user: { id: 506, first_name: 'Left Member' } } } }
    assert.equal((await telegramWebhookApi(request(ignoredChatMember)).then(response => response.status)), 200)
    const groupMessage = { update_id: 70308, message: { message_id: 8, date: 1800000000, chat: { id: -100504, type: 'supergroup' }, from: { id: 504, first_name: 'Group User' }, text: 'fixture group message' } }
    assert.equal((await telegramWebhookApi(request(groupMessage)).then(response => response.status)), 200)
    const editedGroupMessage = { update_id: 70309, edited_message: { message_id: 9, date: 1800000001, chat: { id: -100505, type: 'group' }, from: { id: 505, first_name: 'Edited User' }, text: 'fixture edited group message' } }
    assert.equal((await telegramWebhookApi(request(editedGroupMessage)).then(response => response.status)), 200)
    const groupTitleChange = { update_id: 70311, message: { message_id: 11, date: 1800000002, chat: { id: -100511, type: 'supergroup', username: 'renamed_fixture_group' }, from: { id: 511, first_name: 'Group Admin' }, new_chat_title: 'Renamed Fixture Group' } }
    assert.equal((await telegramWebhookApi(request(groupTitleChange)).then(response => response.status)), 200)
    const sharedRequests = [
      { update_id: 70312, message: { message_id: 12, chat: { id: 501, type: 'private' }, from: { id: 501 }, user_shared: { request_id: 1, user_id: 101 } } },
      { update_id: 70313, message: { message_id: 13, chat: { id: 501, type: 'private' }, from: { id: 501 }, chat_shared: { request_id: 2, chat_id: -202 } } },
      { update_id: 70314, message: { message_id: 14, chat: { id: 501, type: 'private' }, from: { id: 501 }, user_shared: { request_id: 3, user_id: 303 } } },
      { update_id: 70315, message: { message_id: 15, chat: { id: 501, type: 'private' }, from: { id: 501 }, chat_shared: { request_id: 4, chat_id: -404 } } },
    ]
    for (const shared of sharedRequests) assert.equal((await telegramWebhookApi(request(shared)).then(response => response.status)), 200)
    const transitStatsUpdate = { update_id: 70317, message: { message_id: 17, chat: { id: 501, type: 'private' }, from: { id: 501 }, text: '统计' } }
    const energyStatsUpdate = { update_id: 70318, message: { message_id: 18, chat: { id: 501, type: 'private' }, from: { id: 501 }, text: '统计能量' } }
    const editedStatsUpdate = { update_id: 70319, edited_message: { message_id: 19, chat: { id: 501, type: 'private' }, from: { id: 501 }, text: '统计' } }
    for (const statsUpdate of [transitStatsUpdate, energyStatsUpdate, editedStatsUpdate]) assert.equal((await telegramWebhookApi(request(statsUpdate)).then(response => response.status)), 200)
    await setup.query(`INSERT INTO t_transit_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,get_time,sendback_amount) VALUES ('fixture-transit-1','TFrom1','TTransit1','usdt','4.500000','1800000017',9,now(),'1.250000'),('fixture-transit-2','TFrom2','TTransit2','usdt','2.000000','1800000018',0,now(),'0')`)
    await setup.query(`INSERT INTO t_energy_wallet_trade_list(tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,get_time) VALUES ('fixture-energy-trx','TFrom3','TEnergy1','trx','3.200000','1800000019',9,now()),('fixture-energy-usdt','TFrom4','TEnergy2','usdt','1.100000','1800000020',0,now())`)

    const rows = await setup.query('SELECT bot_rid,update_id::text,status,attempts FROM t_platform_telegram_update ORDER BY update_id')
    assert.deepEqual(rows.rows, [
      { bot_rid: 1, update_id: '70301', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70302', status: 'ignored', attempts: 0 },
      { bot_rid: 1, update_id: '70303', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70304', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70305', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70306', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70307', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70308', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70309', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70310', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70311', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70312', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70313', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70314', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70315', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70316', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70317', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70318', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70319', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70322', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70323', status: 'pending', attempts: 0 },
      { bot_rid: 1, update_id: '70324', status: 'pending', attempts: 0 },
    ])

    const { telegramSupportUpdateClaimable, syncTelegramSupportUpdates } = await import('./telegram-support-updates.server')
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, update), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, edited), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, callbackUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, energyFeeInfoUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, energyPlatformPackageUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, premiumPackageUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, transitStatsUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, energyStatsUpdate), true)
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, { edited_message: editedStatsUpdate.edited_message }), false)
    for (const shared of sharedRequests) assert.equal(await telegramSupportUpdateClaimable(setup, 1, shared), true)
    const sharedReplies: Array<Record<string, unknown>> = []
    const statsReplies: Array<Record<string, unknown>> = []
    const callbackAlerts: Array<Record<string, unknown>> = []
    const packageReplies: Array<Record<string, unknown>> = []
    const fragmentRequests: string[] = []
    const supportFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://fragment.com/api')) {
        fragmentRequests.push(String(init?.body ?? ''))
        return Response.json({ ok: true, found: { name: 'Fixture Premium User', recipient: 'premium-recipient-fixture' } })
      }
      if (url.endsWith('/sendMessage')) sharedReplies.push(JSON.parse(String(init?.body)))
      if (url.endsWith('/sendMessage')) statsReplies.push(JSON.parse(String(init?.body)))
      if (url.endsWith('/answerCallbackQuery')) callbackAlerts.push(JSON.parse(String(init?.body)))
      if (url.endsWith('/sendPhoto')) packageReplies.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, result: { message_id: 9001 } })
    }
    const dispatched = await syncTelegramSupportUpdates({
      pool: setup,
      enabled: true,
      fetcher: supportFetcher,
      logger: { error: (...args) => { throw new Error(String(args[0])) } },
      batchSize: 20,
    })
    assert.deepEqual(dispatched, { skipped: false, processed: 12, failed: 0 })
    const swapStatsReply = statsReplies.find(reply => String(reply.text ?? '').startsWith('💹闪兑统计'))
    const energyStatsReply = statsReplies.find(reply => String(reply.text ?? '').startsWith('🔋能量统计'))
    assert.ok(swapStatsReply)
    assert.match(String(swapStatsReply.text), /TTransit1/u)
    assert.match(String(swapStatsReply.text), /所有钱包总数据/u)
    assert.ok(energyStatsReply)
    assert.match(String(energyStatsReply.text), /TEnergy1/u)
    assert.match(String(energyStatsReply.text), /TEnergy2/u)
    assert.equal(packageReplies.length, 1)
    const packageReply = packageReplies[0]
    assert.equal(packageReply.chat_id, '501')
    assert.equal(packageReply.photo, 'https://media.example.test/package.png')
    assert.equal(packageReply.parse_mode, 'HTML')
    assert.match(String(packageReply.caption), /Integration package/u)
    assert.match(String(packageReply.caption), /Integration notes/u)
    assert.match(String(packageReply.caption), /TEnergyReceive/u)
    assert.deepEqual(packageReply.reply_markup, { inline_keyboard: [
      [{ text: 'TRX 余额购买', callback_data: 'balancebuytrx81' }, { text: 'USDT 余额购买', callback_data: 'balancebuyusd81' }],
      [{ text: '🔄重新选择套餐', callback_data: '/buyenergy' }],
    ] })
    const energyPackageReadback = await setup.query<{ status: string; attempts: number }>("SELECT status,attempts FROM t_platform_telegram_update WHERE update_id=70323")
    assert.deepEqual(energyPackageReadback.rows, [{ status: 'processed', attempts: 1 }])
    assert.deepEqual(callbackAlerts.filter(alert => alert.callback_query_id === 'fixture-energy-fee-info'), [{
      callback_query_id: 'fixture-energy-fee-info',
      text: '波场手续费（⚠️务必仔细阅读⚠️）\n🔴对方有U，消耗约3.2万，燃烧13.44TRX\n🔴对方无U，消耗约6.5万，燃烧27.30TRX\n➖➖➖转账还需少量带宽➖➖➖\n🟢通过租赁能量，节省一大笔TRX\n🟢可选择租赁次数，租赁时长，能量24小时会恢复',
      show_alert: true,
    }])
    const energyInfoReadback = await setup.query<{ status: string; attempts: number }>("SELECT status,attempts FROM t_platform_telegram_update WHERE update_id=70316")
    assert.deepEqual(energyInfoReadback.rows, [{ status: 'processed', attempts: 1 }])
    assert.deepEqual(callbackAlerts.find(alert => alert.callback_query_id === 'fixture-premium-select'), { callback_query_id: 'fixture-premium-select' })
    const premiumPrompt = statsReplies.find(reply => String(reply.text ?? '').startsWith('<b>您好！请直接发送需要开通/续费会员的 Telegram 用户名'))
    assert.ok(premiumPrompt)
    assert.equal(premiumPrompt.chat_id, '555')
    assert.deepEqual(premiumPrompt.reply_markup, { inline_keyboard: [
      [{ text: '点击 ↓ 重新选择套餐(点我查看说明)', callback_data: '重新选择套餐premium' }],
      [{ text: 'Premium fixture', callback_data: 'premium_' + 'a'.repeat(32) }],
    ] })
    const promptState = await setup.query("SELECT state,prompt_message_id::text,context->>'packageRid' AS package_rid FROM t_platform_telegram_conversation_state WHERE bot_rid=1 AND chat_id=555 AND user_id=555")
    assert.deepEqual(promptState.rows, [{ state: 'premium_purchase_username', prompt_message_id: '9001', package_rid: '91' }])
    const premiumUsernameUpdate = { update_id: 70325, message: { message_id: 25, chat: { id: 555, type: 'private' }, from: { id: 555, username: 'premium_buyer' }, text: '@target_user' } }
    assert.deepEqual(await telegramWebhookApi(request(premiumUsernameUpdate)).then(response => response.json()), { ok: true, duplicate: false })
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, premiumUsernameUpdate), true)
    const premiumDispatched = await syncTelegramSupportUpdates({
      pool: setup,
      enabled: true,
      fetcher: supportFetcher,
      logger: { error: (...args) => { throw new Error(String(args[0])) } },
      batchSize: 20,
    })
    assert.deepEqual(premiumDispatched, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(fragmentRequests, ['query=%40target_user&months=12&method=searchPremiumGiftRecipient'])
    const premiumOrder = await setup.query<{ rid: number; source_type: number; status: number; premium_tg_username: string; recipient: string; need_pay_usdt: string; premium_platform_rid: number; premium_platform_package_rid: number }>("SELECT rid,source_type,status,premium_tg_username,recipient,need_pay_usdt::text,premium_platform_rid,premium_platform_package_rid FROM t_premium_platform_order WHERE bot_rid=1 AND buy_tg_uid='555'")
    assert.equal(premiumOrder.rowCount, 1)
    const premiumOrderRow = premiumOrder.rows[0]
    assert.ok(premiumOrderRow)
    assert.equal(premiumOrderRow.source_type, 2)
    assert.equal(premiumOrderRow.status, 0)
    assert.equal(premiumOrderRow.premium_tg_username, '@target_user')
    assert.equal(premiumOrderRow.recipient, 'premium-recipient-fixture')
    assert.equal(premiumOrderRow.premium_platform_rid, 2)
    assert.equal(premiumOrderRow.premium_platform_package_rid, 91)
    assert.match(premiumOrderRow.need_pay_usdt, /^10\.(?:01\d{2}|0200)$/u)
    const premiumPurchase = await setup.query("SELECT premium_tg_username,premium_name,order_rid,need_pay_usdt::text,notification_sent_at IS NOT NULL AS notified FROM t_platform_telegram_premium_purchase WHERE update_rid=(SELECT rid FROM t_platform_telegram_update WHERE update_id=70325)")
    assert.deepEqual(premiumPurchase.rows, [{ premium_tg_username: '@target_user', premium_name: 'Fixture Premium User', order_rid: String(premiumOrderRow.rid), need_pay_usdt: premiumOrderRow.need_pay_usdt, notified: true }])
    const premiumReceipt = statsReplies.find(reply => String(reply.text ?? '').startsWith('<b>下单成功，请核对金额和地址支付</b>'))
    assert.ok(premiumReceipt)
    assert.equal(premiumReceipt.reply_to_message_id, 25)
    assert.match(String(premiumReceipt.text), /TPremiumReceive/u)
    assert.equal(String(premiumReceipt.text).includes(premiumOrderRow.need_pay_usdt), true)
    const premiumUpdateReadback = await setup.query("SELECT update_id::text,status,attempts FROM t_platform_telegram_update WHERE update_id IN (70324,70325) ORDER BY update_id")
    assert.deepEqual(premiumUpdateReadback.rows, [
      { update_id: '70324', status: 'processed', attempts: 1 },
      { update_id: '70325', status: 'processed', attempts: 1 },
    ])
    const disabledSecretValue = '查私钥 0xVERY_SECRET_INPUT'
    const disabledSecretCallback = {
      update_id: 70326,
      callback_query: {
        id: 'fixture-disabled-secret-callback',
        data: disabledSecretValue,
        from: { id: 501 },
        message: {
          message_id: 26,
          chat: { id: 501, type: 'private' },
          reply_markup: { inline_keyboard: [[{ text: '查看私钥', callback_data: disabledSecretValue }]] },
        },
      },
    }
    assert.deepEqual(await telegramWebhookApi(request(disabledSecretCallback)).then(response => response.json()), { ok: true, duplicate: false })
    assert.equal(await telegramSupportUpdateClaimable(setup, 1, disabledSecretCallback), true)
    const disabledSecretDispatched = await syncTelegramSupportUpdates({
      pool: setup,
      enabled: true,
      fetcher: supportFetcher,
      logger: { error: (...args) => { throw new Error(String(args[0])) } },
      batchSize: 1,
    })
    assert.deepEqual(disabledSecretDispatched, { skipped: false, processed: 1, failed: 0 })
    const disabledSecretReply = statsReplies.find(reply =>
      reply.chat_id === '501' && reply.reply_to_message_id === 26 &&
      reply.text === '该功能已停用，请勿通过机器人发送私钥或助记词。')
    assert.ok(disabledSecretReply)
    const disabledSecretAlert = callbackAlerts.find(alert => alert.callback_query_id === 'fixture-disabled-secret-callback')
    assert.deepEqual(disabledSecretAlert, {
      callback_query_id: 'fixture-disabled-secret-callback',
      text: '该功能已停用，请勿通过机器人发送私钥或助记词。',
      show_alert: true,
    })
    assert.equal(JSON.stringify([disabledSecretReply, disabledSecretAlert]).includes('VERY_SECRET_INPUT'), false)
    const disabledSecretReadback = await setup.query<{ status: string; attempts: number }>("SELECT status,attempts FROM t_platform_telegram_update WHERE update_id=70326")
    assert.deepEqual(disabledSecretReadback.rows, [{ status: 'processed', attempts: 1 }])

    const sharedIdReplies = sharedReplies.filter(reply =>
      ['用户ID：', '群组ID：', '机器人ID：', '频道ID：'].some(label => String(reply.text ?? '').startsWith(label)))
    assert.deepEqual(sharedIdReplies.map(reply => [reply.chat_id, reply.text]), [
      ['501', '用户ID：<code>101</code>'],
      ['501', '群组ID：<code>-202</code>'],
      ['501', '机器人ID：<code>303</code>'],
      ['501', '频道ID：<code>-404</code>'],
    ])

    const { syncTelegramMemberUpdates } = await import('./telegram-member-updates.server')
    const memberResult = await syncTelegramMemberUpdates({ pool: setup, enabled: true, logger: { error: (...args) => { throw new Error(String(args[0])) } } })
    assert.deepEqual(memberResult, { skipped: false, processed: 1 })

    const { syncTelegramJoinUpdates } = await import('./telegram-join-updates.server')
    const telegramCalls: string[] = []
    const joinErrors: string[] = []
    const joinResult = await syncTelegramJoinUpdates({
      pool: setup,
      enabled: true,
      fetcher: async (input, init) => {
        telegramCalls.push(String(input).split('/').pop() || '')
        const payload = JSON.parse(String(init?.body || '{}')) as { user_id?: string }
        return Response.json({ ok: payload.user_id !== '510', result: true })
      },
      logger: { error: (...args) => { joinErrors.push(String(args[0])) } },
      batchSize: 10,
    })
    assert.deepEqual(joinResult, { skipped: false, processed: 3, failed: 1 })
    assert.deepEqual(telegramCalls, ['approveChatJoinRequest', 'approveChatJoinRequest'])
    assert.deepEqual(joinErrors, ['Telegram join update failed'])
    const failedJoin = await setup.query("SELECT status,attempts,last_error_code,next_attempt_at>now() AS delayed FROM t_platform_telegram_update WHERE update_id=70310")
    assert.deepEqual(failedJoin.rows, [{ status: 'failed', attempts: 1, last_error_code: 'telegram_join_action_failed', delayed: true }])
    await setup.query("UPDATE t_platform_telegram_update SET next_attempt_at=now()-interval '1 minute' WHERE update_id=70310")
    const retryResult = await syncTelegramJoinUpdates({
      pool: setup,
      enabled: true,
      fetcher: async input => {
        telegramCalls.push(String(input).split('/').pop() || '')
        return Response.json({ ok: true, result: true })
      },
      logger: { error: (...args) => { throw new Error(String(args[0])) } },
      batchSize: 10,
    })
    assert.deepEqual(retryResult, { skipped: false, processed: 1, failed: 0 })
    assert.deepEqual(telegramCalls, ['approveChatJoinRequest', 'approveChatJoinRequest', 'approveChatJoinRequest'])

    const oldActions = process.env.PLATFORM_TELEGRAM_ACTIONS
    process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
    try {
      const { syncTelegramGroupMessages } = await import('./moderation-group-updates.server')
      const groupResult = await syncTelegramGroupMessages({
        pool: setup,
        enabled: true,
        fetcher: async () => { throw new Error('Telegram actions must stay disabled in this persistence test') },
        logger: { error: (...args) => { throw new Error(String(args[0])) } },
        batchSize: 10,
      })
      assert.deepEqual(groupResult, { skipped: false, processed: 3, failed: 0 })
      const renamed = await setup.query("SELECT status,tg_groupusername,tg_groupnickname,stop_time IS NULL AS active FROM t_telegram_bot_group WHERE bot_rid=1 AND tg_groupid=-100511")
      assert.deepEqual(renamed.rows, [{ status: 1, tg_groupusername: 'renamed_fixture_group', tg_groupnickname: 'Renamed Fixture Group', active: true }])
    } finally {
      if (oldActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS
      else process.env.PLATFORM_TELEGRAM_ACTIONS = oldActions
    }

    const tronAddress = 'TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS'
    for (const update of [
      { update_id: 70320, message: { message_id: 20, date: 1800000020, chat: { id: -100504, type: 'supergroup' }, from: { id: 504 }, text: '查授权 ' + tronAddress } },
      { update_id: 70321, message: { message_id: 21, date: 1800000021, chat: { id: -100504, type: 'supergroup' }, from: { id: 504 }, text: tronAddress } },
    ]) assert.deepEqual(await telegramWebhookApi(request(update)).then(response => response.json()), { ok: true, duplicate: false })
    const oldGroupActions = process.env.PLATFORM_TELEGRAM_ACTIONS
    process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
    const groupReplies: Array<{ payload: Record<string, any> }> = []
    const providerRequests: string[] = []
    try {
      const { syncTelegramGroupMessages } = await import('./moderation-group-updates.server')
      const result = await syncTelegramGroupMessages({
        pool: setup, enabled: true, batchSize: 10,
        fetcher: async (input, init) => {
          const url = String(input)
          if (url.startsWith('https://api.telegram.org/')) {
            groupReplies.push({ payload: JSON.parse(String(init?.body || '{}')) })
            return Response.json({ ok: true, result: { message_id: 9100 + groupReplies.length } })
          }
          providerRequests.push(url)
          if (url.includes('/api/account/approve/list')) return Response.json({ total: 0, data: [] })
          if (url.includes('/api/accountv2')) return Response.json({
            activated: true, balance: 1230000, transactions: 2, transactions_in: 1, transactions_out: 1,
            totalTransactionCount: 2, totalFrozen: 0, totalFrozenV2: 0, acquiredDelegatedFrozenV2BalanceForEnergy: 0,
            bandwidth: { freeNetRemaining: 10, freeNetLimit: 100, netRemaining: 0, netLimit: 0, energyRemaining: 0, energyLimit: 0 },
            date_created: 1800000000000, latest_operation_time: 1800000001000,
            withPriceTokens: [{ tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', balance: '2500000', tokenDecimal: 6 }],
          })
          if (url.includes('/api/account/tokens')) return Response.json({ data: [] })
          throw new Error('unexpected mocked request: ' + url)
        },
        logger: { error: (...args) => { throw new Error(String(args[0])) } },
      })
      assert.deepEqual(result, { skipped: false, processed: 2, failed: 0 })
    } finally {
      if (oldGroupActions == null) delete process.env.PLATFORM_TELEGRAM_ACTIONS
      else process.env.PLATFORM_TELEGRAM_ACTIONS = oldGroupActions
    }
    assert.deepEqual(providerRequests.map(url => new URL(url).pathname), ['/api/account/approve/list', '/api/accountv2'])
    assert.equal(groupReplies.length, 2)
    assert.ok(String(groupReplies[0]?.payload.text).includes('恭喜，地址没有授权'))
    assert.equal(groupReplies[0]?.payload.chat_id, '-100504')
    assert.equal(groupReplies[0]?.payload.reply_to_message_id, 20)
    assert.equal(groupReplies[1]?.payload.chat_id, '-100504')
    assert.equal(groupReplies[1]?.payload.reply_to_message_id, 21)
    assert.match(String(groupReplies[1]?.payload.text), /USDT余额：<code>2.5<\/code>/u)
    assert.equal(groupReplies[1]?.payload.reply_markup.inline_keyboard[0][1].callback_data, '查授权' + tronAddress)

    const processed = await setup.query('SELECT update_id::text,status,attempts,processed_at IS NOT NULL AS has_processed_at FROM t_platform_telegram_update ORDER BY update_id')
    assert.deepEqual(processed.rows, [
      { update_id: '70301', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70302', status: 'ignored', attempts: 0, has_processed_at: false },
      { update_id: '70303', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70304', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70305', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70306', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70307', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70308', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70309', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70310', status: 'processed', attempts: 2, has_processed_at: true },
      { update_id: '70311', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70312', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70313', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70314', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70315', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70316', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70317', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70318', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70319', status: 'pending', attempts: 0, has_processed_at: false },
      { update_id: '70320', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70321', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70322', status: 'ignored', attempts: 1, has_processed_at: true },
      { update_id: '70323', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70324', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70325', status: 'processed', attempts: 1, has_processed_at: true },
      { update_id: '70326', status: 'processed', attempts: 1, has_processed_at: true },
    ])
    const state = await setup.query("SELECT state,prompt_message_id FROM t_platform_telegram_conversation_state WHERE bot_rid=1 AND chat_id=501 AND user_id=501")
    assert.deepEqual(state.rows, [{ state: 'wallet_address', prompt_message_id: '9001' }])
    const group = await setup.query("SELECT tg_groupid::text,tg_groupnickname,status,is_admin FROM t_telegram_bot_group WHERE bot_rid=1 AND tg_groupid=-100501")
    assert.deepEqual(group.rows, [{ tg_groupid: '-100501', tg_groupnickname: 'Fixture Group', status: 1, is_admin: 'Y' }])
    const histories = await setup.query("SELECT chat_id::text,message_id::text,message_text FROM t_telegram_group_message_history WHERE bot_rid=1 AND chat_id IN ('-100504','-100505') ORDER BY chat_id,message_id")
    assert.deepEqual(histories.rows, [
      { chat_id: '-100504', message_id: '20', message_text: '查授权 TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS' },
      { chat_id: '-100504', message_id: '21', message_text: 'TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS' },
      { chat_id: '-100504', message_id: '8', message_text: 'fixture group message' },
      { chat_id: '-100505', message_id: '9', message_text: 'fixture edited group message' },
    ])
    const user = await setup.query('SELECT tg_uid::text,tg_username,tg_nickname,status FROM t_telegram_bot_user WHERE bot_rid=1 AND tg_uid=501')
    assert.deepEqual(user.rows, [{ tg_uid: '501', tg_username: '', tg_nickname: 'Test', status: 1 }])
  })
} finally {
  const { db } = await import('./db.server')
  await db.end()
  await setup.end()
  if (oldRsaPrivateKey == null) delete process.env.TRON_RSA_PRIVATE_KEY
  else process.env.TRON_RSA_PRIVATE_KEY = oldRsaPrivateKey
  if (oldRsaPrivateKeyPath == null) delete process.env.TRON_RSA_PRIVATE_KEY_PATH
  else process.env.TRON_RSA_PRIVATE_KEY_PATH = oldRsaPrivateKeyPath
}
