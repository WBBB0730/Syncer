import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  FrameReader,
  FramedSocket,
  SessionChannel,
  StagingBudget,
  encodeBinaryFrame,
  encodeJsonFrame
} from '@syncer/protocol'

const PEER_UUID = '00000000-0000-4000-8000-000000000001'

class FakeTransport extends EventEmitter {
  destroyed = false
  paused = false
  writes = []
  writeResults = []

  write(data) {
    this.writes.push(Uint8Array.from(data))
    return this.writeResults.shift() ?? true
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
  }

  receive(...chunks) {
    for (const chunk of chunks) this.emit('data', chunk)
  }
}

function concatenate(...parts) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function decodeWrites(writes) {
  const reader = new FrameReader()
  return writes.flatMap((write) => reader.push(write))
}

async function waitFor(predicate, message = 'condition') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

function createHandlers(overrides = {}) {
  return {
    onMessage() {},
    onFileOffer() {},
    onFileBegin() {},
    onFileChunk() {},
    onFileEnd() {},
    onFileBatchEnd() {},
    onRemoteDisconnect() {},
    onClose() {},
    onError() {},
    ...overrides
  }
}

test('FramedSocket transfers ownership without adding a second data reader', async () => {
  const transport = new FakeTransport()
  const socket = new FramedSocket(transport, (chunk) => chunk)
  const handshakeMessages = []
  const sessionMessages = []
  let session

  socket.transferTo((frame) => {
    assert.equal(frame.kind, 'json')
    handshakeMessages.push(frame.message)
    session = new SessionChannel(
      socket,
      createHandlers({
        onMessage(message) {
          sessionMessages.push(message)
        }
      })
    )
  })

  transport.receive(
    concatenate(
      encodeJsonFrame({ type: 'accept', v: 2, uuid: PEER_UUID }),
      encodeJsonFrame({ type: 'text', content: 'once' })
    )
  )

  await waitFor(() => sessionMessages.length === 1, 'Session message')
  assert.equal(transport.listenerCount('data'), 1)
  assert.deepEqual(handshakeMessages, [{ type: 'accept', v: 2, uuid: PEER_UUID }])
  assert.deepEqual(sessionMessages, [{ type: 'text', content: 'once' }])

  session.destroy()
})

test('FramedSocket serializes writes until backpressure drains', async () => {
  const transport = new FakeTransport()
  transport.writeResults.push(false, true)
  const socket = new FramedSocket(transport, (chunk) => chunk)

  const first = socket.sendJson({ type: 'text', content: 'first' })
  const second = socket.sendJson({ type: 'text', content: 'second' })
  await waitFor(() => transport.writes.length === 1, 'first write')
  assert.equal(transport.writes.length, 1)

  transport.emit('drain')
  await Promise.all([first, second])

  assert.deepEqual(decodeWrites(transport.writes), [
    { kind: 'json', message: { type: 'text', content: 'first' } },
    { kind: 'json', message: { type: 'text', content: 'second' } }
  ])
  socket.destroy()
})

test('SessionChannel bounds graceful disconnect behind stalled backpressure', async () => {
  const transport = new FakeTransport()
  transport.writeResults.push(false)
  const session = new SessionChannel(
    new FramedSocket(transport, (chunk) => chunk),
    createHandlers(),
    { disconnectTimeoutMs: 10 }
  )

  const blockedWrite = session.send({ type: 'text', content: 'blocked' })
  await waitFor(() => transport.writes.length === 1, 'blocked Session write')
  await session.disconnect()

  assert.equal(transport.destroyed, true)
  await assert.rejects(blockedWrite, /closed before drain/)
})

test('SessionChannel does not mistake a suspended local scheduler for a dead peer', async () => {
  const transport = new FakeTransport()
  const session = new SessionChannel(
    new FramedSocket(transport, (chunk) => chunk),
    createHandlers(),
    { heartbeatIntervalMs: 5, heartbeatTimeoutMs: 15 }
  )

  const resumeAt = Date.now() + 25
  while (Date.now() < resumeAt) {
    // Simulate a suspended JavaScript runtime without allowing timer callbacks to run.
  }
  await waitFor(() => transport.writes.length === 1, 'first post-resume heartbeat')

  assert.equal(transport.destroyed, false)
  assert.deepEqual(decodeWrites(transport.writes), [
    { kind: 'json', message: { type: 'ping' } }
  ])
  session.destroy()
})

test('SessionChannel receives a complete multi-file batch with exact byte counts', async () => {
  const transport = new FakeTransport()
  const socket = new FramedSocket(transport, (chunk) => chunk)
  const events = []
  const errors = []
  const observedMimeTypes = []
  let completed = false
  const session = new SessionChannel(
    socket,
    createHandlers({
      onFileOffer(files) {
        events.push(['offer', files.map((file) => file.id)])
        observedMimeTypes.push(files[0].mimeType)
      },
      onFileBegin(file) {
        events.push(['begin', file.id])
        if (file.id === 'one') observedMimeTypes.push(file.mimeType)
      },
      onFileChunk(file, chunk) {
        events.push(['chunk', file.id, [...chunk]])
      },
      onFileEnd(file) {
        events.push(['end', file.id])
      },
      onFileBatchEnd(files) {
        events.push(['batch-end', files.map((file) => file.id)])
        observedMimeTypes.push(files[0].mimeType)
        completed = true
      },
      onError(error) {
        errors.push(error)
      }
    })
  )

  transport.receive(
    concatenate(
      encodeJsonFrame({
        type: 'file-offer',
        files: [
          { id: 'one', name: 'one.bin', size: 3, mimeType: 'application/octet-stream' },
          { id: 'empty', name: 'empty.bin', size: 0 }
        ]
      }),
      encodeJsonFrame({
        type: 'file-begin',
        id: 'one',
        name: 'one.bin',
        size: 3,
        mimeType: 'application/octet-stream'
      }),
      encodeBinaryFrame(Uint8Array.from([1])),
      encodeBinaryFrame(Uint8Array.from([2, 3])),
      encodeJsonFrame({ type: 'file-end', id: 'one' }),
      encodeJsonFrame({ type: 'file-begin', id: 'empty', name: 'empty.bin', size: 0 }),
      encodeJsonFrame({ type: 'file-end', id: 'empty' })
    )
  )

  await waitFor(() => completed, 'File Transfer batch')
  assert.deepEqual(errors, [])
  assert.deepEqual(observedMimeTypes, [
    'application/octet-stream',
    'application/octet-stream',
    'application/octet-stream'
  ])
  assert.deepEqual(events, [
    ['offer', ['one', 'empty']],
    ['begin', 'one'],
    ['chunk', 'one', [1]],
    ['chunk', 'one', [2, 3]],
    ['end', 'one'],
    ['begin', 'empty'],
    ['end', 'empty'],
    ['batch-end', ['one', 'empty']]
  ])
  session.destroy()
})

test('SessionChannel rejects invalid message phases and file metadata or byte counts', async (context) => {
  const offer = encodeJsonFrame({
    type: 'file-offer',
    files: [{ id: 'file', name: 'file.bin', size: 2 }]
  })
  const begin = encodeJsonFrame({ type: 'file-begin', id: 'file', name: 'file.bin', size: 2 })
  const emptyBinary = Uint8Array.of(0, 0, 0, 1, 1)
  const typedOffer = encodeJsonFrame({
    type: 'file-offer',
    files: [{ id: 'typed', name: 'typed.bin', size: 0, mimeType: 'application/octet-stream' }]
  })

  const cases = [
    {
      name: 'handshake message inside Session',
      frames: [
        encodeJsonFrame({
          type: 'hello',
          v: 2,
          uuid: PEER_UUID,
          name: 'Peer',
          device: 'desktop'
        })
      ],
      error: /Handshake message received in Session/
    },
    {
      name: 'binary before file-begin',
      frames: [offer, encodeBinaryFrame(Uint8Array.of(1))],
      error: /outside a File Transfer/
    },
    {
      name: 'file-end before declared bytes arrive',
      frames: [
        offer,
        begin,
        encodeBinaryFrame(Uint8Array.of(1)),
        encodeJsonFrame({ type: 'file-end', id: 'file' })
      ],
      error: /invalid byte count/
    },
    {
      name: 'binary exceeds declared size',
      frames: [offer, begin, encodeBinaryFrame(Uint8Array.of(1, 2, 3))],
      error: /exceeds its declared size/
    },
    {
      name: 'empty binary frame during File Transfer',
      frames: [offer, begin, emptyBinary],
      error: /Invalid Session frame/
    },
    {
      name: 'file-begin mimeType differs from offer',
      frames: [
        typedOffer,
        encodeJsonFrame({
          type: 'file-begin',
          id: 'typed',
          name: 'typed.bin',
          size: 0,
          mimeType: 'text/plain'
        })
      ],
      error: /metadata does not match its offer/
    }
  ]

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const transport = new FakeTransport()
      const socket = new FramedSocket(transport, (chunk) => chunk)
      const errors = []
      new SessionChannel(
        socket,
        createHandlers({
          onError(error) {
            errors.push(error)
          }
        })
      )

      transport.receive(concatenate(...testCase.frames))
      await waitFor(() => errors.length === 1, testCase.name)

      assert.match(errors[0].message, testCase.error)
      assert.equal(transport.destroyed, true)
    })
  }
})

test('SessionChannel validates outgoing file sizes and serializes batches', async () => {
  const transport = new FakeTransport()
  const socket = new FramedSocket(transport, (chunk) => chunk)
  const session = new SessionChannel(socket, createHandlers())
  let release
  const blockedChunk = new Promise((resolve) => {
    release = resolve
  })
  const file = {
    id: 'outgoing',
    name: 'outgoing.bin',
    size: 1,
    mimeType: 'application/octet-stream',
    async *chunks() {
      await blockedChunk
      yield Uint8Array.of(1)
    }
  }

  const first = session.sendFileBatch([file])
  await assert.rejects(session.sendFileBatch([file]), /already in progress/)
  release()
  await first

  const frames = decodeWrites(transport.writes)
  assert.deepEqual(
    frames.map((frame) => (frame.kind === 'json' ? frame.message.type : 'binary')),
    ['file-offer', 'file-begin', 'binary', 'file-end']
  )
  assert.equal(frames[0].message.files[0].mimeType, 'application/octet-stream')
  assert.equal(frames[1].message.mimeType, 'application/octet-stream')
  session.destroy()

  const emptyTransport = new FakeTransport()
  const empty = new SessionChannel(
    new FramedSocket(emptyTransport, (chunk) => chunk),
    createHandlers()
  )
  await empty.sendFileBatch([
    {
      id: 'empty',
      name: 'empty.bin',
      size: 0,
      async *chunks() {
        yield new Uint8Array()
      }
    }
  ])
  assert.deepEqual(
    decodeWrites(emptyTransport.writes).map((frame) =>
      frame.kind === 'json' ? frame.message.type : 'binary'
    ),
    ['file-offer', 'file-begin', 'file-end']
  )
  empty.destroy()

  const changedTransport = new FakeTransport()
  const changed = new SessionChannel(
    new FramedSocket(changedTransport, (chunk) => chunk),
    createHandlers()
  )
  await assert.rejects(
    changed.sendFileBatch([
      {
        id: 'changed',
        name: 'changed.bin',
        size: 2,
        async *chunks() {
          yield Uint8Array.of(1)
        }
      }
    ]),
    /size changed during transfer/
  )
  assert.equal(changedTransport.destroyed, true)
})

test('SessionChannel closes a stalled File Transfer even while other Session traffic continues', async () => {
  const transport = new FakeTransport()
  const errors = []
  new SessionChannel(
    new FramedSocket(transport, (chunk) => chunk),
    createHandlers({
      onError(error) {
        errors.push(error)
      }
    }),
    { fileTransferIdleTimeoutMs: 10 }
  )

  transport.receive(
    concatenate(
      encodeJsonFrame({
        type: 'file-offer',
        files: [{ id: 'stalled', name: 'stalled.bin', size: 1 }]
      }),
      encodeJsonFrame({ type: 'file-begin', id: 'stalled', name: 'stalled.bin', size: 1 }),
      encodeJsonFrame({ type: 'ping' })
    )
  )

  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /timed out while waiting for progress/)
  assert.equal(transport.destroyed, true)
})

test('SessionChannel ignores coalesced frames after a terminal disconnect', async () => {
  const transport = new FakeTransport()
  const messages = []
  let remoteDisconnects = 0
  new SessionChannel(
    new FramedSocket(transport, (chunk) => chunk),
    createHandlers({
      onMessage(message) {
        messages.push(message)
      },
      onRemoteDisconnect() {
        remoteDisconnects += 1
      }
    })
  )

  transport.receive(
    concatenate(
      encodeJsonFrame({ type: 'disconnect' }),
      encodeJsonFrame({ type: 'command', content: 'space' }),
      encodeJsonFrame({ type: 'text', content: 'must-not-run' })
    )
  )
  await waitFor(() => transport.destroyed, 'terminal disconnect')

  assert.equal(remoteDisconnects, 1)
  assert.deepEqual(messages, [])
})

test('StagingBudget bounds batches and bytes until their reservations are released', () => {
  const budget = new StagingBudget(2, 10)
  const first = budget.reserve(6)
  const second = budget.reserve(4)

  assert.deepEqual(budget.snapshot(), { batches: 2, bytes: 10 })
  assert.throws(() => budget.reserve(0), /staging limit exceeded/)

  first.releaseBytes(3)
  assert.deepEqual(budget.snapshot(), { batches: 2, bytes: 7 })
  second.release()
  assert.deepEqual(budget.snapshot(), { batches: 1, bytes: 3 })

  const third = budget.reserve(7)
  assert.deepEqual(budget.snapshot(), { batches: 2, bytes: 10 })
  first.release()
  third.release()
  assert.deepEqual(budget.snapshot(), { batches: 0, bytes: 0 })
  assert.throws(() => first.releaseBytes(1), /Invalid staged File Transfer release/)
})
