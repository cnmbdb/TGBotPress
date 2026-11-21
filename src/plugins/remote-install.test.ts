import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installRemotePlugin } from './remote-install.server'

test('remote install requires a valid package artifact before lifecycle activation', async () => {
  const bytes = new TextEncoder().encode('remote package')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  let activated = false
  const updates: string[] = []
  const pool = { async query(sql: string) { updates.push(sql); return { rows: [] } }, async connect() { return { async query(sql: string) { updates.push(sql); if (sql.includes('SELECT install_path')) return { rows: [{ install_path: '/tmp/installed', status: 'staged' }] }; return { rows: [] } }, release() {} } } } as any
  const fetcher = async () => new Response(bytes, { status: 200 })
  await assert.rejects(installRemotePlugin({ pool, pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', version: '1.2.3', integritySha512: integrity, token: 'fixture', root: await mkdtemp(join(tmpdir(), 'tg-remote-')), fetcher, npmRunner: async () => undefined, lifecycleInstall: async () => { activated = true } }), /ENOENT/)
  assert.equal(activated, false)
})
