import type { DatabaseConnection as Pool } from '../server/database.types'
import { downloadAndStagePluginArtifact } from './package-download.server'
import { installPluginDependencies, recordStagedArtifact, type NpmRunner } from './package-installer.server'
import { loadInstalledPlugin } from './plugin-runtime.server'
import { promoteStagedPlugin, rollbackPluginInstall } from './plugin-deployment.server'

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
export async function installRemotePlugin(input: { pool: Pick<Pool, 'query' | 'connect'>; pluginId: string; packageName: string; version: string; integritySha512: string; token: string; root: string; fetcher?: Fetcher; npmRunner?: NpmRunner; lifecycleInstall: () => Promise<void> }) {
  const artifact = await downloadAndStagePluginArtifact({ ...input, source: 'github-packages' })
  await installPluginDependencies(artifact, input.npmRunner, input.token)
  await recordStagedArtifact(input.pool, artifact)
  const loaded = await loadInstalledPlugin(input.pluginId, artifact.installPath)
  if (loaded.manifest.version !== input.version) throw new Error('plugin_manifest_version_mismatch')
  const promoted = await promoteStagedPlugin(input.pool, input.pluginId, input.version, async () => {
    const health = await loadInstalledPlugin(input.pluginId, artifact.installPath)
    return health.manifest.id === input.pluginId && health.manifest.version === input.version
  }, { installPath: artifact.installPath, integritySha512: artifact.integritySha512 })
  try {
    await input.lifecycleInstall()
  } catch (error) {
    await rollbackPluginInstall(input.pool, input.pluginId).catch(() => undefined)
    throw error
  }
  return promoted
}
