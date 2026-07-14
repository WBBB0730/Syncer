import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_FILE_BATCH_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_TEXT_BYTES,
  PROTOCOL_VERSION,
  collisionFileName,
  commandKeySchema,
  deviceNameSchema,
  deviceUuidSchema,
  deviceWhitelistSchema,
  encodeUdpMessage,
  fileNameSchema,
  isRelevantDiscoveryHello,
  parseUdpMessage,
  parseTcpJsonMessage,
  tcpFileOfferSchema,
  tcpHandshakeMessageSchema,
  tcpSessionMessageSchema,
  udpDiscoverSchema,
  udpHelloSchema
} from '@syncer/protocol'

const CALLER_UUID = '00000000-0000-4000-8000-000000000001'
const TARGET_UUID = '00000000-0000-4000-8000-000000000002'

test('handshake schemas require protocol version and target identity', () => {
  assert.equal(PROTOCOL_VERSION, 3)
  const connect = {
    type: 'connect',
    v: PROTOCOL_VERSION,
    uuid: CALLER_UUID,
    targetUuid: TARGET_UUID,
    name: 'Caller',
    device: 'desktop'
  }

  assert.deepEqual(parseTcpJsonMessage(JSON.stringify(connect)), connect)
  assert.equal(parseTcpJsonMessage(JSON.stringify({ ...connect, v: 2 })), null)
  assert.equal(parseTcpJsonMessage(JSON.stringify({ ...connect, v: undefined })), null)
  assert.equal(parseTcpJsonMessage(JSON.stringify({ ...connect, targetUuid: undefined })), null)
  assert.equal(tcpHandshakeMessageSchema.safeParse({ type: 'ping' }).success, false)
  assert.equal(
    tcpSessionMessageSchema.safeParse({
      type: 'hello',
      v: PROTOCOL_VERSION,
      uuid: CALLER_UUID,
      name: 'Peer',
      device: 'mobile'
    }).success,
    false
  )
})

test('Device identity and persisted Whitelist accept only canonical UUID keys', () => {
  assert.equal(deviceUuidSchema.safeParse(CALLER_UUID).success, true)
  for (const value of ['peer', '__proto__', 'constructor', '', `${CALLER_UUID}suffix`]) {
    assert.equal(deviceUuidSchema.safeParse(value).success, false)
  }

  assert.deepEqual(deviceWhitelistSchema.parse({ [CALLER_UUID]: true }), {
    [CALLER_UUID]: true
  })
  assert.equal(deviceWhitelistSchema.safeParse({ [CALLER_UUID]: false }).success, false)
  assert.equal(
    deviceWhitelistSchema.safeParse(JSON.parse('{"__proto__":true}')).success,
    false
  )
})

test('Device Name and discovery port reject unsafe candidate metadata', () => {
  for (const name of ['Desktop', '客厅电脑', 'Device 👩‍💻']) {
    assert.equal(deviceNameSchema.safeParse(name).success, true)
  }
  for (const name of ['', '   ', 'line\nbreak', 'spoof\u202eexe', '文'.repeat(86)]) {
    assert.equal(deviceNameSchema.safeParse(name).success, false)
  }

  const hello = {
    v: PROTOCOL_VERSION,
    type: 'hello',
    queryId: TARGET_UUID,
    uuid: CALLER_UUID,
    name: 'Caller',
    device: 'desktop',
    tcpPort: 57_43,
    announce: false
  }
  assert.equal(udpHelloSchema.safeParse(hello).success, true)
  assert.deepEqual(parseUdpMessage(encodeUdpMessage(hello)), hello)
  for (const tcpPort of [0, 65_536, Number.MAX_SAFE_INTEGER, 1.5]) {
    assert.equal(udpHelloSchema.safeParse({ ...hello, tcpPort }).success, false)
  }
  assert.equal(udpHelloSchema.safeParse({ ...hello, queryId: undefined }).success, false)
  assert.equal(
    udpHelloSchema.safeParse({
      v: PROTOCOL_VERSION,
      type: 'hello',
      uuid: CALLER_UUID,
      name: 'Caller',
      device: 'desktop',
      tcpPort: 57_43,
      announce: true
    }).success,
    true
  )
  assert.equal(
    udpHelloSchema.safeParse({
      v: PROTOCOL_VERSION,
      type: 'hello',
      queryId: TARGET_UUID,
      uuid: CALLER_UUID,
      name: 'Caller',
      device: 'desktop',
      tcpPort: 57_43,
      announce: true
    }).success,
    false
  )

  const discover = {
    v: PROTOCOL_VERSION,
    type: 'discover',
    queryId: TARGET_UUID,
    uuid: CALLER_UUID,
    name: 'Caller',
    device: 'desktop'
  }
  assert.equal(udpDiscoverSchema.safeParse(discover).success, true)
  assert.equal(udpDiscoverSchema.safeParse({ ...discover, queryId: undefined }).success, false)
})

test('Discovery accepts announcements and only the active query response', () => {
  const response = (queryId) => ({
    v: PROTOCOL_VERSION,
    type: 'hello',
    queryId,
    uuid: CALLER_UUID,
    name: 'Caller',
    device: 'desktop',
    tcpPort: 57_43,
    announce: false
  })
  const announcement = {
    v: PROTOCOL_VERSION,
    type: 'hello',
    uuid: CALLER_UUID,
    name: 'Caller',
    device: 'desktop',
    tcpPort: 57_43,
    announce: true
  }

  assert.equal(isRelevantDiscoveryHello(response(CALLER_UUID), TARGET_UUID), false)
  assert.equal(isRelevantDiscoveryHello(response(TARGET_UUID), TARGET_UUID), true)
  assert.equal(isRelevantDiscoveryHello(response(TARGET_UUID), undefined), false)
  assert.equal(isRelevantDiscoveryHello(announcement, undefined), true)
})

test('file metadata rejects duplicate ids and non-portable names', () => {
  const invalidNames = [
    '',
    '.',
    '..',
    '../secret.txt',
    'folder/file.txt',
    'folder\\file.txt',
    'CON',
    'CON .txt',
    'lpt1.log',
    'COM¹.txt',
    'com²',
    'LPT³.log',
    'trailing.',
    'trailing ',
    'bad\u0000name',
    'bad\u0085name',
    'invoice\u202Efdp.exe',
    'bad:name'
  ]
  for (const name of invalidNames) {
    assert.equal(fileNameSchema.safeParse(name).success, false, `${JSON.stringify(name)} must fail`)
  }

  for (const name of ['.env', '报告 1.txt', 'conduit.txt', 'lpt10.txt', '家庭\u200D成员.txt']) {
    assert.equal(fileNameSchema.safeParse(name).success, true, `${JSON.stringify(name)} must pass`)
  }

  assert.equal(fileNameSchema.safeParse('文'.repeat(85)).success, true)
  assert.equal(fileNameSchema.safeParse('文'.repeat(86)).success, false)

  assert.equal(
    tcpFileOfferSchema.safeParse({
      type: 'file-offer',
      files: [
        { id: 'same', name: 'one.txt', size: 1 },
        { id: 'same', name: 'two.txt', size: 2 }
      ]
    }).success,
    false
  )
})

test('file offers enforce per-file, file-count, and aggregate byte limits', () => {
  const file = (id, size = 0) => ({ id, name: `${id}.bin`, size })

  assert.equal(
    tcpFileOfferSchema.safeParse({
      type: 'file-offer',
      files: Array.from({ length: MAX_FILES_PER_BATCH }, (_, index) => file(String(index)))
    }).success,
    true
  )
  assert.equal(
    tcpFileOfferSchema.safeParse({
      type: 'file-offer',
      files: Array.from({ length: MAX_FILES_PER_BATCH + 1 }, (_, index) => file(String(index)))
    }).success,
    false
  )
  assert.equal(
    tcpFileOfferSchema.safeParse({
      type: 'file-offer',
      files: [file('oversized', MAX_FILE_BYTES + 1)]
    }).success,
    false
  )
  assert.equal(
    tcpFileOfferSchema.safeParse({
      type: 'file-offer',
      files: [file('one', MAX_FILE_BYTES), file('two', MAX_FILE_BYTES), file('three', 1)]
    }).success,
    false
  )
  assert.equal(MAX_FILE_BATCH_BYTES, MAX_FILE_BYTES * 2)
})

test('application messages enforce text and Command limits before encoding', () => {
  const commandKeys = [
    'up',
    'down',
    'left',
    'right',
    'space',
    'escape',
    'f5',
    'audio_mute',
    'audio_vol_down',
    'audio_vol_up',
    'audio_play_pause',
    'audio_prev',
    'audio_next'
  ]

  assert.deepEqual(commandKeySchema.options, commandKeys)
  for (const content of commandKeys) {
    assert.equal(tcpSessionMessageSchema.safeParse({ type: 'command', content }).success, true)
  }
  assert.equal(
    tcpSessionMessageSchema.safeParse({
      type: 'text',
      content: '文'.repeat(Math.floor(MAX_TEXT_BYTES / 3))
    }).success,
    true
  )
  assert.equal(
    tcpSessionMessageSchema.safeParse({
      type: 'text',
      content: '文'.repeat(Math.floor(MAX_TEXT_BYTES / 3) + 1)
    }).success,
    false
  )
  assert.equal(
    tcpSessionMessageSchema.safeParse({ type: 'command', content: 'unknown' }).success,
    false
  )
})

test('Find Device messages require a UUID request id', () => {
  const start = { type: 'ring', content: true, requestId: CALLER_UUID }
  const stop = { ...start, content: false }

  assert.deepEqual(parseTcpJsonMessage(JSON.stringify(start)), start)
  assert.deepEqual(parseTcpJsonMessage(JSON.stringify(stop)), stop)
  assert.equal(
    tcpSessionMessageSchema.safeParse({ type: 'ring', content: true }).success,
    false
  )
  assert.equal(
    tcpSessionMessageSchema.safeParse({ ...start, requestId: 'not-a-uuid' }).success,
    false
  )
})

test('file metadata accepts only normalized type/subtype MIME values', () => {
  const offer = (mimeType) => ({
    type: 'file-offer',
    files: [{ id: 'mime', name: 'mime.bin', size: 0, mimeType }]
  })

  for (const mimeType of ['application/pdf', 'image/svg+xml', 'application/vnd.api+json']) {
    assert.equal(tcpFileOfferSchema.safeParse(offer(mimeType)).success, true)
  }
  for (const mimeType of ['', 'text', 'text/plain; charset=utf-8', 'text / plain']) {
    assert.equal(tcpFileOfferSchema.safeParse(offer(mimeType)).success, false)
  }
})

test('collision names preserve extensions without exceeding portable UTF-8 limits', () => {
  const ascii = collisionFileName(`${'a'.repeat(251)}.txt`, 1)
  const unicode = collisionFileName(`${'文'.repeat(83)}.txt`, 12)

  assert.equal(new TextEncoder().encode(ascii).byteLength, 255)
  assert.equal(ascii.endsWith(' (1).txt'), true)
  assert.equal(new TextEncoder().encode(unicode).byteLength <= 255, true)
  assert.equal(unicode.endsWith(' (12).txt'), true)
  assert.equal(collisionFileName('.env', 1), '.env (1)')

  const spacedExtension = collisionFileName(`xx.${'a'.repeat(249)} bc`, 1)
  assert.equal(/[. ]$/.test(spacedExtension), false)
  assert.equal(fileNameSchema.safeParse(spacedExtension).success, true)
})
