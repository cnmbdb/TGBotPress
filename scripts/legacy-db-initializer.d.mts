export interface InitializerPool {
  connect(): Promise<{
    query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
    release(): void
  }>
}

export interface InitializeOptions {
  initialPassword?: string
}

export function initializeEmptyLegacyDatabase(
  pool: InitializerPool,
  options?: InitializeOptions,
): Promise<{ initialized: false; reason: 'existing-schema' | 'concurrent-initialization' } | { initialized: true; templatesImported: boolean }>

export function ensureEmptyTemplateTablesSeeded(pool: InitializerPool): Promise<boolean>
