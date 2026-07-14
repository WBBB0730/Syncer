import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, '.test-dist')
const compiler = join(dirname(fileURLToPath(import.meta.resolve('typescript'))), 'tsc.js')
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const electronTimeoutMs = 30_000
let exitCode = 1

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function terminateProcessTree(child, force = false) {
  if (!child.pid || (!force && (child.exitCode !== null || child.signalCode !== null))) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.error(`Failed to terminate desktop test process tree: ${error}`)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runElectronIntegration(harness) {
  const userData = mkdtempSync(join(tmpdir(), 'syncer-network-integration-'))
  const child = spawn(electronExecutable, ['--disable-gpu', harness], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      SYNCER_NETWORK_TEST_USER_DATA: userData
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.pipe(process.stderr)

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    terminateProcessTree(child, true)
  }, electronTimeoutMs)

  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => resolve(status ?? 1))
    })
    if (timedOut) {
      console.error(`Desktop network integration timed out after ${electronTimeoutMs} ms`)
      return 1
    }
    if (code === 0 && !stdout.includes('SYNCER_NETWORK_INTEGRATION_OK')) {
      console.error('Desktop network integration exited without its success marker')
      return 1
    }
    return code
  } finally {
    clearTimeout(timeout)
    terminateProcessTree(child)
    rmSync(userData, { recursive: true, force: true })
  }
}

try {
  rmSync(output, { recursive: true, force: true })
  const compileStatus =
    spawnSync(process.execPath, [compiler, '-p', 'tsconfig.test.json'], {
      cwd: root,
      stdio: 'inherit'
    }).status ?? 1

  if (compileStatus !== 0) {
    exitCode = compileStatus
  } else {
    const testDirectory = join(output, 'tests')
    const tests = readdirSync(testDirectory)
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => join(testDirectory, name))
    exitCode =
      spawnSync(process.execPath, ['--test', ...tests], {
        cwd: root,
        stdio: 'inherit'
      }).status ?? 1
    if (exitCode === 0) {
      exitCode = await runElectronIntegration(join(testDirectory, 'networkIntegration.electron.js'))
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true })
}

process.exitCode = exitCode
