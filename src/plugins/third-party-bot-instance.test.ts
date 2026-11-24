import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setThirdPartyPluginBotEnabled } from './third-party-runtime.server'

test('third-party plugin enablement is stored independently for each Bot', async () => {
  const rows=new Map<string,string>()
  const pool={
    async query(){return{rows:[],rowCount:1}},
    async connect(){return{
      async query(sql:string,values:unknown[]=[]){
        if(sql.includes('SELECT l.state,i.manifest_json FROM t_platform_plugin_lifecycle'))return{rows:[{state:'active',manifest_json:null}],rowCount:1}
        if(sql.includes('SELECT rid FROM t_telegram_bot'))return{rows:[{rid:values[0]}],rowCount:1}
        if(sql.includes('INSERT INTO t_platform_plugin_instance')){rows.set(`${values[0]}:${values[1]}`,String(values[2]));return{rows:[],rowCount:1}}
        return{rows:[],rowCount:1}
      },
      release(){},
    }},
  } as never
  assert.deepEqual(await setThirdPartyPluginBotEnabled(pool,'example.welcome',7,true),{pluginId:'example.welcome',botId:7,enabled:true})
  assert.deepEqual(await setThirdPartyPluginBotEnabled(pool,'example.welcome',9,false),{pluginId:'example.welcome',botId:9,enabled:false})
  assert.equal(rows.get('example.welcome:7'),'active')
  assert.equal(rows.get('example.welcome:9'),'disabled')
})
