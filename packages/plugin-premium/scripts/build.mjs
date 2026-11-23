import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = join(packageRoot, 'src')
const outputDirectory = join(packageRoot, '.build')
const compiler = join(packageRoot, 'node_modules', '.bin', 'tsc')

rmSync(outputDirectory, { recursive: true, force: true })
try {
  execFileSync(compiler, ['--project', join(packageRoot, 'tsconfig.build.json')], { cwd: packageRoot, stdio: 'inherit' })
  for (const file of readdirSync(outputDirectory)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    const outputName = file.replace(/\.source\.(js|d\.ts)$/u, '.$1')
    copyFileSync(join(outputDirectory, file), join(sourceDirectory, outputName))
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true })
}
console.log('Built ESM modules and declaration files from the package sources.')
