import { cloneProxyPlugin } from './cloneproxy/index.server'
import { groupManagementPlugin } from './groups/index.server'
import { pluginCatalog } from './catalog'

const registeredModuleDescriptors = pluginCatalog.filter(plugin => ['transit','energy','premium','monitor','collection','shop'].includes(plugin.id)).map(plugin => ({ id: plugin.id, version: 1, manifest: plugin }))

/** Built-in plugins are loaded once; duplicate IDs are rejected at startup. */
export function createPluginRegistry<T extends { id: string }>(plugins: readonly T[]) {
  const registry = new Map<string, T>()
  for (const plugin of plugins) {
    if (!plugin.id.trim() || registry.has(plugin.id)) throw new Error('Invalid or duplicate plugin ID: ' + plugin.id)
    registry.set(plugin.id, plugin)
  }
  return { get(id: string): T | undefined { return registry.get(id) }, list(): readonly T[] { return [...registry.values()] } }
}

export const pluginRegistry = createPluginRegistry([cloneProxyPlugin, groupManagementPlugin, ...registeredModuleDescriptors])
export const registeredCloneProxy = pluginRegistry.get('cloneproxy')! as typeof cloneProxyPlugin
export const registeredGroupManagement = pluginRegistry.get('groups')! as typeof groupManagementPlugin
