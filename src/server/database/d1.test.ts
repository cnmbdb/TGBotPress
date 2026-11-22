import test from 'node:test'
import assert from 'node:assert/strict'
import { D1Database, type D1Binding, type D1Result, type D1Statement } from './d1.server'

test('D1 adapter binds parameters and maps rows and change metadata', async()=>{
  const calls:Array<{sql:string;values:unknown[]}> = []
  const binding:D1Binding={prepare(sql:string){return {bind(...values:unknown[]){calls.push({sql,values});return this},async all(){return{success:true,results:[{value:7}],meta:{changes:1}}},async run(){return{success:true,meta:{changes:1}}}} as D1Statement},async batch(){return[{success:true,meta:{changes:2}},{success:true,results:[{value:9}],meta:{changes:1}}] as D1Result[]}}
  const db=new D1Database(binding)
  assert.deepEqual(await db.query('SELECT $1::int AS value',[7]),{rows:[{value:7}],rowCount:1})
  assert.deepEqual(calls[0],{sql:'SELECT ? AS value',values:[7]})
  assert.deepEqual(await db.batch([{sql:'UPDATE x SET value=$1',values:[8]},{sql:'SELECT $1 AS value',values:[9]}]),[{rows:[],rowCount:2},{rows:[{value:9}],rowCount:1}])
  assert.equal(calls[1].sql,'UPDATE x SET value=?')
})
