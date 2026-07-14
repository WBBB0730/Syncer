import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPublishedReceiveHistory,
  migrateReceiveHistory,
  parseReceiveHistory
} from '../src/repositories/receiveHistoryModel.ts'

test('published files are prepended in the legacy newest-first order', () => {
  assert.deepEqual(
    createPublishedReceiveHistory(
      [
        { name: 'first.txt', locator: 'first' },
        { name: 'last.txt', locator: 'last' }
      ],
      42
    ),
    [
      { name: 'last.txt', locator: 'last', time: 42 },
      { name: 'first.txt', locator: 'first', time: 42 }
    ]
  )
})

test('legacy iOS absolute locators migrate once to an opaque relative locator', async () => {
  const calls = []
  const legacyUri =
    'file:///private/var/mobile/Containers/Data/Application/OLD/Documents/Syncer/report.txt'
  const legacyPath =
    '/private/var/mobile/Containers/Data/Application/OLD/Documents/Syncer/report.txt'

  const result = await migrateReceiveHistory(
    [{ name: 'report.txt', time: 42, uri: legacyUri, path: legacyPath }],
    async (uri, path, name) => {
      calls.push({ uri, path, name })
      return 'report.txt'
    }
  )

  assert.equal(result.changed, true)
  assert.deepEqual(result.items, [{ name: 'report.txt', time: 42, locator: 'report.txt' }])
  assert.deepEqual(calls, [{ uri: legacyUri, path: legacyPath, name: 'report.txt' }])
})

test('legacy name-only history uses the explicit native migration contract', async () => {
  const result = await migrateReceiveHistory(
    [{ name: 'legacy.bin', time: 7 }],
    async (uri, path, name) => {
      assert.equal(uri, null)
      assert.equal(path, null)
      assert.equal(name, 'legacy.bin')
      return 'content://syncer/legacy.bin'
    }
  )

  assert.deepEqual(result.items, [
    { name: 'legacy.bin', time: 7, locator: 'content://syncer/legacy.bin' }
  ])
})

test('modern locator history does not invoke migration', async () => {
  const history = [{ name: 'new.bin', time: 9, locator: 'content://media/new' }]
  const result = await migrateReceiveHistory(history, async () => {
    throw new Error('must not migrate')
  })

  assert.equal(result.changed, false)
  assert.deepEqual(result.items, history)
  assert.deepEqual(parseReceiveHistory(result.items), history)
})

test('history rejects records without a completed locator migration', () => {
  assert.throws(
    () => parseReceiveHistory([{ name: 'legacy.bin', time: 1 }]),
    /saved-file locator/
  )
})
