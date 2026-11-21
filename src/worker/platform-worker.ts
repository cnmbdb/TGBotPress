import { db } from '../server/db.server'
import { runPlatformWorker } from '../server/platform-worker.server'

if (process.env.PLATFORM_WORKER_ENABLED !== '1') {
  console.error('Set PLATFORM_WORKER_ENABLED=1 to start the platform worker.')
  process.exitCode = 78
} else {
  let stopping = false
  process.once('SIGTERM', () => { stopping = true })
  process.once('SIGINT', () => { stopping = true })
  try {
    await runPlatformWorker({ isStopping: () => stopping })
  } catch {
    console.error('Platform worker stopped after an unrecoverable scheduler error.')
    process.exitCode = 1
  } finally {
    await db.end()
  }
}
