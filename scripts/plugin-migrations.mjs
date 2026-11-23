import { readFile, readdir, stat } from 'node:fs/promises'

async function entriesWithMigrations(root) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error }

  const result = []
  for (const entry of entries.filter(item => (item.isDirectory() || item.isSymbolicLink()) && item.name.startsWith('plugin-')).sort((a, b) => a.name.localeCompare(b.name))) {
    try { if (!(await stat(new URL(`${entry.name}/`, root))).isDirectory()) continue }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    const directory = new URL(`${entry.name}/migrations/postgres/`, root)
    let files
    try { files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort() }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    if (files.length) result.push({ name: entry.name, directory, files })
  }
  return result
}

export async function discoverPluginMigrationDirectories(projectRoot = new URL('../', import.meta.url)) {
  const workspaceRoot = new URL('packages/', projectRoot)
  const installedRoot = new URL('node_modules/@tgbotpress/', projectRoot)
  const workspace = await entriesWithMigrations(workspaceRoot)
  const workspaceNames = new Set(workspace.map(item => item.name))
  const packageManifest = JSON.parse(await readFile(new URL('package.json', projectRoot), 'utf8'))
  const declaredDependencies = new Set([
    ...Object.keys(packageManifest.dependencies ?? {}),
    ...Object.keys(packageManifest.optionalDependencies ?? {}),
  ])
  const installed = (await entriesWithMigrations(installedRoot)).filter(item =>
    !workspaceNames.has(item.name) && declaredDependencies.has(`@tgbotpress/${item.name}`),
  )
  return [...workspace, ...installed]
}
