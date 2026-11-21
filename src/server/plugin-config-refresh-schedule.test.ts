import assert from 'node:assert/strict'
import { test } from 'node:test'
import { platformScheduledTasks } from './platform-worker.server'

test('plugin configuration refresh runs from the shared worker and is gated by Telegram actions',async()=>{
 const pool={connect:async()=>{throw new Error('disabled task must not connect')},query:async()=>{throw new Error('disabled task must not query')}} as never
 const previous=process.env.PLATFORM_TELEGRAM_ACTIONS
 delete process.env.PLATFORM_TELEGRAM_ACTIONS
 try{
  const task=platformScheduledTasks(pool).find(item=>item.name==='pluginconfigrefresh')
  assert.ok(task)
  assert.equal(task.intervalMs,5_000)
  assert.deepEqual(await task.run(()=>true),{skipped:true,processed:0,failed:0})
 }finally{if(previous!==undefined)process.env.PLATFORM_TELEGRAM_ACTIONS=previous}
})
