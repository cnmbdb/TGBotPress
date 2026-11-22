import { sqlitePlaceholders } from './sqlite.server'
import type { DatabaseClient, DatabaseConnection, DatabaseResult, DatabaseRow } from '../database.types'

export type D1Result<Row=DatabaseRow>={results?:Row[];success:boolean;meta?:{changes?:number;last_row_id?:number}}
export interface D1Statement { bind(...values:unknown[]):D1Statement; all<Row=DatabaseRow>():Promise<D1Result<Row>>; run():Promise<D1Result> }
export interface D1Binding { prepare(sql:string):D1Statement; batch(statements:D1Statement[]):Promise<D1Result[]> }

export class D1Database implements DatabaseConnection {
  readonly dialect='d1' as const
  constructor(private readonly binding:D1Binding){}
  async query<Row extends DatabaseRow=DatabaseRow>(sql:string,values:any[]=[]):Promise<DatabaseResult<Row>>{
    const bound=sqlitePlaceholders(sql,values),statement=this.binding.prepare(bound.sql).bind(...bound.values),result=await statement.all<Row>()
    if(!result.success)throw new Error('d1_query_failed')
    const rows=result.results??[]
    return {rows,rowCount:result.meta?.changes??rows.length}
  }
  async batch<Row extends DatabaseRow=DatabaseRow>(queries:Array<{sql:string;values?:unknown[]}>):Promise<Array<DatabaseResult<Row>>>{
    const statements=queries.map(query=>{const bound=sqlitePlaceholders(query.sql,query.values??[]);return this.binding.prepare(bound.sql).bind(...bound.values)})
    const results=await this.binding.batch(statements)
    return results.map(result=>{if(!result.success)throw new Error('d1_batch_failed');const rows=(result.results??[]) as Row[];return{rows,rowCount:result.meta?.changes??rows.length}})
  }
  async connect():Promise<DatabaseClient>{return new D1Client(this)}
  async end(){}
}
class D1Client implements DatabaseClient {
  constructor(private readonly database:D1Database){}
  query<Row extends DatabaseRow=DatabaseRow>(sql:string,values:any[]=[]){return this.database.query<Row>(sql,values)}
  release(){}
}
