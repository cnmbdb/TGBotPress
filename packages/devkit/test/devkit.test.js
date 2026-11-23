import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest, installSkill, scaffoldPlugin } from '../src/index.js'

test('manifest validates id and includes host compatibility defaults', () => {
  assert.equal(createManifest({id:'hello-world',name:'Hello'}).sdkVersion,'0.1.0')
  assert.throws(()=>createManifest({id:'Bad ID',name:'Bad'}),/Plugin id/)
})
test('scaffolds an importable package with manifest and type entry', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tgbotpress-devkit-'))
  try { const root=await scaffoldPlugin({directory:dir,id:'hello-world',name:'Hello'}); const mod=await import(new URL(`file://${root}/src/index.js`)); assert.equal(mod.manifest.id,'hello-world'); assert.ok((await readFile(join(root,'src/index.d.ts'),'utf8')).includes('TgbotpressPlugin')) }
  finally { await rm(dir,{recursive:true,force:true}) }
})
test('installs the packaged agent skill into a skills directory', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tgbotpress-skill-'))
  try { const path=await installSkill({directory:dir}); assert.match(await readFile(path,'utf8'),/TGBotPress Plugin Development/) }
  finally { await rm(dir,{recursive:true,force:true}) }
})
