import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { pluginCatalog } from './catalog'
import { adminNavigation } from '../config/admin-navigation'
import { createPluginRegistry, pluginRegistry } from './registry.server'
import { manifest as cloneProxyPackageManifest } from '@tgbotpress/plugin-cloneproxy'
import { PLUGIN_SDK_VERSION } from '../../packages/plugin-sdk/src/index.js'
import { manifest as transitPackageManifest } from '@tgbotpress/plugin-transit'
import { manifest as energyPackageManifest } from '@tgbotpress/plugin-energy'
import { manifest as groupsPackageManifest } from '@tgbotpress/plugin-groups'
import { manifest as monitorPackageManifest } from '@tgbotpress/plugin-monitor'

test('all eight built-in plugins are uniquely registered with route and task manifests', () => {
  const expected = ['groups','transit','energy','premium','monitor','collection','shop','cloneproxy'].sort()
  assert.deepEqual(pluginRegistry.list().map(plugin => plugin.id).sort(), expected)
  assert.deepEqual(pluginCatalog.map(plugin => plugin.id).sort(), expected)
  const menuRoutes=new Set(adminNavigation.flatMap(group=>group.items.map(item=>item.id)))
  const pluginIds=new Set(pluginCatalog.map(plugin=>plugin.id))
  for(const plugin of pluginCatalog){for(const route of plugin.menuRoutes)assert.ok(menuRoutes.has(route),`${plugin.id} menu route ${route}`);for(const dependency of plugin.dependencies)assert.ok(pluginIds.has(dependency),`${plugin.id} dependency ${dependency}`)}
  assert.throws(() => createPluginRegistry([{id:'duplicate'},{id:'duplicate'}]), /duplicate plugin ID/)
  for (const plugin of pluginCatalog) {
    assert.ok(Array.isArray(plugin.menuRoutes) && plugin.menuRoutes.length > 0, `${plugin.id} menus`)
    assert.ok(Array.isArray(plugin.apiRoutes), `${plugin.id} APIs`)
    assert.ok(Array.isArray(plugin.tasks), `${plugin.id} tasks`)
    assert.ok(Array.isArray(plugin.dependencies), `${plugin.id} dependencies`)
    for (const route of plugin.apiRoutes) {
      const file = new URL(`../routes/api.${route.slice('/api/'.length).replaceAll('/','.')}.ts`, import.meta.url)
      const source = readFileSync(file, 'utf8')
      const guard = plugin.id === 'groups' ? route === '/api/moderation' ? 'registeredGroupManagement.admin.api' : 'registeredGroupManagement.admin.guard' : plugin.id === 'cloneproxy' ? 'guardCloneProxyWrite' : 'guardManagedPluginWrite'
      assert.ok(source.includes(guard), `${plugin.id} write gate for ${route}`)
    }
  }
})

test('cloneproxy package manifest matches the host catalog', () => {
  const host = pluginCatalog.find(plugin => plugin.id === 'cloneproxy')!
  assert.equal(cloneProxyPackageManifest.id, host.id)
  assert.equal(cloneProxyPackageManifest.sdkVersion, PLUGIN_SDK_VERSION)
  assert.match(cloneProxyPackageManifest.hostRange, /^>=1\.0\.0/)
  assert.equal(cloneProxyPackageManifest.name, host.name)
  assert.deepEqual(cloneProxyPackageManifest.menuRoutes, host.menuRoutes)
  assert.deepEqual(cloneProxyPackageManifest.apiRoutes, host.apiRoutes)
  assert.deepEqual(cloneProxyPackageManifest.tasks, host.tasks)
  assert.deepEqual(cloneProxyPackageManifest.drainTasks, host.drainTasks)
})

test('transit package manifest matches the host catalog', () => {
  const host = pluginCatalog.find(plugin => plugin.id === 'transit')!
  assert.equal(transitPackageManifest.id, host.id)
  assert.equal(transitPackageManifest.sdkVersion, PLUGIN_SDK_VERSION)
  assert.deepEqual(transitPackageManifest.menuRoutes, host.menuRoutes)
  assert.deepEqual(transitPackageManifest.apiRoutes, host.apiRoutes)
  assert.deepEqual(transitPackageManifest.tasks, host.tasks)
  assert.deepEqual(transitPackageManifest.drainTasks, host.drainTasks)
})

test('energy package manifest matches the host catalog', () => {
  const host = pluginCatalog.find(plugin => plugin.id === 'energy')!
  assert.equal(energyPackageManifest.id, host.id)
  assert.equal(energyPackageManifest.sdkVersion, PLUGIN_SDK_VERSION)
  assert.deepEqual(energyPackageManifest.menuRoutes, host.menuRoutes)
  assert.deepEqual(energyPackageManifest.apiRoutes, host.apiRoutes)
  assert.deepEqual(energyPackageManifest.tasks, host.tasks)
  assert.deepEqual(energyPackageManifest.drainTasks, host.drainTasks)
})

test('groups package manifest matches the host catalog', () => {
  const host = pluginCatalog.find(plugin => plugin.id === 'groups')!
  assert.equal(groupsPackageManifest.sdkVersion, PLUGIN_SDK_VERSION)
  assert.deepEqual(groupsPackageManifest.menuRoutes, host.menuRoutes)
  assert.deepEqual(groupsPackageManifest.apiRoutes, host.apiRoutes)
  assert.deepEqual(groupsPackageManifest.tasks, host.tasks)
  assert.deepEqual(groupsPackageManifest.drainTasks, host.drainTasks)
})

test('monitor package manifest matches the host catalog', () => {
  const host = pluginCatalog.find(plugin => plugin.id === 'monitor')!
  assert.equal(monitorPackageManifest.id, host.id)
  assert.equal(monitorPackageManifest.sdkVersion, PLUGIN_SDK_VERSION)
  assert.deepEqual(monitorPackageManifest.menuRoutes, host.menuRoutes)
  assert.deepEqual(monitorPackageManifest.apiRoutes, host.apiRoutes)
  assert.deepEqual(monitorPackageManifest.tasks, host.tasks)
  assert.deepEqual(monitorPackageManifest.drainTasks, host.drainTasks)
})
