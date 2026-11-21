import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncPluginConfigRefresh } from './plugin-config-refresh.server'

test('plugin config refresh remains gated when Telegram actions are disabled',async()=>{
 let touched=false
 const pool={connect:async()=>{touched=true;throw new Error('unexpected connection')},query:async()=>{touched=true;throw new Error('unexpected query')}} as never
 assert.deepEqual(await syncPluginConfigRefresh({pool,enabled:false}),{skipped:true,processed:0,failed:0})
 assert.equal(touched,false)
})

test('plugin config refresh pushes effective command scopes and invalidates the bot cache',async()=>{
 const updates:string[]=[];const telegramCalls:unknown[]=[];const invalidated:number[]=[]
 const client={query:async(sql:string)=>{if(sql.includes('WITH picked AS'))return{rows:[{bot_rid:9,attempts:1}],rowCount:1};updates.push(sql);return{rows:[],rowCount:1}},release(){}}
 const pool={connect:async()=>client,query:async(sql:string)=>{if(sql.includes('SELECT bot_token'))return{rows:[{bot_token:'sandbox-token'}],rowCount:1};if(sql.includes('SELECT c.command'))return{rows:[{command:'start',description:'Start',command_type:1}],rowCount:1};updates.push(sql);return{rows:[],rowCount:1}}} as never
 const result=await syncPluginConfigRefresh({pool,enabled:true,dependencies:{telegram:async(...args)=>{telegramCalls.push(args);return{}},invalidate:async(botRid)=>{invalidated.push(botRid)}}})
 assert.deepEqual(result,{skipped:false,processed:1,failed:0})
 assert.equal(telegramCalls.length,2)
 assert.ok(updates.some(sql=>sql.includes("status='done'")))
 assert.ok(invalidated.includes(9))
})

test('plugin config refresh schedules retry after Telegram command sync fails',async()=>{
 const updates:Array<{sql:string;values?:unknown[]}>=[];const client={query:async(sql:string,values?:unknown[])=>{if(sql.includes('WITH picked AS'))return{rows:[{bot_rid:9,attempts:2}],rowCount:1};updates.push({sql,values});return{rows:[],rowCount:1}},release(){}}
 const pool={connect:async()=>client,query:async(sql:string,values?:unknown[])=>{if(sql.includes('SELECT bot_token'))return{rows:[{bot_token:'sandbox-token'}],rowCount:1};if(sql.includes('SELECT c.command'))return{rows:[{command:'start',description:'Start',command_type:1}],rowCount:1};updates.push({sql,values});return{rows:[],rowCount:1}}} as never
 const result=await syncPluginConfigRefresh({pool,enabled:true,logger:{error(){}},dependencies:{telegram:async()=>{throw new Error('simulated Telegram failure')},invalidate:async()=>{}}})
 assert.deepEqual(result,{skipped:false,processed:0,failed:1})
 assert.ok(updates.some(update=>update.sql.includes("status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END")))
})
