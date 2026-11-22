import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseClient, DatabaseConnection, DatabaseResult, DatabaseRow } from '../database.types'

export function sqlitePlaceholders(sql:string,values:unknown[]=[]):{sql:string;values:unknown[]} {
  const mapped:unknown[]=[]
  const arrayParameters=new Set<number>()
  sql=sql.replace(/([\w.`]+)\s*=\s*ANY\(\$(\d+)(?:::\w+\[\])?\)/gi,(_m,col,pos)=>{arrayParameters.add(Number(pos)-1);return `${col} IN (SELECT value FROM json_each($${pos}))`})
  let out='',mode:'normal'|'single'|'double'|'backtick'|'line'|'block'='normal'
  for(let i=0;i<sql.length;i++){
    const c=sql[i],n=sql[i+1]
    if(mode==='single'||mode==='double'||mode==='backtick'){
      out+=c;const end=mode==='single'?"'":mode==='double'?'"':'`'
      if(c==='\\'&&i+1<sql.length)out+=sql[++i]
      else if(c===end){if(n===end)out+=sql[++i];else mode='normal'}
      continue
    }
    if(mode==='line'){out+=c;if(c==='\n')mode='normal';continue}
    if(mode==='block'){out+=c;if(c==='*'&&n==='/'){out+=sql[++i];mode='normal'}continue}
    if(c==="'"){mode='single';out+=c;continue}if(c==='"'){mode='double';out+=c;continue}if(c==='`'){mode='backtick';out+=c;continue}
    if(c==='-'&&n==='-'){mode='line';out+=c+n;i++;continue}if(c==='/'&&n==='*'){mode='block';out+=c+n;i++;continue}
    if(c===':'&&n===':'){let j=i+2;while(/[a-z0-9_]/i.test(sql[j]||''))j++;if(sql[j]==='('){while(j<sql.length&&sql[j]!==')')j++;if(sql[j]===')')j++}if(sql[j]==='['&&sql[j+1]===']')j+=2;if(j>i+2){i=j-1;continue}}
    if(c==='$'&&/[1-9]/.test(n||'')){let j=i+1;while(/[0-9]/.test(sql[j]||''))j++;const pos=Number(sql.slice(i+1,j))-1;if(pos>=values.length)throw Error(`sqlite_parameter_missing:${pos+1}`);out+='?';mapped.push(arrayParameters.has(pos)?JSON.stringify(values[pos]):values[pos]);i=j-1;continue}
    out+=c
  }
  const used=[...out.matchAll(/\?/g)].length
  if(used!==mapped.length)throw Error(`sqlite_parameter_count_mismatch:${used}:${mapped.length}`)
  out=out.replace(/datetime\((\?)\)/gi, "datetime($1,'unixepoch')")
  out=out.replace(/enabled_bot_ids\s*=\s*'\{\}'/gi,"enabled_bot_ids='[]'")
    .replace(/\bILIKE\b/gi,'LIKE').replace(/\bto_timestamp\(/gi,"datetime(").replace(/\bnow\(\)/gi,"(strftime('%Y-%m-%d %H:%M:%f','now'))")
  return {sql:out,values:mapped}
}

function open(path:string){const connection=new DatabaseSync(path);connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');return connection}
class SqliteClient implements DatabaseClient{
  constructor(private readonly connection:DatabaseSync){}
  async query<Row extends DatabaseRow=DatabaseRow>(sql:string,values:any[]=[]):Promise<DatabaseResult<Row>>{
    const bound=sqlitePlaceholders(sql,values),statement=this.connection.prepare(bound.sql)
    if(statement.columns().length){const raw=statement.all(...bound.values as any[]) as Row[];const rows=raw.map(row=>Object.assign({},row) as Row);return{rows,rowCount:rows.length}}
    const result=statement.run(...bound.values as any[]);return{rows:[],rowCount:Number(result.changes)}
  }
  release(){this.connection.close()}
}
export class SqliteDatabase implements DatabaseConnection{
  readonly dialect='sqlite' as const
  private constructor(private readonly path:string){}
  static connect(path:string){const file=resolve(path);mkdirSync(dirname(file),{recursive:true});const connection=new SqliteDatabase(file);const test=open(file);test.close();return connection}
  async query<Row extends DatabaseRow=DatabaseRow>(sql:string,values:any[]=[]):Promise<DatabaseResult<Row>>{const client=new SqliteClient(open(this.path));try{return await client.query<Row>(sql,values)}finally{client.release()}}
  async connect():Promise<DatabaseClient>{return new SqliteClient(open(this.path))}
  async end(){}
}
