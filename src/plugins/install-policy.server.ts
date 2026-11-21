import { pluginCatalog } from './catalog'

export type PluginPackageSource = 'builtin' | 'github-packages'
export type TrustedPluginPackage = { pluginId: string; packageName: string; version: string; source: PluginPackageSource; integritySha512?: string | null }

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const integrity = /^sha512-[A-Za-z0-9+/]+={0,2}$/u

export function trustedPackageForPlugin(pluginId: string, input: Omit<TrustedPluginPackage, 'pluginId'>): TrustedPluginPackage {
  const plugin = pluginCatalog.find(item => item.id === pluginId)
  if (!plugin) throw new Error('plugin_not_found')
  const expected = `@tgbotpress/plugin-${pluginId}`
  if (input.packageName !== expected) throw new Error('plugin_package_not_trusted')
  if (!semver.test(input.version)) throw new Error('plugin_version_invalid')
  if (input.source !== 'builtin' && input.source !== 'github-packages') throw new Error('plugin_source_invalid')
  if (input.source === 'github-packages' && !input.integritySha512) throw new Error('plugin_integrity_required')
  if (input.integritySha512 != null && !integrity.test(input.integritySha512)) throw new Error('plugin_integrity_invalid')
  return { pluginId, ...input }
}
