import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promoteStagedPlugin } from './plugin-deployment.server'
function pool(status = 'staged') {
  const updates: string[] = []
  let staged = { install_path: '/tmp/plugin', integrity_sha512: null as string | null }
  return {
    updates,
    async query(sql: string) { updates.push(sql); return { rows: [] } },
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          updates.push(sql)
          if (sql.includes('INSERT INTO t_platform_plugin_install_attempt') && params) staged = { install_path: String(params[5]), integrity_sha512: String(params[4]) }
          if (sql.includes('SELECT install_path')) return { rows: [{ ...staged, status }] }
          return { rows: [], rowCount: sql.includes("status='installed'") ? 1 : 0 }
        },
        release() {},
      }
    },
  } as any
}
test('promotes a staged plugin only after health check', async () => {
  const p = pool()
  const result = await promoteStagedPlugin(p, 'groups', '1.2.3', async () => true)
  assert.equal(result.status, 'installed')
  assert.ok(p.updates.some((sql: string) => sql.includes("status='installed'")))
})
test('keeps staged state when health check fails', async () => {
  const p = pool()
  await assert.rejects(promoteStagedPlugin(p, 'groups', '1.2.3', async () => false), /plugin_health_check_failed/)
  assert.equal(p.updates.filter((sql: string) => sql.includes("status='installed'")).length, 0)
})

test('orchestrates staging, dependency installation, recording, and promotion', async () => {
  const { installAndPromotePlugin } = await import('./plugin-deployment.server')
  const { createHash } = await import('node:crypto')
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const bytes = new TextEncoder().encode('orchestrated plugin')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const p = pool()
  await installAndPromotePlugin({ pool: p, root: await mkdtemp(join(tmpdir(), 'tg-plugin-orchestrate-')), artifact: { pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages', integritySha512: integrity, bytes }, npmRunner: async () => undefined, registryToken: 'fixture-token', healthCheck: async () => true })
  assert.ok(p.updates.some((sql: string) => sql.includes('t_platform_plugin_install')))
})
