export type DatabaseRow = any
export interface DatabaseResult<Row extends DatabaseRow = DatabaseRow> { rows: Row[]; rowCount: number | null }
export interface DatabaseQueryable {
  query<Row extends DatabaseRow = DatabaseRow>(sql: string, values?: any[]): Promise<DatabaseResult<Row>>
}
export interface DatabaseClient extends DatabaseQueryable { release(): void }
export interface DatabaseConnection extends DatabaseQueryable {
  connect(): Promise<DatabaseClient>
  end(): Promise<void>
}
