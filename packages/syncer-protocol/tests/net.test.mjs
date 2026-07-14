import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HANDSHAKE_TIMEOUT_MS,
  SUBNET_PROBE_MAX_HOSTS,
  SUBNET_PROBE_TIMEOUT_MS,
  isIpv4Address,
  mapPool,
  subnetBroadcastAddress,
  subnetHosts,
  subnetHostsForNetworks
} from '@syncer/protocol'

test('single-target Presence handshake has a larger budget than subnet probing', () => {
  assert.ok(HANDSHAKE_TIMEOUT_MS > SUBNET_PROBE_TIMEOUT_MS)
})

test('isIpv4Address accepts only canonical dotted-decimal addresses', () => {
  for (const address of ['0.0.0.0', '192.168.1.10', '255.255.255.255']) {
    assert.equal(isIpv4Address(address), true)
  }
  for (const address of [
    '',
    'localhost',
    '192.168.1',
    '192.168.1.1.example',
    '999.1.1.1',
    '01.2.3.4',
    '1.2.3.4 '
  ]) {
    assert.equal(isIpv4Address(address), false)
  }
})

test('subnetHosts follows the supplied IPv4 netmask', () => {
  const hosts = subnetHosts('192.168.1.10', '255.255.254.0', SUBNET_PROBE_MAX_HOSTS)

  assert.equal(hosts.length, 509)
  assert.equal(hosts[0], '192.168.1.11')
  assert.equal(hosts.includes('192.168.0.1'), true)
  assert.equal(hosts.includes('192.168.1.10'), false)
  assert.equal(hosts.at(-1), '192.168.1.9')
})

test('subnetHosts rejects invalid addresses and non-contiguous masks', () => {
  assert.deepEqual(subnetHosts('192.168.1.10', '255.0.255.0', 10), [])
  assert.deepEqual(subnetHosts('192.168.1', '255.255.255.0', 10), [])
  assert.deepEqual(subnetHosts('192.168.1.10', '255.255.255.254', 10), [])
  assert.throws(() => subnetHosts('192.168.1.10', '255.255.255.0', -1))
})

test('subnetHosts bounds broad network probing around the local address', () => {
  const hosts = subnetHosts('10.20.30.40', '255.0.0.0', SUBNET_PROBE_MAX_HOSTS)

  assert.equal(hosts.length, SUBNET_PROBE_MAX_HOSTS)
  assert.equal(hosts[0], '10.20.30.41')
  assert.equal(hosts.at(-1), '10.20.34.40')
})

test('subnetHostsForNetworks fairly applies one global unique-host budget', () => {
  const hosts = subnetHostsForNetworks(
    [
      { address: '192.168.1.1', netmask: '255.255.255.0' },
      { address: '10.0.0.1', netmask: '255.255.255.0' }
    ],
    4
  )

  assert.deepEqual(hosts, ['192.168.1.2', '10.0.0.2', '192.168.1.3', '10.0.0.3'])
  assert.throws(() => subnetHostsForNetworks([], -1))
})

test('subnetBroadcastAddress follows non-/24 masks', () => {
  assert.equal(subnetBroadcastAddress('172.20.130.4', '255.255.0.0'), '172.20.255.255')
  assert.equal(subnetBroadcastAddress('192.168.1.4', '255.255.254.0'), '192.168.1.255')
  assert.equal(subnetBroadcastAddress('192.168.1.4', '255.0.255.0'), null)
  assert.equal(subnetBroadcastAddress('192.168.1.4', '255.255.255.255'), null)
})

test('mapPool stops dispatching work after cancellation', async () => {
  const controller = new AbortController()
  const visited = []
  const results = await mapPool(
    [1, 2, 3],
    1,
    async (value) => {
      visited.push(value)
      controller.abort()
      return value
    },
    { signal: controller.signal }
  )

  assert.deepEqual(visited, [1])
  assert.deepEqual(results, [])
})
