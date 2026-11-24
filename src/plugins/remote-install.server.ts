import type { DatabaseConnection as Pool } from '../server/database.types'
import { downloadAndStageNpmPluginArtifact, downloadAndStagePluginArtifact } from './package-download.server'
import { installPluginDependencies, recordStagedArtifact, removeInstalledPluginFiles, type InstalledArtifact, type NpmRunner } from './package-installer.server'
import { deactivateInstalledPlugin, loadInstalledPlugin, readInstalledPluginManifest } from './plugin-runtime.server'
import { promoteStagedPlugin, rollbackPluginInstall } from './plugin-deployment.server'
import { pluginStorage } from './plugin-storage.server'
import { createPluginTelegramApi } from './telegram-api.server'
import type { ThirdPartyPluginManifest } from '@tgbotpress/plugin-sdk'

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
function stableJson(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export async function installRemotePlugin(input: { pool: Pick<Pool, 'query' | 'connect'>; pluginId?: string; packageName: string; version: string; source?: 'github-packages' | 'npmjs'; integritySha512?: string; expectedIntegritySha512?: string; expectedManifest?: ThirdPartyPluginManifest; token?: string; root: string; fetcher?: Fetcher; npmRunner?: NpmRunner; authorizePlugin?: (pluginId: string, manifest: ThirdPartyPluginManifest) => Promise<void>; lifecycleInstall: (pluginId: string, manifest: { id: string; version: string }) => Promise<void> }) {
  const source = input.source ?? 'github-packages'
  let artifact: InstalledArtifact, pluginId = input.pluginId
  let registryManifest: Awaited<ReturnType<typeof downloadAndStageNpmPluginArtifact>>['manifest'] | undefined
  if (source === 'npmjs') {
    const npmPackage = await downloadAndStageNpmPluginArtifact({
      packageName: input.packageName,
      version: input.version,
      expectedIntegritySha512: input.expectedIntegritySha512,
      root: input.root,
      fetcher: input.fetcher,
      authorizePlugin: manifest => {
        if(input.expectedManifest&&stableJson(manifest)!==stableJson(input.expectedManifest))throw new Error('plugin_npm_manifest_changed')
        return input.authorizePlugin?.(manifest.id, manifest) ?? Promise.resolve()
      },
    })
    artifact = npmPackage.artifact
    registryManifest = npmPackage.manifest
    pluginId = npmPackage.manifest.id
  } else {
    if (!pluginId || !input.integritySha512) throw new Error('plugin_remote_parameters_invalid')
    artifact = await downloadAndStagePluginArtifact({ pluginId, packageName: input.packageName, version: input.version, source: 'github-packages', integritySha512: input.integritySha512, token: input.token ?? '', root: input.root, fetcher: input.fetcher })
  }
  if (!pluginId) throw new Error('plugin_manifest_id_missing')
  const telegram = source === 'npmjs' ? createPluginTelegramApi(input.pool, pluginId) : undefined
  let loaded: Awaited<ReturnType<typeof loadInstalledPlugin>>
  let promoted = false
  try {
    await installPluginDependencies(artifact, input.npmRunner, input.token)
    if(source==='npmjs'&&registryManifest){
      const packageManifest=await readInstalledPluginManifest(artifact.installPath,pluginId,artifact.packageName)
      if(stableJson(packageManifest)!==stableJson(registryManifest))throw new Error('plugin_manifest_registry_mismatch')
    }
    loaded = await loadInstalledPlugin(pluginId, artifact.installPath, artifact.packageName, source, pluginStorage(input.pool, pluginId), telegram)
    if (loaded.manifest.version !== input.version) throw new Error('plugin_manifest_version_mismatch')
    await recordStagedArtifact(input.pool, artifact, loaded.manifest)
    const result = await promoteStagedPlugin(input.pool, pluginId, input.version, async () => {
      const health = await loadInstalledPlugin(pluginId, artifact.installPath, artifact.packageName, source, pluginStorage(input.pool, pluginId), telegram)
      return health.manifest.id === pluginId && health.manifest.version === input.version
    }, { installPath: artifact.installPath, integritySha512: artifact.integritySha512, packageName: artifact.packageName })
    promoted = true
    await input.lifecycleInstall(pluginId, loaded.manifest)
    return { ...result, manifest: loaded.manifest, pluginId, packageName: artifact.packageName, registrations: loaded.registrations ?? null }
  } catch (error) {
    if (promoted) await rollbackPluginInstall(input.pool, pluginId, artifact.packageName).catch(() => undefined)
    await deactivateInstalledPlugin(pluginId, artifact.installPath, artifact.packageName, source).catch(() => undefined)
    await removeInstalledPluginFiles(input.root,pluginId,artifact.installPath).catch(()=>undefined)
    throw error
  }
}
