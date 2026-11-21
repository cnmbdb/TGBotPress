import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trustedPackageForPlugin } from './install-policy.server'

test('trusted plugin policy accepts the official GitHub package identity', () => {
  const record = trustedPackageForPlugin('groups', { packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages', integritySha512: 'sha512-YWJjZA==' })
  assert.equal(record.pluginId, 'groups')
})

test('trusted plugin policy rejects package substitution and missing integrity', () => {
  assert.throws(() => trustedPackageForPlugin('groups', { packageName: '@evil/plugin-groups', version: '1.2.3', source: 'github-packages', integritySha512: 'sha512-YWJjZA==' }), /plugin_package_not_trusted/)
  assert.throws(() => trustedPackageForPlugin('groups', { packageName: '@tgbotpress/plugin-groups', version: '1.2.3', source: 'github-packages' }), /plugin_integrity_required/)
})
