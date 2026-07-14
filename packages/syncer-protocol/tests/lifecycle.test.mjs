import assert from 'node:assert/strict'
import test from 'node:test'

import { RestartableRuntime, transitionSessionStatus } from '@syncer/protocol'

const validTransitions = [
  ['available', 'start-connection', 'connecting'],
  ['available', 'attach-session', 'connected'],
  ['available', 'settle-available', 'available'],
  ['connecting', 'attach-session', 'connected'],
  ['connecting', 'settle-available', 'available'],
  ['connected', 'settle-available', 'available']
]

test('Session lifecycle accepts the complete cross-platform transition table', () => {
  for (const [status, event, expected] of validTransitions) {
    assert.equal(transitionSessionStatus(status, event), expected)
  }
})

test('Session lifecycle rejects transitions outside the state machine', () => {
  assert.throws(
    () => transitionSessionStatus('connected', 'start-connection'),
    /Invalid Session lifecycle transition/
  )
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('RestartableRuntime replaces a startup generation invalidated while it is pending', async () => {
  const firstStartup = deferred()
  const events = []
  let starts = 0
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
      events.push(`start-${starts}`)
      if (starts === 1) await firstStartup.promise
    },
    async stop() {
      events.push('stop')
    }
  })

  const initial = runtime.ensureRunning()
  await new Promise((resolve) => setImmediate(resolve))
  const recovery = runtime.restart()
  firstStartup.resolve()
  await Promise.all([initial, recovery])

  assert.equal(runtime.isRunning, true)
  assert.deepEqual(events, ['stop', 'start-1', 'stop', 'start-2'])
})

test('RestartableRuntime coalesces concurrent component failures into one recovery', async () => {
  const events = []
  let starts = 0
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
      events.push(`start-${starts}`)
    },
    async stop() {
      events.push('stop')
    }
  })

  await runtime.ensureRunning()
  await Promise.all([runtime.restart(), runtime.restart()])

  assert.equal(runtime.isRunning, true)
  assert.deepEqual(events, ['stop', 'start-1', 'stop', 'start-2'])
})

test('RestartableRuntime ignores failure notifications after an explicit stop', async () => {
  let starts = 0
  let stops = 0
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
    },
    async stop() {
      stops += 1
    }
  })

  await runtime.ensureRunning()
  await runtime.ensureStopped()
  await runtime.restart()

  assert.equal(runtime.isRunning, false)
  assert.equal(starts, 1)
  assert.equal(stops, 2)
})

test('RestartableRuntime cleans failed recovery and permits an explicit retry', async () => {
  let starts = 0
  let stops = 0
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
      if (starts === 2) throw new Error('restart failed')
    },
    async stop() {
      stops += 1
    }
  })

  await runtime.ensureRunning()
  await assert.rejects(runtime.restart(), /restart failed/)
  assert.equal(runtime.isRunning, false)
  await runtime.ensureRunning()

  assert.equal(runtime.isRunning, true)
  assert.equal(starts, 3)
  assert.equal(stops, 4)
})

test('RestartableRuntime persistently recovers with bounded retry delays', async () => {
  let starts = 0
  const retryDelays = []
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
      if (starts < 4 && starts > 1) throw new Error(`restart ${starts} failed`)
    },
    async stop() {}
  })

  await runtime.ensureRunning()
  await runtime.recover({
    initialRetryDelayMs: 1,
    maximumRetryDelayMs: 2,
    onError(error, nextRetryDelayMs) {
      assert.match(error.message, /restart [23] failed/)
      retryDelays.push(nextRetryDelayMs)
    }
  })

  assert.equal(runtime.isRunning, true)
  assert.equal(starts, 4)
  assert.deepEqual(retryDelays, [2, 2])
})

test('RestartableRuntime fully stops before waiting to restart after a failure', async () => {
  const events = []
  const stopped = deferred()
  let stops = 0
  const runtime = new RestartableRuntime({
    async start() {
      events.push('start')
    },
    async stop() {
      stops += 1
      events.push('stop')
      if (stops === 2) stopped.resolve()
    }
  })
  const controller = new AbortController()

  await runtime.ensureRunning()
  const recovery = runtime.recover({
    signal: controller.signal,
    initialRetryDelayMs: 1_000,
    maximumRetryDelayMs: 1_000
  })
  const stoppedBeforeBackoff = await Promise.race([
    stopped.promise.then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false)))
  ])

  assert.equal(stoppedBeforeBackoff, true)
  assert.equal(runtime.isRunning, false)
  assert.deepEqual(events, ['stop', 'start', 'stop'])
  controller.abort()
  await recovery
})

test('RestartableRuntime cancels a delayed recovery after an explicit stop', async () => {
  let starts = 0
  const runtime = new RestartableRuntime({
    async start() {
      starts += 1
    },
    async stop() {}
  })
  const controller = new AbortController()

  await runtime.ensureRunning()
  const recovery = runtime.recover({
    signal: controller.signal,
    initialRetryDelayMs: 20,
    maximumRetryDelayMs: 20
  })
  controller.abort()
  await runtime.ensureStopped()
  await recovery

  assert.equal(runtime.isRunning, false)
  assert.equal(starts, 1)
})
