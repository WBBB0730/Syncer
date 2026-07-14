import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AVAILABLE_DEVICE_TTL_MS,
  MAX_AVAILABLE_DEVICES,
  MAX_DEVICE_ENDPOINTS,
  mergeAvailableDevice,
  pruneAvailableDevices,
  upsertAvailableDevices
} from '../dist/esm/index.js'

function device(index, name = `Device ${index}`, address = `192.168.1.${index + 1}`) {
  return {
    uuid: `device-${index}`,
    name,
    device: 'mobile',
    endpoints: [{ port: 53317, address }]
  }
}

test('Available Device updates preserve order and evict the least recently seen entry', () => {
  const availableDevices = new Map()
  const lastSeenAt = new Map()
  const initial = Array.from({ length: MAX_AVAILABLE_DEVICES }, (_, index) => device(index))

  assert.equal(upsertAvailableDevices(availableDevices, lastSeenAt, initial, 10), true)
  assert.equal(upsertAvailableDevices(availableDevices, lastSeenAt, [device(0, 'Updated')], 20), true)

  assert.deepEqual([...availableDevices.keys()].slice(0, 2), ['device-0', 'device-1'])
  assert.equal(availableDevices.get('device-0').name, 'Updated')
  assert.equal(
    upsertAvailableDevices(availableDevices, lastSeenAt, [device(0, 'Updated')], 25),
    false
  )
  assert.equal(lastSeenAt.get('device-0'), 25)

  assert.equal(
    upsertAvailableDevices(availableDevices, lastSeenAt, [device(MAX_AVAILABLE_DEVICES)], 30),
    true
  )

  assert.equal(availableDevices.size, MAX_AVAILABLE_DEVICES)
  assert.equal(availableDevices.has('device-0'), true)
  assert.equal(availableDevices.has('device-1'), false)
  assert.equal(availableDevices.has(`device-${MAX_AVAILABLE_DEVICES}`), true)
})

test('Available Device expiry keeps entries through the exact TTL boundary', () => {
  const availableDevices = new Map()
  const lastSeenAt = new Map()

  upsertAvailableDevices(availableDevices, lastSeenAt, [device(0)], 0)
  upsertAvailableDevices(availableDevices, lastSeenAt, [device(1)], 1)

  assert.equal(
    pruneAvailableDevices(availableDevices, lastSeenAt, AVAILABLE_DEVICE_TTL_MS + 1),
    true
  )
  assert.deepEqual([...availableDevices.keys()], ['device-1'])
})

test('Available Device merges distinct Device Endpoints without duplicating a path', () => {
  const current = device(0, 'Old Name', '192.168.1.20')
  const incoming = device(0, 'Current Name', '192.168.137.20')

  assert.deepEqual(mergeAvailableDevice(current, incoming), {
    uuid: 'device-0',
    name: 'Current Name',
    device: 'mobile',
    endpoints: [
      { address: '192.168.1.20', port: 53317 },
      { address: '192.168.137.20', port: 53317 }
    ]
  })
  assert.deepEqual(mergeAvailableDevice(current, current).endpoints, current.endpoints)
})

test('Available Device bounds retained Device Endpoints', () => {
  const endpoints = Array.from({ length: MAX_DEVICE_ENDPOINTS + 2 }, (_, index) => ({
    address: `10.0.0.${index + 1}`,
    port: 53317
  }))
  const merged = mergeAvailableDevice(undefined, {
    ...device(0),
    endpoints
  })

  assert.equal(merged.endpoints.length, MAX_DEVICE_ENDPOINTS)
  assert.deepEqual(merged.endpoints, endpoints.slice(0, MAX_DEVICE_ENDPOINTS))
  assert.throws(() => mergeAvailableDevice(undefined, { ...device(0), endpoints: [] }))
})
