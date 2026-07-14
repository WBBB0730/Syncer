import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { deviceNameSchema, utf8ByteLength } from '@syncer/protocol'
import { AtomicJsonStorage } from '../src/main/utils/atomicStorage'
import {
  migrateLegacyDeviceName,
  migrateLegacyLocalStorage,
  migrateLegacyStorage,
  resolveReceiveHistoryPath,
  storageSchema
} from '../src/main/utils/storageSchema'

const ENABLED_UUID = '26f42d20-75b6-46a0-bfb2-3af7331a5ed2'
const DISABLED_UUID = '21b270a7-8951-4961-b5f6-9aa9f6dcaf7a'

test('legacy storage is migrated once and atomically persisted without losing compatible data', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-migration-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.json')
  const historyName = join('nested', `report\u202e.txt`)
  const legacy = {
    name: `Desk\u202e${'备'.repeat(100)}`,
    uuid: ENABLED_UUID,
    whiteList: {
      [ENABLED_UUID]: true,
      [DISABLED_UUID]: false,
      'legacy-unvalidated-id': true
    },
    receiveHistory: [{ name: historyName, path: directory, time: 123, selected: false }],
    filePath: directory,
    futureVersionData: { retained: true }
  }
  await writeFile(path, JSON.stringify(legacy))

  let migrationCalls = 0
  const storage = new AtomicJsonStorage(path, storageSchema, (value) => {
    migrationCalls += 1
    return migrateLegacyStorage(value)
  })

  const migrated = storage.read()
  assert.equal(migrationCalls, 1)
  assert.equal(migrated.name, migrateLegacyDeviceName(legacy.name))
  assert.deepEqual(migrated.whitelist, { [ENABLED_UUID]: true })
  assert.deepEqual(migrated.receiveHistory, [{ name: historyName, path: directory, time: 123 }])
  assert.deepEqual(
    (migrated as Record<string, unknown>).futureVersionData,
    legacy.futureVersionData
  )
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), migrated)

  assert.deepEqual(storage.read(), migrated)
  assert.equal(migrationCalls, 1)
})

test('known null values retain their legacy meaning of not set', () => {
  assert.deepEqual(
    migrateLegacyStorage({
      name: null,
      uuid: null,
      whiteList: null,
      receiveHistory: null,
      filePath: null,
      unrelated: null
    }),
    { unrelated: null }
  )
})

test('canonical Whitelist storage takes priority over the legacy key', () => {
  assert.deepEqual(
    migrateLegacyStorage({
      whitelist: { [ENABLED_UUID]: true },
      whiteList: { [DISABLED_UUID]: true }
    }),
    { whitelist: { [ENABLED_UUID]: true } }
  )
})

test('legacy localStorage raw values are decoded and validated as one narrow shape', () => {
  const directory = resolve('legacy-downloads')
  const legacyHistory = [{ name: 'report.txt', path: directory, time: 123, selected: false }]
  const history = [{ name: 'report.txt', path: directory, time: 123 }]
  assert.deepEqual(
    migrateLegacyLocalStorage({
      name: JSON.stringify('Legacy Desktop'),
      uuid: JSON.stringify(ENABLED_UUID),
      whitelist: JSON.stringify({
        [ENABLED_UUID]: true,
        [DISABLED_UUID]: false,
        invalid: true
      }),
      receiveHistory: JSON.stringify(legacyHistory),
      filePath: JSON.stringify(directory)
    }),
    {
      name: 'Legacy Desktop',
      uuid: ENABLED_UUID,
      whitelist: { [ENABLED_UUID]: true },
      receiveHistory: history,
      filePath: directory
    }
  )

  assert.throws(() =>
    migrateLegacyLocalStorage({
      name: null,
      uuid: null,
      whitelist: null,
      receiveHistory: null
    })
  )
  assert.throws(() =>
    migrateLegacyLocalStorage({
      name: null,
      uuid: 'not-json',
      whitelist: null,
      receiveHistory: null,
      filePath: null
    })
  )
})

test('legacy Device Names are cleaned and truncated deterministically', () => {
  assert.equal(migrateLegacyDeviceName(`A\u202e${'B'.repeat(300)}`), `A${'B'.repeat(254)}`)
  assert.equal(migrateLegacyDeviceName('   '), 'DESKTOP')
  assert.equal(migrateLegacyDeviceName('\u0000\u202e'), 'DESKTOP')

  const emojiName = migrateLegacyDeviceName('😀'.repeat(100))
  assert.equal(emojiName, '😀'.repeat(63))
  assert.equal(utf8ByteLength(emojiName), 252)
  assert.equal(deviceNameSchema.safeParse(emojiName).success, true)
})

test('legacy Receive History keeps local names while path resolution stays inside its directory', () => {
  const directory = resolve('history-root')
  const nestedName = join('nested', `report\u202e.txt`)
  assert.equal(
    resolveReceiveHistoryPath({ name: nestedName, path: directory, time: 1 }),
    resolve(directory, nestedName)
  )
  assert.equal(
    resolveReceiveHistoryPath({ name: join('..', 'outside.txt'), path: directory, time: 1 }),
    null
  )
  assert.equal(
    resolveReceiveHistoryPath({
      name: resolve(directory, '..', 'outside.txt'),
      path: directory,
      time: 1
    }),
    null
  )
})

test('malformed legacy structures remain explicit errors', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-invalid-migration-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.json')
  const storage = new AtomicJsonStorage(path, storageSchema, migrateLegacyStorage)
  await writeFile(path, '{')
  assert.throws(() => storage.read())

  const invalidValues: unknown[] = [
    [],
    { name: '' },
    { uuid: 'not-a-uuid' },
    { whiteList: { [ENABLED_UUID]: 'yes' } },
    { receiveHistory: [{ name: 'report.txt', path: 'relative', time: 1 }] },
    { receiveHistory: [{ name: '', path: directory, time: 1 }] },
    { receiveHistory: [{ name: 'report.txt', path: directory, time: Number.NaN }] }
  ]

  for (const value of invalidValues) {
    await writeFile(path, JSON.stringify(value))
    assert.throws(() => storage.read())
  }
})
