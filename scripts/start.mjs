import { createProcessSupervisor } from './process-supervisor.mjs'

const allowedModes = new Set(['all', 'web', 'worker'])
const mode = process.env.PLATFORM_PROCESS_MODE || 'web'
if (!allowedModes.has(mode)) {
  console.error('PLATFORM_PROCESS_MODE must be all, web, or worker.')
  process.exit(78)
}

const supervisor = createProcessSupervisor()

try {
  const migrationScript = (process.env.DB_PROVIDER || 'postgres').toLowerCase() === 'mysql' ? 'scripts/migrate-mysql-production.mjs' : 'scripts/migrate-production.mjs'
  const migration = await supervisor.runChild({ label: 'database migration', args: [migrationScript] })
  if (supervisor.stopping || migration.code !== 0) {
    process.exitCode = migration.code || (supervisor.stopping ? 0 : 1)
  } else {
    const services = []
    if (mode === 'all' || mode === 'web') services.push(['web', ['.output/server/index.mjs'], process.env])
    if ((mode === 'all' || mode === 'web') && process.env.WEBHOOK_PROXY_PORT) services.push(['webhook-proxy', ['scripts/webhook-proxy.mjs'], { ...process.env, UPSTREAM_PORT: process.env.PORT || '8083' }])
    if (mode === 'all' || mode === 'worker') {
      services.push(['worker', ['.output/worker.mjs'], { ...process.env, PLATFORM_WORKER_ENABLED: '1' }])
    }
    if ((mode === 'all' || mode === 'worker') && process.env.PLATFORM_MONITOR_WALLET_ENABLED === 'true') {
      services.push(['monitor-wallet-worker', ['.output/monitor-wallet-worker.mjs'], { ...process.env, PLATFORM_MONITOR_WALLET_WORKER_ENABLED: '1' }])
    }

    const result = await supervisor.runGroup(services.map(([label, args, env]) => ({ label, args, env })))
    if (result.exitCode) process.exitCode = result.exitCode
  }
} finally {
  supervisor.dispose()
}

