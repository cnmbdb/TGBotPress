export type PluginMigrationDirectory = { name: string; directory: URL; files: string[] }
export declare function discoverPluginMigrationDirectories(): Promise<PluginMigrationDirectory[]>
