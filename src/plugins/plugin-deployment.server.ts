import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '../server/database.types'
import { packageNameForPlugin } from './install-records.server'

type Db = Pick<Pool, 'query' | 'connect'>
type HealthCheck = () => Promise<boolean>

export async function promoteStagedPlugin(pool: Db, pluginId: string, version: string, healthCheck: HealthCheck, expected?: { installPath: string; integritySha512: string; packageName?: string }) {
  const packageName = packageNameForPlugin(pluginId, expected?.packageName)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':install',0))", [pluginId])
    const staged = await client.query<{ install_path: string | null; integrity_sha512: string | null; manifest_json: unknown; status: string }>("SELECT install_path,integrity_sha512,manifest_json,status FROM t_platform_plugin_install_attempt WHERE plugin_id=$1 AND package_name=$2 AND version=$3 FOR UPDATE", [pluginId, packageName, version])
    if (staged.rows[0]?.status !== 'staged' || !staged.rows[0].install_path) throw new Error('plugin_stage_not_found')
    if (expected && (staged.rows[0].install_path !== expected.installPath || staged.rows[0].integrity_sha512 !== expected.integritySha512)) throw new Error('plugin_stage_changed')
    await client.query('COMMIT')
    if (!(await healthCheck())) throw new Error('plugin_health_check_failed')
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':install',0))", [pluginId])
    const promoted = await client.query("UPDATE t_platform_plugin_install_attempt SET status='installed',last_error=NULL,updated_at=now() WHERE plugin_id=$1 AND package_name=$2 AND version=$3 AND status='staged' AND ($4::text IS NULL OR install_path=$4) AND ($5::text IS NULL OR integrity_sha512=$5)", [pluginId, packageName, version, expected?.installPath ?? null, expected?.integritySha512 ?? null])
    if (promoted.rowCount !== 1) throw new Error('plugin_stage_changed')
    await client.query(`INSERT INTO t_platform_plugin_install_history(plugin_id,package_name,version,source,integrity_sha512,install_path)
      SELECT plugin_id,package_name,version,source,integrity_sha512,install_path FROM t_platform_plugin_install WHERE plugin_id=$1 AND status='installed'`, [pluginId])
    await client.query(`INSERT INTO t_platform_plugin_install(plugin_id,package_name,version,source,integrity_sha512,install_path,manifest_json,status,installed_at,updated_at)
      SELECT plugin_id,package_name,version,source,integrity_sha512,install_path,manifest_json,'installed',now(),now() FROM t_platform_plugin_install_attempt WHERE plugin_id=$1 AND version=$2
      ON CONFLICT(plugin_id) DO UPDATE SET package_name=EXCLUDED.package_name,version=EXCLUDED.version,source=EXCLUDED.source,integrity_sha512=EXCLUDED.integrity_sha512,install_path=EXCLUDED.install_path,manifest_json=EXCLUDED.manifest_json,status='installed',last_error=NULL,installed_at=now(),updated_at=now()`, [pluginId, version])
    await client.query('COMMIT')
    return { pluginId, version, status: 'installed' as const }
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}

export async function rollbackPluginInstall(pool: Db, pluginId: string, packageNameInput?: string) {
  const packageName = packageNameForPlugin(pluginId, packageNameInput), client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':install',0))", [pluginId])
    const previous = await client.query<{package_name:string;version:string;source:string;integrity_sha512:string|null;install_path:string|null}>(`SELECT package_name,version,source,integrity_sha512,install_path FROM t_platform_plugin_install_history WHERE plugin_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [pluginId])
    if (!previous.rows[0]) {
      await client.query("UPDATE t_platform_plugin_install SET status='removed',install_path=NULL,last_error='plugin_install_rollback',updated_at=now() WHERE plugin_id=$1 AND package_name=$2 AND source<>'builtin'", [pluginId, packageName])
      await client.query("UPDATE t_platform_plugin_lifecycle SET state='uninstalled',disabled_at=COALESCE(disabled_at,now()),updated_at=now() WHERE plugin_id=$1", [pluginId])
      await client.query('COMMIT')
      return { pluginId, version: null, status: 'removed' as const }
    }
    if (previous.rows[0].package_name !== packageName) throw new Error('plugin_rollback_unavailable')
    await client.query(`INSERT INTO t_platform_plugin_install_history(plugin_id,package_name,version,source,integrity_sha512,install_path)
      SELECT plugin_id,package_name,version,source,integrity_sha512,install_path FROM t_platform_plugin_install WHERE plugin_id=$1 AND status='installed'`, [pluginId])
    await client.query(`UPDATE t_platform_plugin_install SET package_name=$2,version=$3,source=$4,integrity_sha512=$5,install_path=$6,status='installed',installed_at=now(),last_error=NULL,updated_at=now() WHERE plugin_id=$1`, [pluginId, previous.rows[0].package_name, previous.rows[0].version, previous.rows[0].source, previous.rows[0].integrity_sha512, previous.rows[0].install_path])
    await client.query('COMMIT')
    return { pluginId, version: previous.rows[0].version, status: 'installed' as const }
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}

import { installPluginDependencies, recordStagedArtifact, stagePluginArtifact, type NpmRunner, type PluginArtifact } from './package-installer.server'

export async function installAndPromotePlugin(options: { pool: Db; artifact: PluginArtifact; root: string; npmRunner?: NpmRunner; registryToken?: string; healthCheck: HealthCheck }) {
  const staged = await stagePluginArtifact(options.artifact, options.root)
  await installPluginDependencies(staged, options.npmRunner, options.registryToken)
  await recordStagedArtifact(options.pool, staged)
  return promoteStagedPlugin(options.pool, staged.pluginId, staged.version, options.healthCheck, { installPath: staged.installPath, integritySha512: staged.integritySha512 })
}
