import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

export function createManifest({ id, name, description = '' }) {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id ?? '') || id.length > 64) throw new Error('Plugin id must be a unique lowercase or reverse-domain ID up to 64 characters')
  if (!name?.trim()) throw new Error('Plugin name is required')
  return { schemaVersion: 1, id, name: name.trim(), version: '0.1.0', apiVersion: 1, hostRange: '>=1.0.0 <2.0.0', sdkRange: '^0.1.0', runtime: { node: '>=22' }, entry: './dist/index.js', permissions: ['telegram.commands.register', 'telegram.messages.send'], telegramUpdateTypes: ['message'], contributes: { commands: [{ name: 'hello', description: 'Say hello' }] }, ...(description ? { description: description.trim() } : {}) }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export async function validatePluginPackage({ directory }) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(directory, 'tgbotpress.plugin.json'), 'utf8'))
  const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
  const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
  const allowedPermissions = new Set(['http','telegram','tasks','storage','admin.api','admin.menu','plugin.storage.read','plugin.storage.write','plugin.jobs.register','telegram.updates.read','telegram.api.call','telegram.messages.send','telegram.messages.edit','telegram.messages.delete','telegram.members.read','telegram.members.manage','external.http'])
  if (typeof pkg.name !== 'string' || !packagePattern.test(pkg.name)) throw new Error('Invalid npm package name')
  if (!idPattern.test(manifest.id ?? '') || manifest.id.length > 64) throw new Error('Invalid plugin ID')
  if (manifest.schemaVersion !== 1 || manifest.apiVersion !== 1 || !versionPattern.test(manifest.version ?? '') || pkg.version !== manifest.version) throw new Error('Manifest/package version mismatch or unsupported schema')
  if (typeof manifest.hostRange!=='string'||typeof manifest.sdkRange!=='string'||typeof manifest.runtime?.node!=='string') throw new Error('Manifest compatibility ranges are required')
  if (stableJson(pkg.tgbotpressPlugin) !== stableJson(manifest)) throw new Error('package.json tgbotpressPlugin must match tgbotpress.plugin.json')
  if (typeof manifest.entry !== 'string' || !/^\.\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs)$/.test(manifest.entry) || manifest.entry.slice(2).split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid plugin entry path')
  if (!Array.isArray(manifest.permissions) || !manifest.permissions.length || manifest.permissions.some(permission=>typeof permission!=='string'||!allowedPermissions.has(permission))) throw new Error('Manifest permissions are invalid')
  const realRoot=await realpath(directory),entry=await realpath(join(realRoot,manifest.entry)),entryFromRoot=relative(realRoot,entry)
  if(entryFromRoot.startsWith('..')||isAbsolute(entryFromRoot))throw new Error('Plugin entry escapes the package directory')
  await readFile(entry)
  const packageEntry = pkg.exports?.['.']?.import ?? pkg.main
  if (packageEntry !== manifest.entry) throw new Error('package.json entry must match the manifest entry')
  return { id: manifest.id, name: manifest.name, version: manifest.version, entry: manifest.entry }
}

export async function scaffoldPlugin({ directory, id, name, description = '' }) {
  const root = join(directory, `tgbotpress-plugin-${id}`)
  const manifest = createManifest({ id, name, description })
  await Promise.all([mkdir(join(root, 'src'), { recursive: true }), mkdir(join(root, 'dist'), { recursive: true }), mkdir(join(root, 'scripts'), { recursive: true })])
  const packageName = `@example/tgbotpress-plugin-${id.replaceAll('.', '-')}`
  await writeFile(join(root, 'tgbotpress.plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: packageName, version: manifest.version, description: manifest.description ?? `${manifest.name} TGBotPress plugin`, type: 'module', main: manifest.entry, exports: { '.': { types: './dist/index.d.ts', import: manifest.entry } }, files: ['dist', 'tgbotpress.plugin.json', 'README.md'], scripts: { build: 'node scripts/build.mjs', typecheck: 'node --check src/index.js' }, engines: { node: '>=22' }, tgbotpressPlugin: manifest }, null, 2) + '\n')
  await writeFile(join(root, 'src/index.js'), `import manifest from '../tgbotpress.plugin.json' with { type: 'json' }\n\nexport { manifest }\nexport const plugin = {\n  manifest,\n  activate(host) {\n    host.registerCommand({ name: 'hello', description: 'Say hello', handler: async ({ update, telegram }) => {\n      const message = update.message\n      if (!message) return false\n      await telegram.call('sendMessage', { chat_id: String(message.chat.id), text: 'Hello from ${name.trim()}!' })\n      return true\n    } })\n  },\n}\n`)
  await writeFile(join(root, 'dist/index.d.ts'), `export type PluginManifest = { readonly schemaVersion: 1; readonly id: string; readonly name: string; readonly version: string; readonly apiVersion: 1; readonly hostRange: string; readonly sdkRange: string; readonly runtime: { readonly node: string }; readonly entry: string; readonly permissions: readonly string[]; readonly telegramUpdateTypes: readonly string[]; readonly contributes: { readonly commands: readonly { readonly name: string; readonly description: string }[] }; readonly description?: string }\nexport type PluginCommandContext = { botId:number; update:Record<string,any>; command:string; args:string[]; storage?:{get:(key:string)=>Promise<unknown|null>;set:(key:string,value:unknown)=>Promise<void>;delete:(key:string)=>Promise<void>}; telegram:{call:(method:string,payload?:Record<string,unknown>)=>Promise<unknown>} }\nexport type PluginHost = { registerCommand:(command:{name:string;description:string;handler:(event:PluginCommandContext)=>boolean|void|Promise<boolean|void>})=>void }\nexport declare const manifest: PluginManifest\nexport declare const plugin: { readonly manifest: PluginManifest; activate:(host:PluginHost)=>void }\n`)
  await writeFile(join(root, 'dist/index.js'), await readFile(join(root, 'src/index.js'), 'utf8'))
  await writeFile(join(root, 'scripts/build.mjs'), `import { copyFile, mkdir } from 'node:fs/promises'\nawait mkdir(new URL('../dist/', import.meta.url), { recursive: true })\nawait copyFile(new URL('../src/index.js', import.meta.url), new URL('../dist/index.js', import.meta.url))\n`)
  await writeFile(join(root, 'README.md'), `# ${name.trim()}\n\nTGBotPress plugin: ${id}\n\nBuild the package with npm run build, then inspect it with npm pack --dry-run.\n\nThe published package includes the compiled dist directory and tgbotpress.plugin.json.\n`)
  return root
}

export async function installSkill({ directory }) {
  const source = new URL('../skills/tgbotpress-plugin-development/SKILL.md', import.meta.url)
  const content = await readFile(source, 'utf8')
  const target = join(directory, 'tgbotpress-plugin-development', 'SKILL.md')
  await mkdir(join(directory, 'tgbotpress-plugin-development'), { recursive: true })
  await writeFile(target, content)
  return target
}
