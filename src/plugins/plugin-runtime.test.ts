import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadInstalledPlugin } from './plugin-runtime.server'
async function fixture(source: string) { const root = await mkdtemp(join(tmpdir(), 'tg-plugin-runtime-')); const dir = join(root, 'node_modules', '@tgbotpress', 'plugin-groups', 'src'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'index.js'), source); return root }
test('loads an installed plugin only when manifest identity and host range match', async () => { const root = await fixture("export const manifest={id:'groups',version:'1.2.3',hostRange:'>=1.0.0 <2.0.0'}"); const loaded = await loadInstalledPlugin('groups', root); assert.equal(loaded.manifest.version, '1.2.3') })
test('rejects an incompatible installed plugin', async () => { const root = await fixture("export const manifest={id:'groups',version:'1.2.3',hostRange:'>=2.0.0 <3.0.0'}"); await assert.rejects(loadInstalledPlugin('groups', root), /plugin_host_incompatible/) })
