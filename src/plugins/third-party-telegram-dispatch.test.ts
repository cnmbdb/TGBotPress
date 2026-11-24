import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deactivateInstalledPlugin } from './plugin-runtime.server'
import { dispatchThirdPartyTelegramUpdate } from './third-party-runtime.server'

const baseManifest = {
  schemaVersion: 1,
  name: 'Fixture plugin',
  version: '1.0.0',
  apiVersion: 1,
  hostRange: '>=1.0.0 <2.0.0',
  sdkRange: '^0.1.0',
  runtime: { node: '>=22' },
  entry: './dist/index.js',
  permissions: ['telegram.updates.read'],
  telegramUpdateTypes: ['message'],
}

async function installFixture(root: string, id: string, code: string) {
  const packageName = `@example/${id.replaceAll('.', '-')}`
  const packageRoot = join(root, 'node_modules', ...packageName.split('/'))
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  const manifest = { ...baseManifest, id }
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', tgbotpressPlugin: manifest }))
  await writeFile(join(packageRoot, 'tgbotpress.plugin.json'), JSON.stringify(manifest))
  await writeFile(join(packageRoot, 'dist', 'index.js'), `export const manifest = ${JSON.stringify(manifest)}; export const plugin = { manifest, activate(host) { host.onTelegramUpdate(${code}) } }`)
  return { plugin_id: id, package_name: packageName, version: '1.0.0', install_path: root, state: 'active' as const }
}

test('Telegram dispatch isolates plugin errors and does not repeat successful plugin delivery on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tgbotpress-plugin-events-'))
  const failing = await installFixture(root, 'example.failing', 'async () => { globalThis.__tpFailingCalls = (globalThis.__tpFailingCalls || 0) + 1; throw new Error("expected fixture failure") }')
  const healthyRoot = await mkdtemp(join(tmpdir(), 'tgbotpress-plugin-events-'))
  const healthy = await installFixture(healthyRoot, 'example.healthy', 'async () => { globalThis.__tpHealthyCalls = (globalThis.__tpHealthyCalls || 0) + 1; return true }')
  const deliveries = new Map<string, { status: string; leaseUntil: number }>()
  const installs = [failing, healthy]
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('FROM t_platform_plugin_install i JOIN t_platform_plugin_lifecycle')) return { rows: installs.filter(item => (values[0] as string[]).includes(item.state)), rowCount: installs.length }
      if (sql.includes('FROM t_platform_plugin_instance') && sql.includes('WHERE plugin_id=$1 AND bot_id=$2')) { const row=installs.find(item=>item.plugin_id===values[0]); return { rows: row?[{plugin_id:row.plugin_id}]:[], rowCount: row?1:0 } }
      if (sql.includes('FROM t_platform_plugin_instance') && sql.includes("state='active'")) return { rows: installs.map(item=>({plugin_id:item.plugin_id})), rowCount: installs.length }
      if (sql.includes('INSERT INTO t_platform_plugin_event_delivery')) {
        const key = `${values[0]}:${values[1]}:${values[2]}`
        const previous = deliveries.get(key)
        if (previous?.status === 'succeeded' || (previous?.status === 'processing' && previous.leaseUntil > Date.now())) return { rows: [], rowCount: 0 }
        deliveries.set(key, { status: 'processing', leaseUntil: Date.now() + 180_000 })
        return { rows: [{ plugin_id: values[0] }], rowCount: 1 }
      }
      if (sql.includes('UPDATE t_platform_plugin_event_delivery SET status=\'succeeded\'')) {
        deliveries.set(`${values[0]}:${values[1]}:${values[2]}`, { status: 'succeeded', leaseUntil: 0 })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('UPDATE t_platform_plugin_event_delivery SET status=\'failed\'')) {
        deliveries.set(`${values[0]}:${values[1]}:${values[2]}`, { status: 'failed', leaseUntil: 0 })
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
    async connect() {
      return {
        async query(sql: string) {
          if (sql.includes('SELECT state FROM t_platform_plugin_lifecycle')) return { rows: [{ state: 'active' }], rowCount: 1 }
          if (sql.includes('INSERT INTO t_platform_plugin_execution')) return { rows: [{ owner: 'lease-owner' }], rowCount: 1 }
          return { rows: [], rowCount: 1 }
        },
        release() {},
      }
    },
  } as never
  const logger = { error() {} }
  try {
    const first = await dispatchThirdPartyTelegramUpdate(pool, 7, { update_id: 11, message: { text: 'hello' } }, ['message'], 11, logger)
    assert.deepEqual(first, { matched: true, handled: true, failedPlugins: ['example.failing'] })
    assert.equal((globalThis as Record<string, unknown>).__tpFailingCalls, 1)
    assert.equal((globalThis as Record<string, unknown>).__tpHealthyCalls, 1)
    const retry = await dispatchThirdPartyTelegramUpdate(pool, 7, { update_id: 11, message: { text: 'hello' } }, ['message'], 11, logger)
    assert.deepEqual(retry, { matched: true, handled: false, failedPlugins: ['example.failing'] })
    assert.equal((globalThis as Record<string, unknown>).__tpFailingCalls, 2)
    assert.equal((globalThis as Record<string, unknown>).__tpHealthyCalls, 1)
  } finally {
    await deactivateInstalledPlugin(failing.plugin_id, failing.install_path, failing.package_name)
    await deactivateInstalledPlugin(healthy.plugin_id, healthy.install_path, healthy.package_name)
    delete (globalThis as Record<string, unknown>).__tpFailingCalls
    delete (globalThis as Record<string, unknown>).__tpHealthyCalls
    await rm(root, { recursive: true, force: true })
    await rm(healthyRoot, { recursive: true, force: true })
  }
})

test('Telegram dispatcher does not load plugins for a Bot instance that is not enabled', async()=>{
  const root=await mkdtemp(join(tmpdir(),'tgbotpress-plugin-events-disabled-'))
  const plugin=await installFixture(root,'example.disabled','async () => { globalThis.__tpDisabledCalls=(globalThis.__tpDisabledCalls||0)+1; return true }')
  const pool={
    async query(sql:string,values:unknown[]=[]){
      if(sql.includes('FROM t_platform_plugin_install i JOIN t_platform_plugin_lifecycle'))return{rows:[plugin],rowCount:1}
      if(sql.includes('FROM t_platform_plugin_instance')&&sql.includes("state='active'"))return{rows:[],rowCount:0}
      return{rows:[],rowCount:0}
    },
  } as never
  try{
    const result=await dispatchThirdPartyTelegramUpdate(pool,7,{update_id:1,message:{}},['message'],1,{error(){}})
    assert.equal(result,null)
    assert.equal((globalThis as Record<string,unknown>).__tpDisabledCalls,undefined)
  }finally{
    await deactivateInstalledPlugin(plugin.plugin_id,plugin.install_path,plugin.package_name)
    delete (globalThis as Record<string,unknown>).__tpDisabledCalls
    await rm(root,{recursive:true,force:true})
  }
})
