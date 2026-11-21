import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncEnergyOrder } from './energy-order-worker.server'

test('energyOrder does no work while the development gate is closed', async () => {
  const result = await syncEnergyOrder({ enabled:false, pool:{
    query:async()=>{ throw new Error('unexpected query') },
    connect:async()=>{ throw new Error('unexpected connect') },
  } as never })
  assert.deepEqual(result,{skipped:true,scanned:0,succeeded:0,failed:0})
})

test('USDT bishu purchase credits integer quantities and commits the trade atomically', async () => {
  const statements:string[]=[]
  let completionParams:unknown[]|undefined
  let claimed=false
  const client={
    query:async(sql:string, params?:unknown[])=>{
      statements.push(sql)
      if(sql.includes("process_status=9")) completionParams=params
      if(sql==='SELECT 1') return {rows:[],rowCount:0}
      if(sql.includes('SELECT a.rid,a.transferfrom_address')) {
        if(claimed) return {rows:[],rowCount:0}
        claimed=true
        return {rows:[{rid:51,transferfrom_address:'wallet-sample',amount:'2.79',bot_rid:7,energy_platform_bot_rid:42,per_bishu_usdt_price:'0.50',bishu_stop_day:5}],rowCount:1}
      }
      if(sql.includes('floor($1::numeric')) return {rows:[{quantity:'5'}],rowCount:1}
      if(sql.includes('FROM t_energy_ai_bishu WHERE wallet_addr')) return {rows:[],rowCount:0}
      return {rows:[],rowCount:1}
    },
    release() {},
  }
  const result=await syncEnergyOrder({enabled:true,batchSize:2,logger:{error(){}},pool:{query:async()=>({rows:[],rowCount:0}),connect:async()=>client} as never})
  assert.deepEqual(result,{skipped:false,scanned:1,succeeded:1,failed:0})
  assert.ok(statements[0]==='BEGIN')
  assert.ok(statements.some(sql=>sql.startsWith('INSERT INTO t_energy_ai_bishu')))
  assert.ok(statements.some(sql=>sql.includes('process_status=9')))
  assert.deepEqual(completionParams,[51,5,42])
  assert.equal(statements.at(-1),'ROLLBACK')
  assert.ok(statements.includes('COMMIT'))
})
