import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadAndStagePluginArtifact } from './package-download.server'

test('package download requires a registry token and accepts only a bounded response', async () => {
  await assert.rejects(downloadAndStagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', source: 'github-packages', version: '1.2.3', integritySha512: 'sha512-YWJjZA==', root: '/tmp/plugin-test', token: '' }), /plugin_registry_token_required/)
  const fetcher = async (_url: string | URL, init?: RequestInit) => { assert.equal(init?.redirect, 'error'); return new Response(new TextEncoder().encode('bad'), { status: 404 }) }
  await assert.rejects(downloadAndStagePluginArtifact({ pluginId: 'groups', packageName: '@tgbotpress/plugin-groups', source: 'github-packages', version: '1.2.3', integritySha512: 'sha512-YWJjZA==', root: '/tmp/plugin-test', token: 'test-token', fetcher }), /plugin_registry_http_404/)
})
