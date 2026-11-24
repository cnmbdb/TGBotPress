import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { downloadAndStagePluginArtifact, inspectNpmPluginPackage, validateNpmPluginTarball } from './package-download.server'

test('package download requires a registry token and accepts only a bounded response', async () => {
  await assert.rejects(downloadAndStagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', source: 'github-packages', version: '1.2.3', integritySha512: 'sha512-YWJjZA==', root: '/tmp/plugin-test', token: '' }), /plugin_registry_token_required/)
  const fetcher = async (_url: string | URL, init?: RequestInit) => { assert.equal(init?.redirect, 'error'); return new Response(new TextEncoder().encode('bad'), { status: 404 }) }
  await assert.rejects(downloadAndStagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', source: 'github-packages', version: '1.2.3', integritySha512: 'sha512-YWJjZA==', root: '/tmp/plugin-test', token: 'test-token', fetcher }), /plugin_registry_http_404/)
})

test('npm inspection validates the package manifest, integrity and dependencies before install', async () => {
  const manifest = {
    schemaVersion: 1,
    id: 'example.welcome',
    name: 'Welcome',
    version: '1.0.0',
    apiVersion: 1,
    hostRange: '>=1.0.0 <2.0.0',
    sdkRange: '^0.1.0',
    runtime: { node: '>=22' },
    entry: './dist/index.js',
    permissions: ['telegram.updates.read'],
    telegramUpdateTypes: ['message'],
  }
  const inspection = await inspectNpmPluginPackage({
    packageName: '@example/tgbotpress-plugin-welcome',
    version: '1.0.0',
    fetcher: async (_url, init) => {
      assert.equal(init?.redirect, 'error')
      return Response.json({ name: '@example/tgbotpress-plugin-welcome', version: '1.0.0', tgbotpressPlugin: manifest, dependencies: { 'tiny-thing': '^2.0.0' }, dist: { integrity: 'sha512-YWJjZA==', tarball: 'https://registry.npmjs.org/example/welcome.tgz' } })
    },
  })
  assert.equal(inspection.manifest.id, 'example.welcome')
  assert.deepEqual(inspection.dependencies, { 'tiny-thing': '^2.0.0' })
  assert.equal(inspection.integritySha512, 'sha512-YWJjZA==')
})

test('npm tarball validation rejects path traversal before dependency installation', () => {
  const header=Buffer.alloc(512)
  header.write('../outside',0,'utf8')
  header.write('00000000000',124,'ascii')
  header[156]=48
  const tarball=gzipSync(Buffer.concat([header,Buffer.alloc(1024)]))
  const manifest={schemaVersion:1,id:'example.safe',name:'Safe',version:'1.0.0',apiVersion:1,hostRange:'>=1.0.0 <2.0.0',sdkRange:'^0.1.0',runtime:{node:'>=22'},entry:'./dist/index.js',permissions:[]}
  assert.throws(()=>validateNpmPluginTarball(tarball,'@example/safe','1.0.0',manifest as never,{}),/plugin_npm_tarball_path_invalid/u)
})
