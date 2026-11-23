export type PluginLifecycleState = 'active' | 'draining' | 'uninstalled'
export type PluginLifecycleAction = 'install' | 'disable' | 'resume' | 'uninstall'
export type PluginManifest = {
  id: string
  version: string
  hostRange: string
  sdkVersion: string
  name: string
  description?: string
  dependencies?: string[]
  menuRoutes?: string[]
  apiRoutes?: string[]
  tasks?: string[]
  drainTasks?: string[]
  configTypes?: Array<'command' | 'keyboard' | 'keyreply' | 'keyreply_keyboard'>
}
export type PluginHost = {
  manifest: PluginManifest
  state: () => Promise<PluginLifecycleState>
  transition: (action: PluginLifecycleAction) => Promise<PluginLifecycleState>
  log: { info: (...values: unknown[]) => void; error: (...values: unknown[]) => void }
}
export type TgbotpressPlugin = {
  manifest: PluginManifest
  activate?: (host: PluginHost) => Promise<void> | void
  deactivate?: (host: PluginHost) => Promise<void> | void
}
export type DatabaseResult<Row = any> = { rows: Row[]; rowCount: number | null }
export interface DatabaseQueryable { query<Row = any>(sql: string, values?: any[]): Promise<DatabaseResult<Row>> }
export interface DatabaseClient extends DatabaseQueryable { release(): void }
export interface DatabaseConnection extends DatabaseQueryable { connect(): Promise<DatabaseClient>; end(): Promise<void> }
