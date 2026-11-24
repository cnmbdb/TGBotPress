import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { installRemotePlugin } from './remote-install.server'
import { dispatchThirdPartyTelegramUpdate, runThirdPartyPluginTasks, setThirdPartyPluginBotEnabled } from './third-party-runtime.server'

const execFileAsync = promisify(execFile)
const packageName = '@example/tgbotpress-plugin-sample'
const pluginId = 'sample'
const version = '1.0.0'
const metadata = {
  schemaVersion: 1 as const,
  id: pluginId,
  name: 'Sample plugin',
  version,
  apiVersion: 1 as const,
  hostRange: '>=1.0.0 <2.0.0',
  sdkRange: '^0.1.0',
  runtime: { node: '>=22' },
  entry: './dist/index.js',
  permissions: ['http', 'tasks', 'telegram.updates.read', 'telegram.commands.register', 'telegram.messages.send', 'storage'],
  telegramUpdateTypes: ['message'],
  contributes: { commands: [{ name: 'hello', description: 'Say hello' }] },
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tgbotpress-npm-runtime-'))
  const source = join(root, 'package-source')
  const packageDir = join(source, 'package')
  await mkdir(join(packageDir, 'dist'), { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version, type: 'module', tgbotpressPlugin: metadata }))
  await writeFile(join(packageDir, 'tgbotpress.plugin.json'), JSON.stringify(metadata))
  await writeFile(join(packageDir, 'dist', 'index.js'), `
export const plugin = {
  manifest: ${JSON.stringify(metadata)},
  activate(host) {
    host.registerRoute({ method: 'GET', path: '/health', handler: () => Response.json({ plugin: 'sample' }) })
    host.registerTask({ id: 'tick', intervalMs: 1000, run: async ({ botId }) => host.storage.forBot(botId).set('ticks', botId) })
    host.registerCommand({ name: 'hello', description: 'Say hello', handler: async ({ args }) => { globalThis.__tgbotpressSampleCommandArgs = args; return true } })
    host.onTelegramUpdate(async ({ update }) => update.message?.text === 'handled')
  },
  deactivate() { globalThis.__tgbotpressSampleDeactivated = true },
}
`)
  const tarball = join(root, 'fixture.tgz')
  await execFileAsync('tar', ['-czf', tarball, '-C', source, 'package'])
  const { readFile } = await import('node:fs/promises')
  const bytes = new Uint8Array(await readFile(tarball))
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const tarballUrl = 'https://registry.npmjs.org/@example%2ftgbotpress-plugin-sample/-/tgbotpress-plugin-sample-1.0.0.tgz'
  const fetcher = async (input: string | URL) => String(input) === tarballUrl
    ? new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    : Response.json({ name: packageName, version, tgbotpressPlugin: metadata, dist: { tarball: tarballUrl, integrity } })
  return { root, bytes, fetcher, integrity }
}

function fakePool() {
  const state: { attempt?: Record<string, any>; install?: Record<string, any>; lifecycle: string; storage: unknown; commandRegistered:boolean; deliveryStatus:string|null } = { lifecycle: 'uninstalled', storage: null, commandRegistered:false, deliveryStatus:null }
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT i.plugin_id,i.package_name,i.version,i.install_path,l.state')) return { rows: state.install&&state.lifecycle==='active'?[{...state.install,state:'active'}]:[],rowCount:state.install&&state.lifecycle==='active'?1:0 }
    if (sql.includes('SELECT b.rid::int AS bot_id')) return { rows: [{bot_id:4}],rowCount:1 }
    if (sql.includes('FROM t_platform_plugin_instance')) return { rows: [{plugin_id:pluginId}],rowCount:1 }
    if (sql.includes('SELECT plugin_id FROM t_platform_plugin_command')) return { rows: state.commandRegistered?[{plugin_id:pluginId}]:[],rowCount:state.commandRegistered?1:0 }
    if (sql.includes('FROM t_telegram_bot_command')) return { rows: [],rowCount:0 }
    if (sql.includes('INSERT INTO t_platform_plugin_event_delivery')) { if(state.deliveryStatus==='succeeded')return{rows:[],rowCount:0};state.deliveryStatus='processing';return{rows:[{plugin_id:pluginId}],rowCount:1} }
    if (sql.includes("UPDATE t_platform_plugin_event_delivery SET status='succeeded'")) { state.deliveryStatus='succeeded';return{rows:[],rowCount:1} }
    if (sql.includes("UPDATE t_platform_plugin_event_delivery SET status='failed'")) { state.deliveryStatus='failed';return{rows:[],rowCount:1} }
    if (sql.includes('INSERT INTO t_platform_plugin_task_schedule')) return { rows: [{task_id:values[1]}],rowCount:1 }
    if (sql.includes('t_platform_plugin_storage')) { state.storage = values[3] ?? null; return { rows: [], rowCount: 1 } }
    if (sql.includes('FROM t_telegram_bot')) return { rows: [{ bot_token: 'test-token' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const connect = async () => ({
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('INSERT INTO t_platform_plugin_install_attempt')) {
        state.attempt = { plugin_id: values[0], package_name: values[1], version: values[2], source: values[3], integrity_sha512: values[4], install_path: values[5], manifest_json: typeof values[6]==='string'?JSON.parse(String(values[6])):values[6], status: 'staged' }
      } else if (sql.includes('SELECT install_path,integrity_sha512,manifest_json,status FROM t_platform_plugin_install_attempt')) {
        return { rows: state.attempt ? [{ ...state.attempt }] : [], rowCount: state.attempt ? 1 : 0 }
      } else if (sql.includes("UPDATE t_platform_plugin_install_attempt SET status='installed'")) {
        if (state.attempt) state.attempt.status = 'installed'
        return { rows: [], rowCount: state.attempt ? 1 : 0 }
      } else if (sql.includes('INSERT INTO t_platform_plugin_install(plugin_id')) {
        state.install = state.attempt ? { ...state.attempt, status: 'installed' } : undefined
      } else if (sql.includes('SELECT l.state,i.manifest_json FROM t_platform_plugin_lifecycle')) {
        return { rows: state.install?[{state:state.lifecycle,manifest_json:state.install.manifest_json}]:[],rowCount:state.install?1:0 }
      } else if (sql.includes('SELECT rid FROM t_telegram_bot WHERE rid=')) {
        return { rows: [{rid:values[0]}],rowCount:1 }
      } else if (sql.includes('SELECT command FROM t_telegram_bot_command')) {
        return { rows: [],rowCount:0 }
      } else if (sql.includes('INSERT INTO t_platform_plugin_command')) {
        state.commandRegistered=true
        return { rows: [{plugin_id:pluginId}],rowCount:1 }
      } else if (sql.includes('SELECT state FROM t_platform_plugin_lifecycle')) {
        return { rows: [{state:state.lifecycle}],rowCount:1 }
      } else if (sql.includes('INSERT INTO t_platform_plugin_execution')) {
        return { rows: [{owner:'lease'}],rowCount:1 }
      } else if (sql.includes('SELECT package_name,version,source,integrity_sha512,install_path FROM t_platform_plugin_install_history')) {
        return { rows: [], rowCount: 0 }
      } else if (sql.includes("UPDATE t_platform_plugin_install SET status='removed'")) {
        if (state.install) state.install.status = 'removed'
      } else if (sql.includes("UPDATE t_platform_plugin_lifecycle SET state='uninstalled'")) {
        state.lifecycle = 'uninstalled'
      }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  })
  return { state, query, connect }
}

test('installs an npm tarball, promotes it, and returns live route/task/Telegram registrations', async () => {
  const f = await fixture()
  const pool = fakePool()
  let lifecycleInstalled = false
  try {
    const result = await installRemotePlugin({
      pool: pool as never,
      packageName,
      version,
      source: 'npmjs',
      expectedManifest: metadata as never,
      expectedIntegritySha512: f.integrity,
      root: join(f.root, 'plugins'),
      fetcher: f.fetcher,
      npmRunner: async (_command, args) => {
        const prefix = args[args.indexOf('--prefix') + 1]
        const archive = args.at(-1)!
        const destination = join(prefix, 'node_modules', ...packageName.split('/'))
        await mkdir(destination, { recursive: true })
        await execFileAsync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'])
      },
      authorizePlugin: async id => assert.equal(id, pluginId),
      lifecycleInstall: async id => { assert.equal(id, pluginId); lifecycleInstalled = true; pool.state.lifecycle = 'active' },
    })
    assert.equal(result.pluginId, pluginId)
    assert.equal(result.status, 'installed')
    assert.equal(pool.state.install?.status, 'installed')
    assert.equal(lifecycleInstalled, true)
    assert.equal(result.registrations?.routes.length, 1)
    assert.equal(result.registrations?.tasks.length, 1)
    assert.equal(result.registrations?.commands.length, 1)
    assert.equal(result.registrations?.telegramHandlers.length, 1)
    const response = await result.registrations!.routes[0]!.handler({ request: new Request('https://host.test/api'), pluginId, user: { id: '1', roles: [] } })
    assert.deepEqual(await response.json(), { plugin: 'sample' })
    const taskResult=await runThirdPartyPluginTasks(pool as never,()=>true,{error(){}})
    assert.equal(taskResult.scanned,1)
    assert.equal(pool.state.storage, JSON.stringify(4))
    await setThirdPartyPluginBotEnabled(pool as never,pluginId,4,true)
    assert.equal(pool.state.commandRegistered,true)
    const commandResult=await dispatchThirdPartyTelegramUpdate(pool as never,4,{update_id:88,message:{text:'/hello world',chat:{id:4}}},['message'],88,{error(){}})
    assert.deepEqual(commandResult,{matched:true,handled:true,failedPlugins:[]})
    assert.deepEqual((globalThis as Record<string,unknown>).__tgbotpressSampleCommandArgs,['world'])
    assert.equal(await result.registrations!.telegramHandlers[0]!({ botId: 4, update: { message: { text: 'handled' } } }), true)
  } finally { delete (globalThis as Record<string,unknown>).__tgbotpressSampleCommandArgs; await rm(f.root, { recursive: true, force: true }) }
})

test('rolls back a first install and deactivates the runtime when activation fails', async () => {
  const f = await fixture()
  const pool = fakePool()
  try {
    await assert.rejects(installRemotePlugin({
      pool: pool as never,
      packageName,
      version,
      source: 'npmjs',
      root: join(f.root, 'plugins'),
      fetcher: f.fetcher,
      npmRunner: async (_command, args) => {
        const prefix = args[args.indexOf('--prefix') + 1]
        const destination = join(prefix, 'node_modules', ...packageName.split('/'))
        await mkdir(destination, { recursive: true })
        await execFileAsync('tar', ['-xzf', args.at(-1)!, '-C', destination, '--strip-components=1'])
      },
      lifecycleInstall: async () => { throw new Error('activation rejected') },
    }), /activation rejected/u)
    assert.equal(pool.state.install?.status, 'removed')
    assert.equal(pool.state.lifecycle, 'uninstalled')
    assert.equal((globalThis as Record<string, unknown>).__tgbotpressSampleDeactivated, true)
  } finally {
    delete (globalThis as Record<string, unknown>).__tgbotpressSampleDeactivated
    await rm(f.root, { recursive: true, force: true })
  }
})
