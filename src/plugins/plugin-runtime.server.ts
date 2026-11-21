import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageNameForPlugin } from './install-records.server'

type PluginManifest = { id: string; version: string; hostRange?: string }
type RuntimeModule = { manifest?: PluginManifest; plugin?: unknown }
const hostVersion = '1.0.0'

function compatibleHost(range: string | undefined) {
  if (!range) return false
  const match = /^>=([0-9]+)\.([0-9]+)\.([0-9]+) <([0-9]+)\.([0-9]+)\.([0-9]+)$/u.exec(range)
  if (!match) return false
  const current = hostVersion.split('.').map(Number), min = match.slice(1, 4).map(Number), max = match.slice(4, 7).map(Number)
  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  return compare(current, min) >= 0 && compare(current, max) < 0
}

export async function loadInstalledPlugin(pluginId: string, installPath: string): Promise<RuntimeModule & { manifest: PluginManifest }> {
  const entry = join(installPath, 'node_modules', packageNameForPlugin(pluginId), 'src', 'index.js')
  await access(entry)
  const loaded = await import(pathToFileURL(entry).href) as RuntimeModule
  if (!loaded.manifest || loaded.manifest.id !== pluginId) throw new Error('plugin_manifest_id_mismatch')
  if (!compatibleHost(loaded.manifest.hostRange)) throw new Error('plugin_host_incompatible')
  return { ...loaded, manifest: loaded.manifest }
}
