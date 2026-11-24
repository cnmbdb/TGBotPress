#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { installSkill, scaffoldPlugin, validatePluginPackage } from '../src/index.js'
const { values, positionals } = parseArgs({ allowPositionals: true, options: { id:{type:'string'}, name:{type:'string'}, description:{type:'string'}, directory:{type:'string',short:'d'} } })
try {
  if (positionals[0] === 'mcp') {
    await import('../src/mcp.js')
  } else if (positionals[0] === 'skill' && positionals[1] === 'install') {
    const target = await installSkill({ directory: resolve(values.directory || '.agent/skills') })
    console.log(`Installed skill at ${target}`)
  } else {
    if (positionals[0] === 'plugin' && positionals[1] === 'validate') {
      const result = await validatePluginPackage({ directory: resolve(values.directory || '.') })
      console.log(`Valid plugin ${result.id}@${result.version} (${result.entry})`)
    } else {
      if (positionals[0] !== 'plugin' || positionals[1] !== 'create') throw new Error('Usage: tgbotpress plugin create --id <id> --name <name> [--description <text>] [-d <directory>] | tgbotpress plugin validate [-d <package-directory>] | tgbotpress skill install [-d <skills-directory>] | tgbotpress mcp')
      const root = await scaffoldPlugin({ id:values.id, name:values.name, description:values.description, directory:resolve(values.directory || '.') })
      console.log(`Created ${root}`)
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
