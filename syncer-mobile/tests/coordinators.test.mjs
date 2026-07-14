import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BoundedPriorityQueue,
  ExclusiveOwnership,
  LatestStateCoordinator,
  RestorableValueSnapshot,
  SerialTaskQueue
} from '../src/service/coordinators.ts'

test('ExclusiveOwnership exposes activity for exactly one owner', () => {
  const activity = []
  const ownership = new ExclusiveOwnership((active) => activity.push(active))
  const batch = { id: 'batch' }

  ownership.acquire(batch)
  assert.equal(ownership.current, batch)
  assert.throws(() => ownership.acquire({ id: 'other' }), /already active/)
  assert.equal(ownership.release(), batch)
  assert.equal(ownership.current, null)
  assert.equal(ownership.release(), null)

  const replacement = { id: 'replacement' }
  ownership.acquire(replacement)
  assert.equal(ownership.current, replacement)
  assert.equal(ownership.release(), replacement)
  assert.deepEqual(activity, [true, false, true, false])
})

test('LatestStateCoordinator converges rapid updates to the latest requested state', async () => {
  const coordinator = new LatestStateCoordinator(false)
  const observed = []
  let releaseStart
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve
  })
  const reconcile = async (desired) => {
    observed.push(desired())
    await startBlocked
    observed.push(desired())
  }

  const start = coordinator.set(true, reconcile)
  await Promise.resolve()
  const stop = coordinator.set(false, reconcile)
  releaseStart()
  await Promise.all([start, stop])

  assert.equal(coordinator.value, false)
  assert.deepEqual(observed, [true, false, false, false])
})

test('LatestStateCoordinator can roll back desired state inside reconciliation', async () => {
  const coordinator = new LatestStateCoordinator(false)
  await coordinator.set(true, async () => {
    coordinator.replaceDesired(false)
  })
  assert.equal(coordinator.value, false)
})

test('LatestStateCoordinator cleanup does not wait for a later requested start', async () => {
  const coordinator = new LatestStateCoordinator('request-a')
  const order = []
  let releaseStart
  let startFinished = false
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve
  })

  coordinator.replaceDesired(null)
  const cleanup = coordinator.runExclusive(async () => {
    order.push('cleanup-a')
  })
  const start = coordinator.set('request-b', async (desired) => {
    order.push(`start-${desired()}`)
    await startBlocked
    startFinished = true
  })

  await cleanup
  assert.equal(startFinished, false)
  assert.equal(order[0], 'cleanup-a')

  releaseStart()
  await start
  assert.deepEqual(order, ['cleanup-a', 'start-request-b'])
})

test('SerialTaskQueue preserves order and continues after a rejected task', async () => {
  const queue = new SerialTaskQueue()
  const order = []
  const first = queue.run(async () => {
    order.push('first')
    throw new Error('expected')
  })
  const second = queue.run(async () => {
    order.push('second')
    return 2
  })

  await assert.rejects(first, /expected/)
  assert.equal(await second, 2)
  assert.deepEqual(order, ['first', 'second'])
})

test('BoundedPriorityQueue preempts normal work and restores it after urgent work', () => {
  const queue = new BoundedPriorityQueue(4)
  queue.enqueue({ value: 'history', priority: 'normal' })
  queue.enqueue({ value: 'text', priority: 'normal' })

  assert.equal(queue.enqueue({ value: 'ring', priority: 'urgent' }).value, 'ring')
  assert.equal(queue.remove((value) => value === 'ring')?.value, 'history')
  assert.equal(queue.remove((value) => value === 'history')?.value, 'text')
})

test('BoundedPriorityQueue replaces a keyed interaction without growing', () => {
  const queue = new BoundedPriorityQueue(4)
  queue.enqueue({ value: { key: 'text', content: 'old' }, priority: 'normal' })
  queue.upsert(
    { value: { key: 'text', content: 'latest' }, priority: 'normal' },
    (entry) => entry.key === 'text'
  )

  assert.equal(queue.size, 1)
  assert.equal(queue.active.value.content, 'latest')
})

test('BoundedPriorityQueue reserves bounded slots for urgent work', () => {
  const queue = new BoundedPriorityQueue(4)
  queue.enqueue({ value: 'one', priority: 'normal' })
  queue.enqueue({ value: 'two', priority: 'normal' })

  assert.throws(
    () => queue.enqueue({ value: 'three', priority: 'normal' }),
    /Pending interaction limit exceeded/
  )
  assert.equal(queue.enqueue({ value: 'ring', priority: 'urgent' }).value, 'ring')
  assert.equal(queue.size, 3)
  assert.equal(queue.enqueue({ value: 'request', priority: 'urgent' }).value, 'request')
  assert.throws(
    () => queue.enqueue({ value: 'other', priority: 'urgent' }),
    /Urgent interaction limit exceeded/
  )
  assert.equal(queue.remove((value) => value === 'request')?.value, 'ring')
  assert.equal(queue.remove((value) => value === 'ring')?.value, 'one')
  assert.equal(queue.size, 2)
})

test('RestorableValueSnapshot keeps ownership until restoration succeeds', async () => {
  const snapshot = new RestorableValueSnapshot()
  let reads = 0
  let writes = 0
  await snapshot.capture(async () => {
    reads += 1
    return 0.35
  })
  await snapshot.capture(async () => {
    reads += 1
    return 1
  })

  await assert.rejects(
    snapshot.restore(async () => {
      writes += 1
      throw new Error('restore failed')
    }),
    /restore failed/
  )
  assert.equal(snapshot.hasValue, true)
  await snapshot.restore(async (value) => {
    writes += 1
    assert.equal(value, 0.35)
  })

  assert.equal(snapshot.hasValue, false)
  assert.equal(reads, 1)
  assert.equal(writes, 2)
})
