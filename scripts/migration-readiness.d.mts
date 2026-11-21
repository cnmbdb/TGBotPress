export interface LegacySchemaDatabase {
  query(sql: string, values: [string[]]): Promise<{ rows: Array<{ name: string; present: boolean }> }>
}

export interface LegacySchemaWaitOptions {
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export function waitForLegacySchema(database: LegacySchemaDatabase, options?: LegacySchemaWaitOptions): Promise<void>
