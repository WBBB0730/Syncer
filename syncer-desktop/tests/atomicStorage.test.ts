import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'
import { AtomicJsonStorage } from '../src/main/utils/atomicStorage'

const schema = z.object({ value: z.string().optional() }).strict()

test('atomic JSON storage validates and replaces a complete document', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-json-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.json')
  const storage = new AtomicJsonStorage(path, schema)

  assert.deepEqual(storage.read(), {})
  storage.write({ value: 'first' })
  storage.write({ value: 'second' })

  assert.deepEqual(storage.read(), { value: 'second' })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { value: 'second' })
  assert.deepEqual(await readdir(directory), ['store.json'])
})

test('atomic JSON storage reports corrupt and schema-invalid documents', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-invalid-json-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.json')
  const storage = new AtomicJsonStorage(path, schema)

  await writeFile(path, '{')
  assert.throws(() => storage.read())
  await writeFile(path, JSON.stringify({ value: 42 }))
  assert.throws(() => storage.read())
})

test('invalid writes do not replace the last valid document', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'syncer-desktop-invalid-write-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.json')
  const storage = new AtomicJsonStorage(path, schema)

  storage.write({ value: 'valid' })
  assert.throws(() => storage.write({ value: 42 } as unknown as { value: string }))
  assert.deepEqual(storage.read(), { value: 'valid' })
})
