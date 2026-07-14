import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { TcpApplicationMessage } from '@syncer/protocol'
import { FindDeviceCoordinator } from '../src/main/services/findDevice'

type RingMessage = Extract<TcpApplicationMessage, { type: 'ring' }>

const REQUEST_A = '00000000-0000-4000-8000-000000000001'
const REQUEST_B = '00000000-0000-4000-8000-000000000002'

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('Find Device serializes concurrent starts without retaining a failed request', async () => {
  const ids = [REQUEST_A, REQUEST_B]
  const sends = [deferred(), deferred()]
  const messages: RingMessage[] = []
  const coordinator = new FindDeviceCoordinator(() => {
    const requestId = ids.shift()
    assert.ok(requestId)
    return requestId
  })
  const send = async (message: RingMessage): Promise<void> => {
    messages.push(message)
    const pending = sends[messages.length - 1]
    assert.ok(pending)
    await pending.promise
  }

  const first = coordinator.setActive(true, send)
  const second = coordinator.setActive(true, send)
  await nextTurn()
  assert.deepEqual(messages, [{ type: 'ring', content: true, requestId: REQUEST_A }])

  sends[0].reject(new Error('first send failed'))
  await assert.rejects(first, /first send failed/)
  await nextTurn()
  assert.deepEqual(messages[1], { type: 'ring', content: true, requestId: REQUEST_B })

  sends[1].reject(new Error('second send failed'))
  await assert.rejects(second, /second send failed/)
  assert.equal(coordinator.currentRequestId, null)
})

test('Find Device serializes a concurrent start and stop with the same request id', async () => {
  const coordinator = new FindDeviceCoordinator(() => REQUEST_A)
  const startSend = deferred()
  const stopSend = deferred()
  const messages: RingMessage[] = []
  const send = async (message: RingMessage): Promise<void> => {
    messages.push(message)
    await (message.content ? startSend.promise : stopSend.promise)
  }

  const start = coordinator.setActive(true, send)
  const stop = coordinator.setActive(false, send)
  await nextTurn()
  assert.deepEqual(messages, [{ type: 'ring', content: true, requestId: REQUEST_A }])

  startSend.resolve()
  await start
  await nextTurn()
  assert.deepEqual(messages[1], { type: 'ring', content: false, requestId: REQUEST_A })

  stopSend.resolve()
  await stop
  assert.equal(coordinator.currentRequestId, null)
})

test('Find Device does not resurrect a request stopped remotely during a failed local stop', async () => {
  const coordinator = new FindDeviceCoordinator(() => REQUEST_A)
  await coordinator.setActive(true, async () => undefined)
  const stopSend = deferred()
  const stop = coordinator.setActive(false, async () => stopSend.promise)
  await nextTurn()

  assert.equal(coordinator.currentRequestId, REQUEST_A)
  assert.equal(coordinator.handle({ type: 'ring', content: false, requestId: REQUEST_A }), true)
  stopSend.reject(new Error('stop send failed'))

  await assert.rejects(stop, /stop send failed/)
  assert.equal(coordinator.currentRequestId, null)
})

test('Find Device ignores stale and duplicate stop acknowledgements', async () => {
  const ids = [REQUEST_A, REQUEST_B]
  const messages: RingMessage[] = []
  const coordinator = new FindDeviceCoordinator(() => {
    const requestId = ids.shift()
    assert.ok(requestId)
    return requestId
  })
  const send = async (message: RingMessage): Promise<void> => {
    messages.push(message)
  }

  await coordinator.setActive(true, send)
  await coordinator.setActive(false, send)
  await coordinator.setActive(true, send)

  assert.equal(coordinator.currentRequestId, REQUEST_B)
  assert.equal(coordinator.handle({ type: 'ring', content: false, requestId: REQUEST_A }), false)
  assert.equal(coordinator.currentRequestId, REQUEST_B)
  assert.equal(coordinator.handle({ type: 'ring', content: false, requestId: REQUEST_B }), true)
  assert.equal(coordinator.handle({ type: 'ring', content: false, requestId: REQUEST_B }), false)
})
