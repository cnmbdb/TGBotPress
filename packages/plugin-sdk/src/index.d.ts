export declare const PLUGIN_SDK_VERSION: '0.1.0'

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

export type DatabaseRow = any
export type DatabaseResult<Row = any> = { rows: Row[]; rowCount: number | null }
export interface DatabaseQueryable { query<Row = any>(sql: string, values?: any[]): Promise<DatabaseResult<Row>> }
export interface DatabaseClient extends DatabaseQueryable { release(): void }
export interface DatabaseConnection extends DatabaseQueryable { connect(): Promise<DatabaseClient>; end(): Promise<void> }

/** Third-party plugin contract v1. Plugin IDs and route names are scoped by the host. */
export type ThirdPartyPluginManifest = {
  schemaVersion: 1
  id: string
  name: string
  version: string
  apiVersion: 1
  hostRange: string
  sdkRange: string
  runtime: { node: string }
  entry: string
  description?: string
  author?: string
  license?: string
  permissions: ThirdPartyPluginPermission[]
  telegramUpdateTypes?: string[]
  dependencies?: Record<string, string>
  contributes?: { commands?: Array<{ name: string; description: string }>; events?: string[]; admin?: Record<string, unknown> }
}
export type ThirdPartyPluginPermission = 'http' | 'telegram' | 'tasks' | 'storage' | 'admin.api' | 'admin.menu' | 'plugin.storage.read' | 'plugin.storage.write' | 'plugin.jobs.register' | 'telegram.updates.read' | 'telegram.commands.register' | 'telegram.api.call' | 'telegram.messages.send' | 'telegram.messages.edit' | 'telegram.messages.delete' | 'telegram.members.read' | 'telegram.members.manage' | 'external.http'
export type ThirdPartyPluginStorage = {
  get: (key: string) => Promise<unknown | null>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  forBot: (botId: number) => Omit<ThirdPartyPluginStorage, 'forBot'>
}
export type PluginRequestContext = { request: Request; pluginId: string; user: { id: string; roles: string[] } }
export type PluginRoute = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; handler: (context: PluginRequestContext) => Promise<Response> | Response }
export type PluginTask = { id: string; intervalMs: number; drain?: boolean; run: (context: { shouldContinue: () => boolean; botId: number }) => Promise<unknown> | unknown }
export type PluginCommandContext = PluginTelegramUpdate & { command: string; args: string[] }
export type PluginCommand = { name: string; description: string; handler: (context: PluginCommandContext) => Promise<boolean | void> | boolean | void }
export type RegisteredPluginCommand = { name: string; description: string; handler: (context: Omit<PluginCommandContext, 'telegram'|'storage'>) => Promise<boolean | void> | boolean | void }
export type PluginTelegramApi = { call: (botId: number, method: string, payload?: Record<string, unknown>) => Promise<unknown> }
export type PluginTelegramUpdate = { botId: number; update: Record<string, unknown>; storage?: Omit<ThirdPartyPluginStorage, 'forBot'>; telegram: { call: (method: string, payload?: Record<string, unknown>) => Promise<unknown> } }
export type RegisteredPluginTelegramHandler = (update: Omit<PluginTelegramUpdate, 'telegram'>) => Promise<boolean | void> | boolean | void
export type ThirdPartyPluginHost = {
  log: { info: (...values: unknown[]) => void; error: (...values: unknown[]) => void }
  storage: ThirdPartyPluginStorage
  telegram: PluginTelegramApi
  registerRoute: (route: PluginRoute) => void
  registerTask: (task: PluginTask) => void
  registerCommand: (command: PluginCommand) => void
  /** Return true when the update was handled. Returning false or void lets the next matching plugin inspect it. */
  onTelegramUpdate: (handler: (update: PluginTelegramUpdate) => Promise<boolean | void> | boolean | void) => void
}
export type ThirdPartyPlugin = {
  manifest: ThirdPartyPluginManifest
  activate: (host: ThirdPartyPluginHost) => Promise<void> | void
  deactivate?: () => Promise<void> | void
}
export declare function validateThirdPartyPlugin(plugin: unknown): ThirdPartyPlugin
export declare function validateThirdPartyManifest(manifest: unknown): ThirdPartyPluginManifest
export declare function collectThirdPartyRegistrations(plugin: ThirdPartyPlugin, options?: { log?: Pick<Console, 'info' | 'error'>; storage?: ThirdPartyPluginStorage; telegram?: PluginTelegramApi }): Promise<{ routes: PluginRoute[]; tasks: PluginTask[]; commands: RegisteredPluginCommand[]; telegramHandlers: RegisteredPluginTelegramHandler[] }>
