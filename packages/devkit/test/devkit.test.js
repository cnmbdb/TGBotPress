import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest, installSkill, scaffoldPlugin, validatePluginPackage } from '../src/index.js'

test('manifest validates id and includes host compatibility defaults', () => {
  assert.equal(createManifest({id:'example.hello-world',name:'Hello'}).sdkRange,'^0.1.0')
  assert.throws(()=>createManifest({id:'Bad ID',name:'Bad'}),/Plugin id/)
})
test('scaffolds an importable package with manifest and type entry', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tgbotpress-devkit-'))
  try { const root=await scaffoldPlugin({directory:dir,id:'example.hello-world',name:'Hello'}); const validated=await validatePluginPackage({directory:root}); assert.equal(validated.id,'example.hello-world'); const mod=await import(new URL(`file://${root}/dist/index.js`)); const sidecar=JSON.parse(await readFile(join(root,'tgbotpress.plugin.json'),'utf8')); const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')); assert.equal(mod.manifest.id,'example.hello-world'); assert.deepEqual(mod.manifest,sidecar); assert.deepEqual(pkg.tgbotpressPlugin,sidecar); assert.ok((await readFile(join(root,'dist/index.d.ts'),'utf8')).includes('PluginHost')) }
  finally { await rm(dir,{recursive:true,force:true}) }
})
test('installs the packaged agent skill into a skills directory', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tgbotpress-skill-'))
  try { const path=await installSkill({directory:dir}); assert.match(await readFile(path,'utf8'),/TGBotPress Plugin Development/) }
  finally { await rm(dir,{recursive:true,force:true}) }
})
