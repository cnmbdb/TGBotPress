import { pluginCatalog } from './catalog'

export type PluginPackageSource = 'builtin' | 'github-packages' | 'npmjs'
export type TrustedPluginPackage = { pluginId: string; packageName: string; version: string; source: PluginPackageSource; integritySha512?: string | null }

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const integrity = /^sha512-[A-Za-z0-9+/]+={0,2}$/u
const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u
const npmPackageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/u

export function trustedPackageForPlugin(pluginId: string, input: Omit<TrustedPluginPackage, 'pluginId'>): TrustedPluginPackage {
  const plugin = pluginCatalog.find(item => item.id === pluginId)
  if (!pluginIdPattern.test(pluginId) || pluginId.length > 64) throw new Error('plugin_id_invalid')
  if (!npmPackageNamePattern.test(input.packageName)) throw new Error('plugin_package_invalid')
  const expected = `@tgbotpress/plugin-${pluginId}`
  if (input.source === 'builtin' && (!plugin || input.packageName !== expected)) throw new Error('plugin_package_not_trusted')
  if (input.source === 'github-packages' && (!plugin || input.packageName !== expected)) throw new Error('plugin_package_not_trusted')
  if (input.source === 'npmjs' && plugin) throw new Error('plugin_id_reserved')
  if (!semver.test(input.version)) throw new Error('plugin_version_invalid')
  if (input.source !== 'builtin' && input.source !== 'github-packages' && input.source !== 'npmjs') throw new Error('plugin_source_invalid')
  if (input.source !== 'builtin' && !input.integritySha512) throw new Error('plugin_integrity_required')
  if (input.integritySha512 != null && !integrity.test(input.integritySha512)) throw new Error('plugin_integrity_invalid')
  return { pluginId, ...input }
}
