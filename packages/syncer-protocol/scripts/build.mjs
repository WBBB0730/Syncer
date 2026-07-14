import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'dist')
const compiler = join(dirname(fileURLToPath(import.meta.resolve('typescript'))), 'tsc.js')
let exitCode = 1

try {
  rmSync(output, { recursive: true, force: true })
  for (const config of ['tsconfig.esm.json', 'tsconfig.cjs.json']) {
    exitCode =
      spawnSync(process.execPath, [compiler, '-p', config], {
        cwd: root,
        stdio: 'inherit'
      }).status ?? 1
    if (exitCode !== 0) break
  }

  if (exitCode === 0) {
    const commonJsOutput = join(output, 'cjs')
    mkdirSync(commonJsOutput, { recursive: true })
    writeFileSync(join(commonJsOutput, 'package.json'), '{"type":"commonjs"}\n', 'utf8')
  }
} finally {
  if (exitCode !== 0) rmSync(output, { recursive: true, force: true })
}

process.exitCode = exitCode
