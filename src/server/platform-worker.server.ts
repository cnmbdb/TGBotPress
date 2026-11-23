import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { expireUnpaidOrders } from './cancel-unpaid-orders.server'
import { refreshRealtimeTrxRates } from './transit-realtime-rate.server'
import { syncTransitWalletUsdtTrades } from './transit-wallet-usdt-poll.server'
import { premiumWalletApiKeys } from './premium-wallet-usdt-poll.server'
import { syncFmsWalletTrades } from './fms-wallet-trades-poll.server'
import { syncEnergyWalletTrades } from './energy-wallet-trades-poll.server'
import { syncEnergyCurrentBlock, syncEnergyMissedBlock } from './energy-block-monitor.server'
import { refreshAiTrusteeshipResources } from './ai-trusteeship-resource.server'
import { refreshAiEnergyWalletResources } from './ai-energy-wallet-resource.server'
import { registeredCloneProxy as cloneProxyPlugin } from '../plugins/registry.server'
import { pauseStaleBishuWallets } from './bishu-wallet-stop.server'
import { autoActivateBishu } from './auto-activate-bishu.server'
import { refreshEnergyPlatformBalances } from './energy-platform-balance.server'
import { recoverDueEnergy } from './recovery-energy-worker.server'
import { sendTimingTelegramAds } from './send-timing-telegram.server'
import { sendTransitTelegramNotifications } from './send-transit-telegram.server'
import { sendEnergyTelegramNotifications } from './send-energy-telegram.server'
import { syncEnergyOrder } from './energy-order-worker.server'
import { syncTrxEnergyTrades } from './trx-energy-trade-worker.server'
import { syncQuickEnergyOrders } from './quick-energy-order-worker.server'
import { syncAiEnergyOrders } from './ai-energy-order-worker.server'
import { syncAiBishuOrders } from './ai-bishu-order-worker.server'
import { syncTelegramMemberUpdates } from './telegram-member-updates.server'
import { registeredGroupManagement as groupManagementPlugin } from '../plugins/registry.server'
import { syncTelegramJoinUpdates } from './telegram-join-updates.server'
import { syncTelegramSupportUpdates } from './telegram-support-updates.server'
import { syncShanduiBonus } from './shandui-bonus.server'
import { syncEnergySpecial } from './energy-special.server'
import { syncRechargeOrders } from './recharge-order-worker.server'
import { syncCollectionWallets } from './collection-wallet-worker.server'
import { syncBindASendN } from './bindasendn-worker.server'
import { premiumTonRuntime } from './premium-fulfillment-worker.server'
import { createPremiumScheduledTasks } from '@tgbotpress/plugin-premium/tasks'
import { runScheduledTasks, type ScheduledTask, type SchedulerDatabase, type SchedulerLogger } from './scheduler.server'
import { pollNextTelegramBot } from './telegram-polling.server'
import { pluginCatalog } from '../plugins/catalog'
import { managedModuleIds, runManagedPluginTask, runPluginTaskWithLease } from '../plugins/module-lifecycle.server'
import { syncPluginConfigRefresh } from './plugin-config-refresh.server'
import { refreshTanstackImageCheck, runTanstackAutoUpdate } from './settings-version.server'

type WorkerDatabase = SchedulerDatabase & Pick<Pool, 'connect'>

export type PlatformWorkerOptions = {
  pool?: WorkerDatabase
  logger?: SchedulerLogger
  isStopping?: () => boolean
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  leaseSeconds?: number
  now?: () => number
}

export function platformScheduledTasks(pool: WorkerDatabase, logger: SchedulerLogger = console, now: () => number = Date.now): ScheduledTask[] {
  let telegramPollingAfterBotRid = 0
  const premiumTasks = Object.fromEntries(createPremiumScheduledTasks({
    pool,
    logger,
    getWalletApiKeys: () => premiumWalletApiKeys(pool),
    ...premiumTonRuntime,
    walletPollingEnabled: process.env.PLATFORM_PREMIUM_WALLET_POLLING === 'true',
    telegramActionsEnabled: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
    fulfillmentEnabled: process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS === 'true',
    allowTelegramStars: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
  }).map(task => [task.name, task])) as Record<'premiumwalletusdttrade' | 'sendpremiumtgmessage' | 'tgpremium', ScheduledTask>
  const tasks: ScheduledTask[] = [
    {
      name: 'cancelunpaidorder',
      intervalMs: 60_000,
      run: shouldContinue => expireUnpaidOrders(pool, undefined, shouldContinue),
    },
    {
      name: 'getoktrealtimerate',
      intervalMs: 5_000,
      run: shouldContinue => refreshRealtimeTrxRates(pool, fetch, { warn: message => logger.error(message) }, shouldContinue),
    },
    {
      name: 'transitwalletusdttrade',
      intervalMs: 2_000,
      run: shouldContinue => syncTransitWalletUsdtTrades({ pool, logger, shouldContinue }),
    },
    premiumTasks.premiumwalletusdttrade,
    {
      name: 'getgmswallettrxusdttrade',
      intervalMs: 5_000,
      run: shouldContinue => syncFmsWalletTrades({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_FMS_WALLET_POLLING === 'true' }),
    },
    {
      name: 'energywalletinlisttrxusdt',
      intervalMs: 2_000,
      run: shouldContinue => syncEnergyWalletTrades({ pool, logger, shouldContinue }),
    },
    {
      name: 'monitorenergywallettrade',
      intervalMs: 2_000,
      run: shouldContinue => syncEnergyCurrentBlock({ pool, logger, shouldContinue, allowPurchaseTrigger: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'monitorenergywallettradelost',
      intervalMs: 2_000,
      run: shouldContinue => syncEnergyMissedBlock({ pool, logger, shouldContinue, allowPurchaseTrigger: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'getaitrusteeshipwalletresource',
      intervalMs: 5_000,
      run: shouldContinue => refreshAiTrusteeshipResources({
        pool,
        logger,
        shouldContinue,
        enabled: process.env.PLATFORM_RESOURCE_MONITORING === 'true',
        apiKey: process.env.TRONSCAN_API_KEY,
        allowPurchaseTrigger: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true',
      }),
    },
    {
      name: 'getaienergywalletresource',
      intervalMs: 3_000,
      run: shouldContinue => refreshAiEnergyWalletResources({
        pool, logger, shouldContinue,
        enabled: process.env.PLATFORM_RESOURCE_MONITORING === 'true',
        tronscanApiKey: process.env.TRONSCAN_API_KEY,
        tronGridApiKey: process.env.TRONGRID_API_KEY,
        allowPurchaseTrigger: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true',
      }),
    },
    {
      name: 'bishuwalletstop',
      intervalMs: 60_000,
      run: shouldContinue => {
        const current = new Date(now())
        const shanghaiTime = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(current)
        const hour = Number(shanghaiTime.find(part => part.type === 'hour')?.value)
        const minute = Number(shanghaiTime.find(part => part.type === 'minute')?.value)
        if (hour !== 3 || minute !== 1) return Promise.resolve({ skipped: true })
        return pauseStaleBishuWallets(pool, undefined, logger, shouldContinue)
      },
    },
    {
      name: 'sendtimingtgmessage',
      intervalMs: 60_000,
      run: shouldContinue => sendTimingTelegramAds({ pool, logger, shouldContinue }),
    },
    {
      name: 'sendtransittgmessage',
      intervalMs: 2_000,
      run: shouldContinue => sendTransitTelegramNotifications({ pool, logger, shouldContinue }),
    },
    {
      name: 'energyOrder',
      intervalMs: 2_000,
      run: async shouldContinue => {
        const options = { pool, logger, shouldContinue, enabled: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }
        const bishu = await syncEnergyOrder(options)
        if (bishu.skipped || !shouldContinue()) return bishu
        const trx = await syncTrxEnergyTrades(options)
        return { skipped: false, scanned: bishu.scanned + trx.scanned, succeeded: bishu.succeeded + trx.succeeded, failed: bishu.failed + trx.failed, manual: trx.manual }
      },
    },
    {
      name: 'energyQuickOrder',
      intervalMs: 2_000,
      run: shouldContinue => syncQuickEnergyOrders({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'handleaienergyorder',
      intervalMs: 3_000,
      run: shouldContinue => syncAiEnergyOrders({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'handleaienergybishu',
      intervalMs: 3_000,
      run: shouldContinue => syncAiBishuOrders({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'sendenergytgmessage',
      intervalMs: 2_000,
      run: shouldContinue => sendEnergyTelegramNotifications({ pool, logger, shouldContinue }),
    },
    premiumTasks.sendpremiumtgmessage,
    {
      name: 'recoveryenergy',
      intervalMs: 60_000,
      run: shouldContinue => recoverDueEnergy({ pool, logger, shouldContinue }),
    },
    {
      name: 'getenergyplatformbalance',
      intervalMs: 5_000,
      run: shouldContinue => refreshEnergyPlatformBalances({ pool, logger, shouldContinue }),
    },
    {
      name: 'autoactivatebishu',
      intervalMs: 60_000,
      run: shouldContinue => autoActivateBishu({ pool, logger, shouldContinue }),
    },
    {
      name: 'shanduiBonus',
      intervalMs: 2_000,
      run: shouldContinue => syncShanduiBonus({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_TRANSIT_BONUS_ACTIONS === 'true' }),
    },
    {
      name: 'handleenergyspecial',
      intervalMs: 3_000,
      run: shouldContinue => syncEnergySpecial({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_SPECIAL_ENERGY_ACTIONS === 'true' }),
    },
    {
      name: 'handlerechargeorder',
      intervalMs: 4_000,
      run: shouldContinue => syncRechargeOrders({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_RECHARGE_ORDER_ACTIONS === 'true' }),
    },
    {
      name: 'handlecollectionwallet',
      intervalMs: 300_000,
      run: shouldContinue => syncCollectionWallets({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_COLLECTION_WALLET_ACTIONS === 'true' }),
    },
    {
      name: 'bindasendnusdt',
      intervalMs: 3_000,
      run: shouldContinue => syncBindASendN({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_BIND_ASENDN_ACTIONS === 'true' }),
    },
    premiumTasks.tgpremium,
    {
      name: 'telegramjoinupdates',
      intervalMs: 1_000,
      run: shouldContinue => syncTelegramJoinUpdates({ pool, logger, shouldContinue }),
    },
    {
      name: groupManagementPlugin.jobs.groupMessages.name,
      intervalMs: groupManagementPlugin.jobs.groupMessages.intervalMs,
      run: shouldContinue => groupManagementPlugin.jobs.groupMessages.run({ pool, logger, shouldContinue }),
    },
    {
      name: groupManagementPlugin.jobs.management.name,
      intervalMs: groupManagementPlugin.jobs.management.intervalMs,
      run: shouldContinue => groupManagementPlugin.jobs.management.run({ pool, logger, shouldContinue }),
    },
    {
      name: 'telegramsupportupdates',
      intervalMs: 1_000,
      run: shouldContinue => syncTelegramSupportUpdates({ pool, logger, shouldContinue }),
    },
    {
      name: 'telegrammemberupdates',
      intervalMs: 1_000,
      run: shouldContinue => syncTelegramMemberUpdates({ pool, logger, shouldContinue }),
    },
    {
      name: cloneProxyPlugin.jobs.revenue.name,
      intervalMs: cloneProxyPlugin.jobs.revenue.intervalMs,
      run: shouldContinue => runPluginTaskWithLease('cloneproxy',cloneProxyPlugin.jobs.revenue.name,['synctelegramcloneproxyrevenue'],()=>cloneProxyPlugin.jobs.revenue.run(pool,logger,shouldContinue),pool),
    },
    {
      name: 'tanstackimagecheck',
      intervalMs: 60_000,
      run: shouldContinue => shouldContinue() ? refreshTanstackImageCheck(pool) : Promise.resolve({ skipped: true }),
    },
    {
      name: 'tanstackautoupdate',
      intervalMs: 300_000,
      run: shouldContinue => shouldContinue() ? runTanstackAutoUpdate() : Promise.resolve({ skipped: true }),
    },
    {
      name: 'pluginconfigrefresh',
      intervalMs: 5_000,
      run: shouldContinue => syncPluginConfigRefresh({ pool, logger, shouldContinue, enabled: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true' }),
    },
    {
      name: 'telegrampolling',
      intervalMs: 500,
      run: async shouldContinue => {
        const result = await pollNextTelegramBot({ pool, afterBotRid: telegramPollingAfterBotRid, shouldContinue })
        telegramPollingAfterBotRid = result.nextAfterBotRid
        if (result.failed) logger.error('Telegram polling request failed for bot ' + result.botRid + ': ' + result.failed)
        return result
      },
    },
  ]
  return tasks
}

export function gateManagedPluginTasks(pool: WorkerDatabase, tasks: ScheduledTask[]): ScheduledTask[] {
  return tasks.map(task => {
    const plugin = pluginCatalog.find(item => managedModuleIds.includes(item.id as typeof managedModuleIds[number]) && (item.tasks as readonly string[]).includes(task.name))
    if (!plugin || !managedModuleIds.includes(plugin.id as typeof managedModuleIds[number])) return task
    return { ...task, run: (shouldContinue: () => boolean) => runManagedPluginTask(plugin.id as typeof managedModuleIds[number], task.name, draining => plugin.id === 'collection' && task.name === 'handlecollectionwallet' ? syncCollectionWallets({ pool, logger: console, shouldContinue, enabled: !draining && process.env.PLATFORM_COLLECTION_WALLET_ACTIONS === 'true' }) : task.run(shouldContinue), pool) }
  })
}

export async function runPlatformWorker(options: PlatformWorkerOptions = {}) {
  const pool = options.pool ?? db
  await runScheduledTasks({
    ...options,
    pool,
    tasks: gateManagedPluginTasks(pool, platformScheduledTasks(pool, options.logger, options.now)),
  })
}
