import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ReceivedFileStorage } from '../src/main/services/receivedFileStorage'

test('reset removes stale staging and a new batch can be created', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-storage-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const root = join(sandbox, 'staging')
  const storage = new ReceivedFileStorage(root)

  await mkdir(join(root, 'stale'), { recursive: true })
  await writeFile(join(root, 'stale', 'partial'), 'partial')
  await storage.reset()
  assert.equal(existsSync(root), false)

  const batch = await storage.createBatchDirectory()
  assert.equal(existsSync(batch), true)
})

test('publication is complete, collision-safe, and leaves no publishing file', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-publish-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const storage = new ReceivedFileStorage(join(sandbox, 'staging'))
  const batch = await storage.createBatchDirectory()
  const source = storage.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, Buffer.from([0, 1, 2, 3, 255]))

  const first = await storage.preparePublication(source, destination, 'report.bin')
  assert.equal(existsSync(join(destination, 'report.bin')), false)
  assert.equal((await readdir(destination)).length, 1)
  assert.match((await readdir(destination))[0], /^\.syncer-publication-.*\.partial$/)
  assert.equal(await storage.commitPublication(first), 'report.bin')
  await writeFile(source, Buffer.from([4, 5, 6, 7, 254]))
  const second = await storage.preparePublication(source, destination, 'report.bin')
  assert.deepEqual(
    (await readdir(destination)).filter((name) => !name.startsWith('.syncer-publication-')),
    ['report.bin']
  )
  assert.equal(await storage.commitPublication(second), 'report (1).bin')
  assert.deepEqual(await readFile(join(destination, 'report.bin')), Buffer.from([0, 1, 2, 3, 255]))
  assert.deepEqual(
    await readFile(join(destination, 'report (1).bin')),
    Buffer.from([4, 5, 6, 7, 254])
  )
  assert.deepEqual((await readdir(destination)).sort(), ['report (1).bin', 'report.bin'])
})

test('publication preserves Unicode destination names', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-unicode-publish-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const storage = new ReceivedFileStorage(join(sandbox, 'staging'))
  const batch = await storage.createBatchDirectory()
  const source = storage.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, '内容')

  const publication = await storage.preparePublication(source, destination, '报告.txt')
  assert.equal(await storage.commitPublication(publication), '报告.txt')
  assert.equal(await readFile(join(destination, '报告.txt'), 'utf8'), '内容')
})

test('publication rejects sources outside application-owned staging', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-boundary-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const storage = new ReceivedFileStorage(join(sandbox, 'staging'))
  const destination = join(sandbox, 'destination')
  const outside = join(sandbox, 'outside')
  await mkdir(destination)
  await writeFile(outside, 'outside')

  await assert.rejects(() => storage.preparePublication(outside, destination, 'outside.txt'))
})

test('publication rejects a destination name outside the selected directory', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-name-boundary-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const storage = new ReceivedFileStorage(join(sandbox, 'staging'))
  const batch = await storage.createBatchDirectory()
  const source = storage.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, 'content')

  await assert.rejects(() => storage.preparePublication(source, destination, '../outside.txt'))
  assert.deepEqual(await readdir(destination), [])
})

test('an unpublished destination can be abandoned without exposing a final file', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-abandon-publication-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const storage = new ReceivedFileStorage(join(sandbox, 'staging'))
  const batch = await storage.createBatchDirectory()
  const source = storage.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, 'content')

  const publication = await storage.preparePublication(source, destination, 'report.txt')
  assert.equal(await storage.abandonPublication(publication), true)
  assert.deepEqual(await readdir(destination), [])
  assert.equal(await storage.abandonPublication(publication), false)
})

test('reset recovers an exactly journaled publication temporary after a crash', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-publication-recovery-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const root = join(sandbox, 'staging')
  const journalPath = join(sandbox, 'state', 'publication-journal.json')
  const interrupted = new ReceivedFileStorage(root, { journalPath })
  const batch = await interrupted.createBatchDirectory()
  const source = interrupted.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, 'content')

  await interrupted.preparePublication(source, destination, 'report.txt')
  assert.equal((await readdir(destination)).length, 1)
  await rm(root, { recursive: true, force: true })

  const restarted = new ReceivedFileStorage(root, { journalPath })
  await restarted.reset()

  assert.deepEqual(await readdir(destination), [])
  assert.equal(existsSync(root), false)
})

test('reset preserves a final file committed before journal release', async (context) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'syncer-desktop-published-recovery-'))
  context.after(() => rm(sandbox, { recursive: true, force: true }))
  const root = join(sandbox, 'staging')
  const journalPath = join(sandbox, 'state', 'publication-journal.json')
  const interrupted = new ReceivedFileStorage(root, { journalPath })
  const batch = await interrupted.createBatchDirectory()
  const source = interrupted.stagedFilePath(batch)
  const destination = join(sandbox, 'destination')
  await mkdir(destination)
  await writeFile(source, 'content')

  await interrupted.preparePublication(source, destination, 'report.txt')
  const [temporaryName] = await readdir(destination)
  assert.ok(temporaryName)
  await rename(join(destination, temporaryName), join(destination, 'report.txt'))
  assert.equal(await readFile(join(destination, 'report.txt'), 'utf8'), 'content')

  const restarted = new ReceivedFileStorage(root, { journalPath })
  await restarted.reset()

  assert.equal(await readFile(join(destination, 'report.txt'), 'utf8'), 'content')
  assert.equal(existsSync(root), false)
})
