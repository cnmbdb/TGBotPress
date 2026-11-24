import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
const output=new URL('../migrations/d1/',import.meta.url)
await mkdir(output,{recursive:true})
const base=(await readFile(new URL('../legacy/sqlite-000-legacy-schema.sql',import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'').trim()
const defaults=(await readFile(new URL('../legacy/000-legacy-defaults.sql',import.meta.url),'utf8')).replaceAll('public.','').replace(/SELECT setval\([^;]+;\s*/gi,'').trim()
await writeFile(new URL('0001_legacy_schema.sql',output),`${base}\n\n${defaults}\n`)
const files=(await readdir(new URL('../migrations/sqlite/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()
for(const [index,name] of files.entries()){
  const sql=(await readFile(new URL('../migrations/sqlite/'+name,import.meta.url),'utf8'))
    .replace(/^\s*BEGIN(?: TRANSACTION)?;\s*$/gim,'')
    .replace(/^\s*COMMIT;\s*$/gim,'')
    .trim()
  await writeFile(new URL(`${String(index+2).padStart(4,'0')}_${name}`,output),sql+'\n')
}
const manual=(await readFile(new URL('../migrations/sqlite/MANUAL_PORTS.txt',import.meta.url),'utf8')).trim()
await writeFile(new URL('README.md',output),`# Cloudflare D1 migrations\n\nGenerated from the SQLite schema and migration set by \`scripts/generate-d1-migrations.mjs\`.\n\nApply these files with the Cloudflare D1 migration workflow for the target database. The initial file includes the legacy schema and default permission seed; it does not create an administrator password or store secrets.\n\nSQLite manual ports still pending:\n${manual.split('\\n').map(item=>'- '+item).join('\\n')}\n\nThis package is only the D1-compatible schema/migration layer. The application still needs a Workers entrypoint, D1 binding integration, and transaction-path refactoring before it can run on D1.\n`)
console.log(`Generated ${files.length+1} D1 migrations.`)
