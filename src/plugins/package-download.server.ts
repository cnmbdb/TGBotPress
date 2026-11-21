import { trustedPackageForPlugin, type TrustedPluginPackage } from './install-policy.server'
import { stagePluginArtifact, type InstalledArtifact } from './package-installer.server'

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
const registryOrigin = 'https://npm.pkg.github.com'
const maxArtifactBytes = 50 * 1024 * 1024

function packageUrl(packageName: string, version: string) {
  const encoded = packageName.replace(/^@/, '').replace('/', '%2f')
  return `${registryOrigin}/@${encoded}/-/${packageName.split('/')[1]}-${version}.tgz`
}

export async function downloadAndStagePluginArtifact(input: Omit<TrustedPluginPackage, 'integritySha512'> & { integritySha512: string; fetcher?: Fetcher; root: string; token: string }): Promise<InstalledArtifact> {
  const trusted = trustedPackageForPlugin(input.pluginId, { packageName: input.packageName, version: input.version, source: 'github-packages', integritySha512: input.integritySha512 })
  if (!input.token.trim()) throw new Error('plugin_registry_token_required')
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(packageUrl(trusted.packageName, trusted.version), { redirect: 'error', headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${input.token}` } })
  if (!response.ok) throw new Error('plugin_registry_http_' + response.status)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  return stagePluginArtifact({ ...trusted, bytes: buffer }, input.root)
}
