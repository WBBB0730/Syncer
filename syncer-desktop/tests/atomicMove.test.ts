import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { moveNoReplace } from '../src/main/utils/atomicMove'

const nativeMoveSupported = process.platform === 'win32' || process.platform === 'darwin'

test('native file move publishes without replacing an existing destination', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-native-move-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.txt')
  const destination = join(directory, 'destination.txt')
  await writeFile(source, 'source')

  if (!nativeMoveSupported) {
    assert.throws(() => moveNoReplace(source, destination), /not supported/)
    return
  }

  assert.equal(moveNoReplace(source, destination), true)
  assert.equal(existsSync(source), false)
  assert.equal(await readFile(destination, 'utf8'), 'source')

  await writeFile(source, 'second source')
  assert.equal(moveNoReplace(source, destination), false)
  assert.equal(await readFile(source, 'utf8'), 'second source')
  assert.equal(await readFile(destination, 'utf8'), 'source')
})

test('native file move rejects paths containing null bytes', () => {
  assert.throws(() => moveNoReplace('source\0', 'destination'), TypeError)
  assert.throws(() => moveNoReplace('source', 'destination\0'), TypeError)
})
