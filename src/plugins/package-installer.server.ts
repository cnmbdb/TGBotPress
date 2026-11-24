import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DatabaseConnection as Pool } from '../server/database.types'
const execFileAsync = promisify(execFile)

export function pluginInstallRoot() {
  return process.env.PLATFORM_PLUGIN_DIR?.trim() || join(process.cwd(), '.data', 'plugins')
}

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

function isInsidePath(root: string,path: string) {
  const rel=relative(root,path)
  return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)
}

export async function removeInstalledPluginFiles(root: string,pluginId: string,installPath: string) {
  const rootPath=resolve(root,pluginId),targetPath=resolve(installPath)
  if(!isInsidePath(rootPath,targetPath))throw new Error('plugin_install_path_invalid')
  try{
    const [rootReal,targetInfo,targetReal]=await Promise.all([realpath(rootPath),lstat(targetPath),realpath(targetPath)])
    if(targetInfo.isSymbolicLink()||!targetInfo.isDirectory()||!isInsidePath(rootReal,targetReal))throw new Error('plugin_install_path_invalid')
    await rm(targetReal,{recursive:true,force:true})
    return true
  }catch(error){
    if(error&&typeof error==='object'&&'code'in error&&(error as NodeJS.ErrnoException).code==='ENOENT')return false
    throw error
  }
}
export async function recordStagedArtifact(pool: Pick<Pool, 'connect'>, artifact: InstalledArtifact, manifest?: unknown) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':install',0))", [artifact.pluginId])
    await client.query(`INSERT INTO t_platform_plugin_install_attempt(plugin_id,package_name,version,source,integrity_sha512,install_path,manifest_json,status,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'staged',now()) ON CONFLICT(plugin_id) DO UPDATE SET
      package_name=EXCLUDED.package_name,version=EXCLUDED.version,source=EXCLUDED.source,
      integrity_sha512=EXCLUDED.integrity_sha512,install_path=EXCLUDED.install_path,manifest_json=EXCLUDED.manifest_json,status='staged',last_error=NULL,updated_at=now()`,
    [artifact.pluginId, artifact.packageName, artifact.version, artifact.source, artifact.integritySha512, artifact.installPath, manifest ? JSON.stringify(manifest) : null])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}

export type NpmRunner = (command: string, args: string[], options: { cwd: string }) => Promise<void>
export async function installPluginDependencies(artifact: InstalledArtifact, runner: NpmRunner = async (command, args, options) => { await execFileAsync(command, args, options) }, registryToken?: string) {
  let npmConfigDir: string | undefined
  try {
    const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--save-exact', '--prefix', artifact.installPath]
    if (artifact.source === 'github-packages') {
      if (!registryToken?.trim()) throw new Error('plugin_registry_token_required')
      npmConfigDir = await mkdtemp(join(tmpdir(), 'tg-npm-auth-'))
      const npmConfig = join(npmConfigDir, 'npmrc')
      await writeFile(npmConfig, `@tgbotpress:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${registryToken.trim()}\nalways-auth=true\n`, { mode: 0o600, flag: 'wx' })
      args.push('--userconfig', npmConfig)
    } else if (artifact.source === 'npmjs') args.push('--registry=https://registry.npmjs.org')
    args.push(join(artifact.installPath, 'package.tgz'))
    await runner('npm', args, { cwd: artifact.installPath })
    return artifact.installPath
  } finally {
    if (npmConfigDir) await rm(npmConfigDir, { recursive: true, force: true })
  }
}
