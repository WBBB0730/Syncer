import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initializeStorageFile } from '../src/main/utils/storage'

const CURRENT_UUID = '26f42d20-75b6-46a0-bfb2-3af7331a5ed2'
const LEGACY_UUID = '21b270a7-8951-4961-b5f6-9aa9f6dcaf7a'

test('legacy localStorage is atomically imported only when the JSON store is absent', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-storage-initialize-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'syncer-store.json')

  const storage = initializeStorageFile(path, {
    name: JSON.stringify('Legacy Desktop'),
    uuid: JSON.stringify(LEGACY_UUID),
    whitelist: null,
    receiveHistory: null,
    filePath: null
  })
  assert.deepEqual(storage.read(), { name: 'Legacy Desktop', uuid: LEGACY_UUID })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), storage.read())

  const current = { name: 'Current Desktop', uuid: CURRENT_UUID }
  await writeFile(path, JSON.stringify(current))
  const reopened = initializeStorageFile(path, {
    name: JSON.stringify('Ignored Legacy Desktop'),
    uuid: JSON.stringify(LEGACY_UUID),
    whitelist: null,
    receiveHistory: null,
    filePath: null
  })
  assert.deepEqual(reopened.read(), current)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), current)
})
