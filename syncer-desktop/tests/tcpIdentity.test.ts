import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AvailableDevice } from '@syncer/protocol'
import { createAvailableDeviceFromTcpIdentity } from '../src/main/services/tcpIdentity'

const DEVICE_UUID = '26f42d20-75b6-46a0-bfb2-3af7331a5ed2'

test('TCP hello identity replaces candidate metadata and prioritizes the verified Device Endpoint', () => {
  const candidate: AvailableDevice = {
    uuid: DEVICE_UUID,
    name: 'Stale Device Name',
    device: 'desktop',
    endpoints: [
      { address: '192.168.137.20', port: 6000 },
      { address: '192.168.1.20', port: 6000 }
    ]
  }
  const endpoint = candidate.endpoints[1]
  assert.deepEqual(
    createAvailableDeviceFromTcpIdentity(
      candidate,
      {
        uuid: DEVICE_UUID,
        name: 'Current Device Name',
        device: 'mobile'
      },
      endpoint
    ),
    {
      uuid: DEVICE_UUID,
      name: 'Current Device Name',
      device: 'mobile',
      endpoints: [endpoint, candidate.endpoints[0]]
    }
  )
})

test('TCP hello UUID must match the Available Device candidate', () => {
  const candidate: AvailableDevice = {
    uuid: DEVICE_UUID,
    name: 'Device',
    device: 'desktop',
    endpoints: [{ address: '192.168.1.20', port: 6000 }]
  }
  assert.throws(() =>
    createAvailableDeviceFromTcpIdentity(
      candidate,
      {
        uuid: '21b270a7-8951-4961-b5f6-9aa9f6dcaf7a',
        name: 'Other Device',
        device: 'mobile'
      },
      candidate.endpoints[0]
    )
  )
})

test('TCP Device Endpoint must belong to the Available Device candidate', () => {
  const candidate: AvailableDevice = {
    uuid: DEVICE_UUID,
    name: 'Device',
    device: 'desktop',
    endpoints: [{ address: '192.168.1.20', port: 6000 }]
  }
  assert.throws(() =>
    createAvailableDeviceFromTcpIdentity(
      candidate,
      { uuid: DEVICE_UUID, name: 'Device', device: 'desktop' },
      { address: '192.168.137.20', port: 6000 }
    )
  )
})
