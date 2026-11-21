import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'
import { parseTronGridAccountResource, refreshAiEnergyWalletResources } from './ai-energy-wallet-resource.server'
import { platformScheduledTasks } from './platform-worker.server'

test('parses TronGrid resource balances and rejects incomplete responses',()=>{
 assert.deepEqual(parseTronGridAccountResource({freeNetLimit:10000,NetLimit:3000,NetUsed:500,EnergyLimit:131000,EnergyUsed:701}),{bandwidth:12500,energy:130299})
 assert.equal(parseTronGridAccountResource({EnergyLimit:10}),null)
})
test('resource polling is off unless explicitly enabled',async()=>{
 let queries=0
 const pool={query:async()=>{queries++;return{rows:[],rowCount:0}}} as unknown as Pool
 const fetcher=async()=>{throw new Error('unexpected provider call')}
 assert.deepEqual(await refreshAiEnergyWalletResources({pool,fetcher}),{checked:0,updated:0,failed:0,skipped:0})
 assert.equal(queries,0)
})
test('refreshes both wallet types, uses TronGrid fallback and gates purchase triggers',async()=>{
 const sql:string[]=[],writes:Array<{query:string;values:unknown[]}>=[]
 const pool={query:async(query:string,values?:unknown[])=>{
  sql.push(query)
  if(query.includes('FROM t_energy_ai_trusteeship')) return {rows:[{kind:'trusteeship',rid:1,wallet_addr:'TTrusteeshipAddress00000000000000001',target_energy:50000}],rowCount:1}
  if(query.includes('FROM t_energy_ai_bishu')) return {rows:[{kind:'bishu',rid:2,wallet_addr:'TBishuAddress00000000000000000000001',target_energy:131000}],rowCount:1}
  writes.push({query,values:values||[]});return{rows:[],rowCount:1}
 }} as unknown as Pool
 const calls:string[]=[]
 const fetcher=async(input:string|URL|Request)=>{
  const url=input instanceof Request?input.url:input.toString();calls.push(url)
  if(url.startsWith('https://api.trongrid.io/')) return Response.json({freeNetLimit:10,NetLimit:5,NetUsed:2,EnergyLimit:131000,EnergyUsed:701})
  if(url.includes('TTrusteeshipAddress')) return Response.json({activated:true,bandwidth:{freeNetRemaining:20,netRemaining:30,energyRemaining:49899}})
  return Response.json({activated:false})
 }
 const result=await refreshAiEnergyWalletResources({pool,enabled:true,allowPurchaseTrigger:true,delayMs:0,fetcher})
 assert.deepEqual(result,{checked:2,updated:2,failed:0,skipped:0})
 assert.equal(calls.length,3)
 assert.ok(sql[0].includes("d.cash_trx>c.trx_price_energy_32000"))
 assert.ok(sql[1].includes("c.per_bishu_energy_quantity target_energy"))
 assert.equal(writes.length,2)
 assert.equal(writes[0].values[4],true);assert.equal(writes[1].values[4],true)
 assert.deepEqual(writes.map(w=>w.values[2]).sort((a,b)=>Number(a)-Number(b)),[49899,130299])
})
test('provider failures never update resource fields',async()=>{
 let writes=0
 const pool={query:async(query:string)=>{
  if(query.includes('FROM t_energy_ai_trusteeship')) return{rows:[{kind:'trusteeship',rid:1,wallet_addr:'TTrusteeshipAddress00000000000000001',target_energy:50000}],rowCount:1}
  if(query.includes('FROM t_energy_ai_bishu')) return{rows:[],rowCount:0}
  writes++;return{rows:[],rowCount:1}
 }} as unknown as Pool
 const result=await refreshAiEnergyWalletResources({pool,enabled:true,delayMs:0,fetcher:async()=>new Response(null,{status:429}),logger:{error(){}}})
 assert.deepEqual(result,{checked:1,updated:0,failed:1,skipped:0});assert.equal(writes,0)
})
test('worker registers the legacy 3s task and disables both resource polls by default',async()=>{
 const previous=process.env.PLATFORM_RESOURCE_MONITORING;delete process.env.PLATFORM_RESOURCE_MONITORING
 let queries=0
 const pool={query:async()=>{queries++;return{rows:[],rowCount:0}},connect:async()=>{throw new Error('unused')}} as unknown as Pool
 try{
  const tasks=platformScheduledTasks(pool)
  const energy=tasks.filter(t=>t.name==='getaienergywalletresource'),trust=tasks.filter(t=>t.name==='getaitrusteeshipwalletresource')
  assert.equal(energy.length,1);assert.equal(energy[0].intervalMs,3000)
  assert.equal(trust.length,1);assert.equal(trust[0].intervalMs,5000)
  await energy[0].run(()=>true);await trust[0].run(()=>true);assert.equal(queries,0)
 }finally{if(previous===undefined)delete process.env.PLATFORM_RESOURCE_MONITORING;else process.env.PLATFORM_RESOURCE_MONITORING=previous}
})
