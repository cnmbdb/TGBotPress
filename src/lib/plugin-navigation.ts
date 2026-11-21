export type PluginNavigationState = { state: string | null; menuRoutes?: readonly string[] }

/** Keep shared and unknown routes visible; hide a route only for a known stopped owner. */
export function pluginMenuVisible(route: string, plugins?: readonly PluginNavigationState[]) {
  const owner = plugins?.find(plugin => plugin.menuRoutes?.includes(route))
  return owner?.state !== 'draining' && owner?.state !== 'uninstalled'
}
