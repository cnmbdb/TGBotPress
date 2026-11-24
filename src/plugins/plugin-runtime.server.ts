import { randomUUID } from 'node:crypto'
import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageNameForPlugin } from './install-records.server'
import { collectThirdPartyRegistrations, PLUGIN_SDK_VERSION, validateThirdPartyManifest, validateThirdPartyPlugin, type PluginTelegramApi, type ThirdPartyPlugin, type ThirdPartyPluginManifest, type ThirdPartyPluginStorage } from '@tgbotpress/plugin-sdk'

type PluginManifest = { id: string; version: string; hostRange?: string; name?: string; description?: string; permissions?: string[]; telegramUpdateTypes?: string[] }
type RuntimeModule = { manifest?: PluginManifest; plugin?: unknown; default?: unknown; registrations?: Awaited<ReturnType<typeof collectThirdPartyRegistrations>> }
type LoadedRuntime = RuntimeModule & { manifest: PluginManifest }
const hostVersion = '1.0.0'
const runtimeCache = new Map<string, Promise<RuntimeModule & { manifest: PluginManifest; registrations?: Awaited<ReturnType<typeof collectThirdPartyRegistrations>> }>>()

function stableJson(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)??'null'
}

function versionParts(value: string) {
  const match=/^(\d+)\.(\d+)\.(\d+)/u.exec(value)
  return match ? match.slice(1).map(Number) : null
}

function compareVersion(a: number[], b: number[]) {
  return a[0]-b[0]||a[1]-b[1]||a[2]-b[2]
}

function satisfiesRange(range: string, currentVersion: string) {
  const current=versionParts(currentVersion)
  if(!current)return false
  const bounded=/^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)\.(\d+)$/u.exec(range)
  if(bounded){const min=bounded.slice(1,4).map(Number),max=bounded.slice(4,7).map(Number);return compareVersion(current,min)>=0&&compareVersion(current,max)<0}
  const simple=/^(\^|~)(\d+)\.(\d+)\.(\d+)$/u.exec(range)
  if(simple){const min=simple.slice(2).map(Number),max=[...min];if(simple[1]==='~')max[1]++;else if(min[0]>0)max[0]++;else if(min[1]>0)max[1]++;else max[2]++;return compareVersion(current,min)>=0&&compareVersion(current,max)<0}
  const node=/^>=(\d+)$/u.exec(range)
  if(node)return current[0]>=Number(node[1])
  return compareVersion(current,versionParts(range)??[-1,-1,-1])===0
}

function packageRootPath(installPath: string, pluginId: string, packageName?: string) {
  return join(installPath,'node_modules',...packageNameForPlugin(pluginId,packageName).split('/'))
}

function isInside(directory: string, path: string) {
  const pathFromRoot=relative(directory,path)
  return pathFromRoot===''||(!pathFromRoot.startsWith('..')&&!isAbsolute(pathFromRoot))
}

export async function readInstalledPluginManifest(installPath: string, pluginId: string, packageName?: string): Promise<ThirdPartyPluginManifest> {
  const root=await realpath(packageRootPath(installPath,pluginId,packageName))
  const manifestPath=await realpath(join(root,'tgbotpress.plugin.json'))
  if(!isInside(root,manifestPath))throw new Error('plugin_manifest_path_invalid')
  let parsed: unknown, packageMetadata: {name?:unknown;version?:unknown;tgbotpressPlugin?:unknown}
  try{
    parsed=JSON.parse(await readFile(manifestPath,'utf8'))
    packageMetadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  }catch{throw new Error('plugin_manifest_json_invalid')}
  const manifest=validateThirdPartyManifest(parsed)
  if(packageMetadata.name!==packageNameForPlugin(pluginId,packageName)||packageMetadata.version!==manifest.version)throw new Error('plugin_package_identity_mismatch')
  let mirrored: ThirdPartyPluginManifest
  try{mirrored=validateThirdPartyManifest(packageMetadata.tgbotpressPlugin)}catch{throw new Error('plugin_package_manifest_missing_or_invalid')}
  if(stableJson(mirrored)!==stableJson(manifest))throw new Error('plugin_package_manifest_mismatch')
  return manifest
}

async function loadInstalledPluginUncached(pluginId: string, installPath: string, packageName: string | undefined, source: 'builtin'|'github-packages'|'npmjs', storage?: ThirdPartyPluginStorage, telegram?: PluginTelegramApi): Promise<LoadedRuntime> {
  if (source === 'npmjs') {
    const packageRoot=await realpath(packageRootPath(installPath,pluginId,packageName))
    const manifest=await readInstalledPluginManifest(installPath,pluginId,packageName)
    if(manifest.id!==pluginId)throw new Error('plugin_manifest_id_mismatch')
    if(!satisfiesRange(manifest.hostRange,hostVersion))throw new Error('plugin_host_incompatible')
    if(!satisfiesRange(manifest.sdkRange,PLUGIN_SDK_VERSION))throw new Error('plugin_sdk_incompatible')
    if(!satisfiesRange(manifest.runtime.node,process.versions.node))throw new Error('plugin_node_incompatible')
    const entryPath=resolve(packageRoot,manifest.entry)
    const entry=await realpath(entryPath)
    if(!isInside(packageRoot,entry))throw new Error('plugin_entry_path_invalid')
    await access(entry)
    const entryUrl=pathToFileURL(entry)
    entryUrl.searchParams.set('tgbotpress-runtime',randomUUID())
    const loaded=await import(entryUrl.href) as RuntimeModule
    const plugin = (loaded.plugin ?? loaded.default) as ThirdPartyPlugin
    validateThirdPartyPlugin(plugin)
    if (stableJson(plugin.manifest)!==stableJson(manifest))throw new Error('plugin_manifest_export_mismatch')
    if (loaded.manifest && (loaded.manifest.id !== pluginId || loaded.manifest.version !== plugin.manifest.version)) throw new Error('plugin_manifest_id_mismatch')
    const registrations = await collectThirdPartyRegistrations(plugin, { storage, telegram })
    return { ...loaded, manifest: plugin.manifest, plugin, registrations }
  }
  const entry = join(installPath, 'node_modules', ...packageNameForPlugin(pluginId, packageName).split('/'), 'src', 'index.js')
  await access(entry)
  const loaded = await import(pathToFileURL(entry).href) as RuntimeModule
  if (!loaded.manifest || loaded.manifest.id !== pluginId) throw new Error('plugin_manifest_id_mismatch')
  if (loaded.manifest.hostRange && !satisfiesRange(loaded.manifest.hostRange,hostVersion)) throw new Error('plugin_host_incompatible')
  return { ...loaded, manifest: loaded.manifest }
}

export function loadInstalledPlugin(pluginId: string, installPath: string, packageName?: string, source: 'builtin'|'github-packages'|'npmjs' = 'github-packages', storage?: ThirdPartyPluginStorage, telegram?: PluginTelegramApi): Promise<LoadedRuntime> {
  const cacheKey = `${source}:${pluginId}:${installPath}:${packageName ?? ''}`
  const cached = runtimeCache.get(cacheKey)
  if (cached) return cached
  const loading = loadInstalledPluginUncached(pluginId, installPath, packageName, source, storage, telegram).catch(error => {
    runtimeCache.delete(cacheKey)
    throw error
  })
  runtimeCache.set(cacheKey, loading)
  return loading
}

export async function deactivateInstalledPlugin(pluginId: string, installPath: string, packageName: string, source: 'builtin'|'github-packages'|'npmjs' = 'npmjs') {
  const cacheKey = `${source}:${pluginId}:${installPath}:${packageName}`
  const runtime = runtimeCache.get(cacheKey)
  if (!runtime) return false
  const loaded = await runtime
  const plugin = loaded.plugin as ThirdPartyPlugin | undefined
  try { await plugin?.deactivate?.(); return true }
  finally { runtimeCache.delete(cacheKey) }
}
