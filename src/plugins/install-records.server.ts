import type { DatabaseConnection as Pool } from '../server/database.types'
import { pluginCatalog } from './catalog'

type InstallRecord = {
  plugin_id: string; package_name: string; version: string; source: 'builtin' | 'github-packages' | 'npmjs'
  integrity_sha512: string | null; install_path: string | null; status: 'installed' | 'staged' | 'failed' | 'removed'
  manifest_json: unknown; last_error: string | null; installed_at: Date | string | null; updated_at: Date | string
}

export function packageNameForPlugin(pluginId: string, packageName?: string) {
  if (pluginCatalog.some(plugin => plugin.id === pluginId)) return `@tgbotpress/plugin-${pluginId}`
  if (!packageName) throw new Error('plugin_package_name_required')
  return packageName
}

export async function pluginInstallRecords(pool: Pick<Pool, 'query'>) {
  const result = await pool.query<InstallRecord>(`SELECT i.plugin_id,i.package_name,i.version,i.source,i.integrity_sha512,i.install_path,i.status,i.manifest_json,
    COALESCE(a.last_error,i.last_error) AS last_error,i.installed_at,i.updated_at
    FROM t_platform_plugin_install i LEFT JOIN t_platform_plugin_install_attempt a ON a.plugin_id=i.plugin_id AND a.status='failed'
    ORDER BY i.plugin_id`)
  return result.rows
}

export async function recordBuiltinPluginInstall(pool: Pick<Pool, 'query'>, pluginId: string, version: string) {
  const packageName = packageNameForPlugin(pluginId)
  await pool.query(`INSERT INTO t_platform_plugin_install(plugin_id,package_name,version,source,status,installed_at,updated_at)
    VALUES($1,$2,$3,'builtin','installed',now(),now())
    ON CONFLICT(plugin_id) DO UPDATE SET package_name=EXCLUDED.package_name,version=EXCLUDED.version,source='builtin',status='installed',last_error=NULL,installed_at=COALESCE(t_platform_plugin_install.installed_at,now()),updated_at=now()`, [pluginId, packageName, version])
}

export async function recordPluginInstallFailure(pool: Pick<Pool, 'query'>, pluginId: string, packageName: string, version: string, error: unknown, source: 'github-packages' | 'npmjs' = 'github-packages') {
  const message = String(error instanceof Error ? error.message : error).slice(0, 500)
  await pool.query(`INSERT INTO t_platform_plugin_install_attempt(plugin_id,package_name,version,source,status,last_error,updated_at)
    VALUES($1,$2,$3,$5,'failed',$4,now())
    ON CONFLICT(plugin_id) DO UPDATE SET package_name=EXCLUDED.package_name,version=EXCLUDED.version,source=EXCLUDED.source,status='failed',last_error=EXCLUDED.last_error,updated_at=now()`, [pluginId, packageName, version, message, source])
}
