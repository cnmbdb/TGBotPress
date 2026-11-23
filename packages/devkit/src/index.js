import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createManifest({ id, name, description = '' }) {
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(id ?? '')) throw new Error('Plugin id must be 2-48 lowercase letters, digits, or hyphens')
  if (!name?.trim()) throw new Error('Plugin name is required')
  return { id, version: '0.1.0', hostRange: '>=1.0.0 <2.0.0', sdkVersion: '0.1.0', name: name.trim(), ...(description ? { description: description.trim() } : {}), dependencies: [], menuRoutes: [], apiRoutes: [], tasks: [], drainTasks: [], configTypes: [] }
}

export async function scaffoldPlugin({ directory, id, name, description = '' }) {
  const root = join(directory, `tgbotpress-plugin-${id}`)
  const manifest = createManifest({ id, name, description })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: `@example/plugin-${id}`, version: manifest.version, type: 'module', exports: { '.': { types: './src/index.d.ts', import: './src/index.js' } }, files: ['src'] }, null, 2) + '\n')
  await writeFile(join(root, 'src/index.js'), `export const manifest = ${JSON.stringify(manifest, null, 2)}\n\nexport const plugin = { manifest }\n`)
  const declarations = `export type PluginManifest = { id:string; version:string; hostRange:string; sdkVersion:string; name:string; description?:string; dependencies?:string[]; menuRoutes?:string[]; apiRoutes?:string[]; tasks?:string[]; drainTasks?:string[]; configTypes?:Array<'command'|'keyboard'|'keyreply'|'keyreply_keyboard'> }
export type PluginHost = { manifest:PluginManifest; state:()=>Promise<'active'|'draining'|'uninstalled'>; transition:(action:'install'|'disable'|'resume'|'uninstall')=>Promise<'active'|'draining'|'uninstalled'>; log:{info:(...values:unknown[])=>void;error:(...values:unknown[])=>void} }
export type TgbotpressPlugin = { manifest:PluginManifest; activate?:(host:PluginHost)=>Promise<void>|void; deactivate?:(host:PluginHost)=>Promise<void>|void }
export declare const manifest: PluginManifest
export declare const plugin: TgbotpressPlugin
`
  await writeFile(join(root, 'src/index.d.ts'), declarations)
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
