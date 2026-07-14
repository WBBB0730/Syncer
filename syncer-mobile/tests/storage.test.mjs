import assert from 'node:assert/strict'
import test from 'node:test'

import { createSerializedStorage } from '../src/utils/serializedStorage.ts'

class MemoryStorage {
  values = new Map()
  failNextWrite = false

  async getItem(key) {
    return this.values.get(key) ?? null
  }

  async setItem(key, value) {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('write failed')
    }
    this.values.set(key, value)
  }
}

test('a rejected write never changes subsequent reads', async () => {
  const backend = new MemoryStorage()
  const storage = createSerializedStorage(backend)
  await storage.set('value', { version: 1 })

  backend.failNextWrite = true
  await assert.rejects(storage.set('value', { version: 2 }), /write failed/)
  assert.deepEqual(await storage.get('value'), { version: 1 })
})

test('a failed mutation can be retried without duplicating history', async () => {
  const backend = new MemoryStorage()
  const storage = createSerializedStorage(backend)
  await storage.set('history', [])

  const prepend = () =>
    storage.mutate('history', (current) => ['received', ...(current ?? [])])

  backend.failNextWrite = true
  await assert.rejects(prepend(), /write failed/)
  assert.deepEqual(await prepend(), ['received'])
  assert.deepEqual(await storage.get('history'), ['received'])
})

test('legacy react-native-storage values migrate before use', async () => {
  const backend = new MemoryStorage()
  backend.values.set('name', JSON.stringify({ rawData: 'MOBILE_12345' }))
  const storage = createSerializedStorage(backend)

  assert.equal(await storage.get('name'), 'MOBILE_12345')
  assert.equal(backend.values.get('@syncer/name'), JSON.stringify('MOBILE_12345'))
})
