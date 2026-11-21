import { db } from '../server/db.server'
import { runManagedPluginTask } from '../plugins/module-lifecycle.server'
import {
  deliverMonitorWalletNotifications,
  syncMonitorWalletCurrentBlock,
  syncMonitorWalletMissedBlock,
} from '../server/monitor-wallet-block.server'

const intervalMs = 2_000
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

if (process.env.PLATFORM_MONITOR_WALLET_WORKER_ENABLED !== '1') {
  console.error('Set PLATFORM_MONITOR_WALLET_WORKER_ENABLED=1 to start the monitor-wallet worker.')
  process.exitCode = 78
} else {
  let stopping = false
  process.once('SIGTERM', () => { stopping = true })
  process.once('SIGINT', () => { stopping = true })
  try {
    while (!stopping) {
      const started = Date.now()
      try {
        await runManagedPluginTask('monitor', 'monitorwalletworker', async () => {
          await syncMonitorWalletCurrentBlock({ enabled: true, shouldContinue: () => !stopping })
          if (!stopping) await syncMonitorWalletMissedBlock({ enabled: true, shouldContinue: () => !stopping })
          if (!stopping) await deliverMonitorWalletNotifications({ enabled: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true' })
        })
      } catch {
        if (!stopping) console.error('Monitor-wallet worker cycle failed; it will retry.')
      }
      if (!stopping) await wait(Math.max(0, intervalMs - (Date.now() - started)))
    }
  } finally {
    await db.end()
  }
}

