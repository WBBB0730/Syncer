import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FrameReader,
  MAX_FRAME_BYTES,
  encodeBinaryFrame,
  encodeJsonFrame
} from '@syncer/protocol'

function concatenate(...parts) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

test('FrameReader decodes coalesced JSON and binary frames in order', () => {
  const reader = new FrameReader()
  const text = { type: 'text', content: '你好' }
  const bytes = Uint8Array.from([0, 1, 2, 255])
  const frames = reader.push(
    concatenate(encodeJsonFrame(text), encodeBinaryFrame(bytes), encodeJsonFrame({ type: 'ping' }))
  )

  assert.deepEqual(frames, [
    { kind: 'json', message: text },
    { kind: 'binary', data: bytes },
    { kind: 'json', message: { type: 'ping' } }
  ])
})

test('FrameReader preserves frames split at every TCP byte boundary', () => {
  const reader = new FrameReader()
  const encoded = concatenate(
    encodeJsonFrame({ type: 'text', content: '分片' }),
    encodeBinaryFrame(Uint8Array.from([7, 8, 9]))
  )
  const frames = []

  for (const byte of encoded) frames.push(...reader.push(Uint8Array.of(byte)))

  assert.deepEqual(frames, [
    { kind: 'json', message: { type: 'text', content: '分片' } },
    { kind: 'binary', data: Uint8Array.from([7, 8, 9]) }
  ])
})

test('FrameReader assembles a large frame from single-byte TCP chunks without repeated buffering', () => {
  const reader = new FrameReader()
  const bytes = new Uint8Array(256 * 1024)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  const encoded = encodeBinaryFrame(bytes)
  const frames = []

  for (const byte of encoded) frames.push(...reader.push(Uint8Array.of(byte)))

  assert.deepEqual(frames, [{ kind: 'binary', data: bytes }])
})

test('FrameReader rejects malformed and oversized frames', () => {
  const malformed = encodeJsonFrame({ type: 'ping' })
  malformed[4] = 99
  assert.deepEqual(new FrameReader().push(malformed), [{ kind: 'invalid' }])

  const oversizedHeader = new Uint8Array(4)
  new DataView(oversizedHeader.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false)
  assert.deepEqual(new FrameReader().push(oversizedHeader), [{ kind: 'invalid' }])

  const invalidUtf8 = Uint8Array.of(0, 0, 0, 2, 0, 0xff)
  assert.deepEqual(new FrameReader().push(invalidUtf8), [{ kind: 'invalid' }])

  const emptyBinary = Uint8Array.of(0, 0, 0, 1, 1)
  assert.deepEqual(new FrameReader().push(emptyBinary), [{ kind: 'invalid' }])
})

test('frame encoders never produce frames rejected by the configured size limit', () => {
  assert.throws(() => encodeBinaryFrame(new Uint8Array()), /at least one byte/)
  assert.throws(() => encodeBinaryFrame(new Uint8Array(MAX_FRAME_BYTES)), /Frame exceeds/)
  assert.throws(() => encodeJsonFrame({ type: 'command', content: 'unknown' }))
})
