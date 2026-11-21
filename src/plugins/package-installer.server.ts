import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DatabaseConnection as Pool } from '../server/database.types'
const execFileAsync = promisify(execFile)

import { trustedPackageForPlugin, type TrustedPluginPackage } from './install-policy.server'

export type PluginArtifact = TrustedPluginPackage & { bytes: Uint8Array }
export type InstalledArtifact = TrustedPluginPackage & { installPath: string; integritySha512: string }
function digest(bytes: Uint8Array) { return `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
function safeVersion(version: string) { return version.replaceAll('.', '_').replaceAll('-', '_').replaceAll('+', '_') }
export async function stagePluginArtifact(input: PluginArtifact, root: string): Promise<InstalledArtifact> {
  const trusted = trustedPackageForPlugin(input.pluginId, { packageName: input.packageName, version: input.version, source: input.source, integritySha512: input.integritySha512 })
  const actual = digest(input.bytes)
  if (trusted.integritySha512 && trusted.integritySha512 !== actual) throw new Error('plugin_integrity_mismatch')
  const versionDir = join(root, trusted.pluginId, `${safeVersion(trusted.version)}-${actual.slice('sha512-'.length, 24)}`)
  const parent = dirname(versionDir)
  const tempRoot = await mkdtemp(join(tmpdir(), 'tg-plugin-'))
  try {
    await writeFile(join(tempRoot, 'package.tgz'), input.bytes)
    await mkdir(parent, { recursive: true })
    try {
      await rename(tempRoot, versionDir)
    } catch (error) {
      try {
        await verifyStagedPluginArtifact(join(versionDir, 'package.tgz'), actual)
        await rm(tempRoot, { recursive: true, force: true })
      } catch {
        throw new Error('plugin_version_artifact_conflict', { cause: error })
      }
    }
    return { ...trusted, installPath: versionDir, integritySha512: actual }
  } catch (error) { await rm(tempRoot, { recursive: true, force: true }); throw error }
}
export async function verifyStagedPluginArtifact(path: string, expectedIntegrity: string) {
  if (digest(await readFile(path)) !== expectedIntegrity) throw new Error('plugin_integrity_mismatch')
  return true
}
export async function recordStagedArtifact(pool: Pick<Pool, 'connect'>, artifact: InstalledArtifact) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':install',0))", [artifact.pluginId])
    await client.query(`INSERT INTO t_platform_plugin_install_attempt(plugin_id,package_name,version,source,integrity_sha512,install_path,status,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'staged',now()) ON CONFLICT(plugin_id) DO UPDATE SET
      package_name=EXCLUDED.package_name,version=EXCLUDED.version,source=EXCLUDED.source,
      integrity_sha512=EXCLUDED.integrity_sha512,install_path=EXCLUDED.install_path,status='staged',last_error=NULL,updated_at=now()`,
    [artifact.pluginId, artifact.packageName, artifact.version, artifact.source, artifact.integritySha512, artifact.installPath])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}

export type NpmRunner = (command: string, args: string[], options: { cwd: string }) => Promise<void>
export async function installPluginDependencies(artifact: InstalledArtifact, runner: NpmRunner = async (command, args, options) => { await execFileAsync(command, args, options) }, registryToken?: string) {
  let npmConfigDir: string | undefined
  try {
    const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--omit=dev', '--prefix', artifact.installPath]
    if (artifact.source === 'github-packages') {
      if (!registryToken?.trim()) throw new Error('plugin_registry_token_required')
      npmConfigDir = await mkdtemp(join(tmpdir(), 'tg-npm-auth-'))
      const npmConfig = join(npmConfigDir, 'npmrc')
      await writeFile(npmConfig, `@tgbotpress:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${registryToken.trim()}\nalways-auth=true\n`, { mode: 0o600, flag: 'wx' })
      args.push('--userconfig', npmConfig)
    }
    args.push(join(artifact.installPath, 'package.tgz'))
    await runner('npm', args, { cwd: artifact.installPath })
    return artifact.installPath
  } finally {
    if (npmConfigDir) await rm(npmConfigDir, { recursive: true, force: true })
  }
}
