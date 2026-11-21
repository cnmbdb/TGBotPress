import { createProcessSupervisor } from './process-supervisor.mjs'

const supervisor = createProcessSupervisor()

try {
  const services = [
    { label: 'web', args: ['./node_modules/vite/bin/vite.js', '--host', '0.0.0.0'] },
    { label: 'worker', args: ['./node_modules/tsx/dist/cli.mjs', 'watch', 'src/worker/platform-worker.ts'], env: { ...process.env, PLATFORM_WORKER_ENABLED: '1' } },
  ]

  if (process.env.PLATFORM_MONITOR_WALLET_ENABLED === 'true') {
    services.push({ label: 'monitor-wallet-worker', args: ['./node_modules/tsx/dist/cli.mjs', 'watch', 'src/worker/monitor-wallet-worker.ts'], env: { ...process.env, PLATFORM_MONITOR_WALLET_WORKER_ENABLED: '1' } })
  }

  const result = await supervisor.runGroup(services)
  if (result.exitCode) process.exitCode = result.exitCode
} finally {
  supervisor.dispose()
}
