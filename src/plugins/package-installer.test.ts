import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { removeInstalledPluginFiles, stagePluginArtifact, verifyStagedPluginArtifact } from './package-installer.server'
const bytes = new TextEncoder().encode('plugin tarball fixture')
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
test('stages a verified artifact atomically and can verify it again', async () => { const root = await mkdtemp(join(tmpdir(), 'tg-plugin-test-')); const artifact = await stagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages', integritySha512: integrity, bytes }, root); assert.equal(await verifyStagedPluginArtifact(join(artifact.installPath, 'package.tgz'), integrity), true); assert.deepEqual(new Uint8Array(await readFile(join(artifact.installPath, 'package.tgz'))), bytes) })
test('rejects a changed artifact before creating a version directory', async () => { const root = await mkdtemp(join(tmpdir(), 'tg-plugin-test-')); await assert.rejects(stagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages', integritySha512: integrity, bytes: new TextEncoder().encode('tampered') }, root), /plugin_integrity_mismatch/) })

test('installs dependencies with lifecycle scripts disabled', async () => {
  const { installPluginDependencies } = await import('./package-installer.server')
  let args: string[] = []
  let authConfig = ''
  let configPath = ''
  const path = await mkdtemp(join(tmpdir(), 'tg-plugin-version-'))
  await installPluginDependencies({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages', installPath: path, integritySha512: integrity }, async (_command, received, options) => { args = received; assert.equal(options.cwd, path); configPath = received[received.indexOf('--userconfig') + 1]; authConfig = await readFile(configPath, 'utf8'); assert.equal((await stat(configPath)).mode & 0o777, 0o600) }, 'fixture-token')
  assert.ok(args.includes('--ignore-scripts'))
  assert.ok(args.includes('--omit=dev'))
  assert.ok(args.includes('--save-exact'))
  assert.equal(args.includes('--no-package-lock'), false)
  assert.match(authConfig, /_authToken=fixture-token/u)
  await assert.rejects(access(configPath))
})

test('uninstall removes only an artifact inside its plugin version directory', async()=>{
  const root=await mkdtemp(join(tmpdir(),'tg-plugin-remove-'))
  const versionDir=join(root,'example.welcome','1.0.0-sha')
  await mkdir(versionDir,{recursive:true})
  await writeFile(join(versionDir,'package.tgz'),'fixture')
  await removeInstalledPluginFiles(root,'example.welcome',versionDir)
  await assert.rejects(access(versionDir))
  await assert.rejects(removeInstalledPluginFiles(root,'example.welcome',join(root,'other','version')),/plugin_install_path_invalid/u)
  await rm(root,{recursive:true,force:true})
})
