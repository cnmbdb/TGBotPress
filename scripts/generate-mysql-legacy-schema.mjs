import { readFile, writeFile } from 'node:fs/promises'

const sourcePath = new URL('../legacy/000-legacy-schema.sql', import.meta.url)
const outputPath = new URL('../legacy/mysql-000-legacy-schema.sql', import.meta.url)
let sql = await readFile(sourcePath, 'utf8')
const sequenceColumns = [...sql.matchAll(/ALTER TABLE ONLY public\.(\w+) ALTER COLUMN (\w+) SET DEFAULT nextval\(/g)].map(match => ({ table: match[1], column: match[2] }))
const autoColumns = [...sequenceColumns, ...[...sql.matchAll(/CREATE TABLE public\.(\w+) \(\n([\s\S]*?)\n\);/g)].flatMap(match => [...match[2].matchAll(/^\s*(\w+) bigserial\b/gm)].map(columnMatch => ({ table: match[1], column: columnMatch[1] })))]

// PostgreSQL sequence machinery becomes AUTO_INCREMENT on its integer key.
sql = sql.replace(/CREATE SEQUENCE public\.[\s\S]*?CACHE 1;\s*/g, '')
sql = sql.replace(/^ALTER SEQUENCE public\.[^\n]+\n/gm, '')
sql = sql.replace(/^ALTER TABLE ONLY public\.[^\n]+ ALTER COLUMN [^\n]+nextval\([^\n]+\n/gm, '')
sql = sql.replace(/(CREATE TABLE public\.(\w+) \(\n)([\s\S]*?)(\n\);)/g, (whole, prefix, table, body, suffix) => {
  let mappedBody = body
  for (const entry of sequenceColumns.filter(candidate => candidate.table === table)) {
    const columnPattern = new RegExp(`(^\\s*${entry.column}\\s+)(?:integer|bigint)\\b`, 'm')
    if (!columnPattern.test(mappedBody)) throw new Error(`MySQL schema conversion cannot map sequence column: ${table}.${entry.column}`)
    mappedBody = mappedBody.replace(columnPattern, '$1BIGINT AUTO_INCREMENT')
  }
  return prefix + mappedBody + suffix
})

sql = sql.replace(/\b(bigserial|serial)\b/gi, match => match.toLowerCase() === 'bigserial' ? 'BIGINT AUTO_INCREMENT' : 'INTEGER AUTO_INCREMENT')
sql = sql.replace(/(CREATE TABLE public\.(\w+) \(\n)([\s\S]*?)(\n\);)/g, (whole, prefix, table, body, suffix) => {
  let mappedBody = body
  const columns = autoColumns.filter(candidate => candidate.table === table)
  for (const { column } of columns) {
    if (new RegExp(`PRIMARY KEY\\s*\\(\\s*${column}\\s*\\)`, 'i').test(mappedBody)) continue
    const columnPattern = new RegExp(`(^\\s*${column}\\s+[^,\\n]+?)(,?)$`, 'm')
    if (!columnPattern.test(mappedBody)) throw new Error(`MySQL schema conversion cannot key auto column: ${table}.${column}`)
    mappedBody = mappedBody.replace(columnPattern, (line, definition, comma) => definition.includes('PRIMARY KEY') ? line : `${definition} PRIMARY KEY${comma}`)
  }
  return prefix + mappedBody + suffix
})
for (const {table,column} of autoColumns) {
  const keyPattern = new RegExp(`ALTER TABLE (?:ONLY )?(?:public\\.)?${table}\\s+ADD CONSTRAINT \\w+ PRIMARY KEY \\(\\s*${column}\\s*\\);\\s*`, 'g')
  sql = sql.replace(keyPattern, '')
}
sql = sql.replace(/CREATE TABLE public\./g, 'CREATE TABLE ')
sql = sql.replace(/\bpublic\./g, '')
sql = sql.replaceAll('\"timestamp\"', '`timestamp`')
sql = sql.replace(/character varying/g, 'VARCHAR').replace(/character\((\d+)\)/g, 'CHAR($1)')
sql = sql.replace(/\bjsonb\b/gi, 'JSON').replace(/\bbytea\b/gi, 'LONGBLOB')
sql = sql.replace(/(\b(?:TEXT|JSON|LONGBLOB|BLOB)\s+DEFAULT)\s+('(?:[^']|'')*'|[0-9]+|true|false)/gi, '$1 ($2)')
sql = sql.replace(/timestamp without time zone/g, 'DATETIME(6)')
sql = sql.replace(/DATETIME\(6\)([^,\n]*DEFAULT CURRENT_TIMESTAMP)(?!\(\d\))/gi, (match, tail) => `DATETIME(6)${tail.replace('CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP(6)')}`)
sql = sql.replace(/::(?:character varying|varchar|text|smallint|bigint|integer|numeric|bpchar|boolean|timestamp without time zone|regclass)\b/gi, '')
sql = sql.replace(/DEFAULT\s+nextval\([^)]*\)/g, '')
sql = sql.replace(/\bUSING btree\s*/g, '')
sql = sql.replace(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g, 'CREATE $1INDEX')
sql = sql.replace(/ALTER TABLE ONLY /g, 'ALTER TABLE ')
sql = sql.replace(/\nDO \$\$[\s\S]*?END \$\$;\s*/g, '\n')

sql = sql.replace(/(CREATE INDEX [^;]+?)\s+WHERE [^;]+;/g, '$1;')

// PostgreSQL partial indexes: nullable unique keys already have the same
// behavior in MySQL; the active-opening rule uses conditional generated keys.
sql = sql.replace(/(CREATE UNIQUE INDEX uq_telegram_clone_proxy_source_order[\s\S]*?\)\s*)\n\s*WHERE source_order_rid IS NOT NULL;/, '$1;')
sql = sql.replace(/CREATE UNIQUE INDEX uq_telegram_clone_proxy_opening_pending_user\s+ON t_telegram_clone_proxy_order \(master_bot_rid, pay_user_tg_uid\)\s+WHERE order_type = 'opening' AND status IN \(0, 1\);/, `ALTER TABLE t_telegram_clone_proxy_order
  ADD COLUMN active_opening_master_bot_rid INT GENERATED ALWAYS AS (CASE WHEN order_type='opening' AND status IN (0,1) THEN master_bot_rid ELSE NULL END) STORED,
  ADD COLUMN active_opening_pay_user_tg_uid BIGINT GENERATED ALWAYS AS (CASE WHEN order_type='opening' AND status IN (0,1) THEN pay_user_tg_uid ELSE NULL END) STORED;
CREATE UNIQUE INDEX uq_telegram_clone_proxy_opening_pending_user ON t_telegram_clone_proxy_order (active_opening_master_bot_rid, active_opening_pay_user_tg_uid);`)

const unsupported = []
if (/\b(?:CREATE EXTENSION|CREATE SEQUENCE|nextval\(|::\w+|\bDO \$\$|\bUSING (?:gin|gist|hash)\b|\bFILTER\s*\()/i.test(sql)) unsupported.push('unconverted PostgreSQL feature')
if (/\bWHERE\b/i.test(sql.match(/CREATE (?:UNIQUE )?INDEX[^;]+;/gs)?.join('\n') || '')) unsupported.push('unconverted partial index')
if (unsupported.length) throw new Error(`MySQL schema conversion stopped: ${unsupported.join(', ')}`)

await writeFile(outputPath, `-- Generated from legacy/000-legacy-schema.sql; do not edit by hand.\n${sql.trim()}\n`)
console.log(`Wrote ${outputPath.pathname}`)
