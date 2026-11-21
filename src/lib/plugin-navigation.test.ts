import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pluginCatalog } from '../plugins/catalog'
import { pluginMenuVisible } from './plugin-navigation'

test('disabled and uninstalled plugin menus disappear while shared and unknown menus remain', () => {
  for (const plugin of pluginCatalog) {
    for (const route of plugin.menuRoutes) {
      assert.equal(pluginMenuVisible(route, [{ state: 'active', menuRoutes: plugin.menuRoutes }]), true, `${plugin.id} active`)
      assert.equal(pluginMenuVisible(route, [{ state: 'draining', menuRoutes: plugin.menuRoutes }]), false, `${plugin.id} draining`)
      assert.equal(pluginMenuVisible(route, [{ state: 'uninstalled', menuRoutes: plugin.menuRoutes }]), false, `${plugin.id} uninstalled`)
      assert.equal(pluginMenuVisible(route, [{ state: null, menuRoutes: plugin.menuRoutes }]), true, `${plugin.id} unknown`)
    }
  }
  assert.equal(pluginMenuVisible('admin.telegram.command.index', [{ state: 'draining', menuRoutes: ['admin.energy.order.index'] }]), true)
  assert.equal(pluginMenuVisible('admin.energy.order.index'), true)
})
