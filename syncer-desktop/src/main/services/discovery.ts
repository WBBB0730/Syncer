import { randomUUID } from 'crypto'
import dgram from 'dgram'
import {
  ANNOUNCE_INTERVAL_MS,
  BROADCAST_ADDRESS,
  DISCOVERY_EVENT_DEDUP_MS,
  DISCOVERY_EVENT_RATE_PER_SECOND,
  DISCOVERY_UI_FLUSH_MS,
  DISCOVER_INTERVAL_MS,
  DISCOVER_ROUNDS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_AVAILABLE_DEVICES,
  MULTICAST_GROUP,
  PROTOCOL_VERSION,
  SUBNET_PROBE_CONCURRENCY,
  SUBNET_PROBE_MAX_HOSTS,
  SUBNET_PROBE_TIMEOUT_MS,
  TCP_PORT,
  UDP_PORT,
  RecentKeyLimiter,
  TokenBucket,
  encodeUdpMessage,
  isIpv4Address,
  isRelevantDiscoveryHello,
  mapPool,
  mergeAvailableDevice,
  parseUdpMessage,
  subnetBroadcastAddress,
  subnetHostsForNetworks,
  subnetsWithoutAddresses,
  type AvailableDevice,
  type UdpHello
} from '@syncer/protocol'
import { DEVICE_TYPE } from '../constants'
import { appState } from '../state'
import { listLanIpv4Networks } from '../utils/ip'
import { emit } from './emit'
import { probePresence } from './presence'

let socket: dgram.Socket | null = null
let announceTimer: NodeJS.Timeout | null = null
let startPromise: Promise<void> | null = null
let ready = false
const multicastMemberships = new Set<string>()
let multicastSendQueue = Promise.resolve()
let candidateFlushTimer: NodeJS.Timeout | null = null
let discoveryFailureHandler: ((error: Error) => void) | null = null

interface DiscoverySearch {
  readonly queryId: string
  readonly controller: AbortController
}

let activeSearch: DiscoverySearch | null = null

const replyRate = new TokenBucket(DISCOVERY_EVENT_RATE_PER_SECOND, DISCOVERY_EVENT_RATE_PER_SECOND)
const candidateRate = new TokenBucket(
  DISCOVERY_EVENT_RATE_PER_SECOND,
  DISCOVERY_EVENT_RATE_PER_SECOND
)
const recentReplies = new RecentKeyLimiter(DISCOVERY_EVENT_DEDUP_MS, MAX_AVAILABLE_DEVICES)
const recentCandidates = new RecentKeyLimiter(DISCOVERY_EVENT_DEDUP_MS, MAX_AVAILABLE_DEVICES)
const pendingCandidates = new Map<string, AvailableDevice>()

function emitState(): void {
  emit('syncer:state-changed', appState.snapshot())
}

function toDevice(hello: UdpHello, address: string): AvailableDevice {
  return {
    uuid: hello.uuid,
    name: hello.name,
    device: hello.device,
    endpoints: [{ port: hello.tcpPort, address }]
  }
}

function remember(device: AvailableDevice, deduplicationKey = device.uuid): void {
  if (
    appState.status !== 'available' ||
    device.uuid === appState.uuid ||
    !recentCandidates.take(deduplicationKey) ||
    !candidateRate.take()
  ) {
    return
  }
  const merged = mergeAvailableDevice(pendingCandidates.get(device.uuid), device)
  if (pendingCandidates.has(device.uuid)) pendingCandidates.delete(device.uuid)
  while (pendingCandidates.size >= MAX_AVAILABLE_DEVICES) {
    const oldest = pendingCandidates.keys().next().value as string | undefined
    if (!oldest) break
    pendingCandidates.delete(oldest)
  }
  pendingCandidates.set(device.uuid, merged)
  candidateFlushTimer ??= setTimeout(flushCandidates, DISCOVERY_UI_FLUSH_MS)
}

function flushCandidates(): void {
  if (candidateFlushTimer) clearTimeout(candidateFlushTimer)
  candidateFlushTimer = null
  const devices = [...pendingCandidates.values()]
  pendingCandidates.clear()
  if (devices.length === 0) return
  appState.addAvailableDevices(devices)
  emitState()
}

function clearPendingCandidates(): void {
  if (candidateFlushTimer) clearTimeout(candidateFlushTimer)
  candidateFlushTimer = null
  pendingCandidates.clear()
}

function identityPayload(
  ...identity: [announce: true] | [announce: false, queryId: string]
): Buffer {
  const [announce] = identity
  return Buffer.from(
    encodeUdpMessage(
      announce
        ? {
            v: PROTOCOL_VERSION,
            type: 'hello',
            uuid: appState.uuid,
            name: appState.name,
            device: DEVICE_TYPE,
            tcpPort: TCP_PORT,
            announce: true
          }
        : {
            v: PROTOCOL_VERSION,
            type: 'hello',
            queryId: identity[1],
            uuid: appState.uuid,
            name: appState.name,
            device: DEVICE_TYPE,
            tcpPort: TCP_PORT,
            announce: false
          }
    ),
    'utf8'
  )
}

function discoverPayload(queryId: string): Buffer {
  return Buffer.from(
    encodeUdpMessage({
      v: PROTOCOL_VERSION,
      type: 'discover',
      queryId,
      uuid: appState.uuid,
      name: appState.name,
      device: DEVICE_TYPE
    }),
    'utf8'
  )
}

function send(buf: Buffer, port: number, address: string): Promise<void> {
  const current = socket
  if (!current || !ready) return Promise.reject(new Error('Discovery socket is not ready'))
  return sendWithSocket(current, buf, port, address)
}

function sendWithSocket(
  current: dgram.Socket,
  buf: Buffer,
  port: number,
  address: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    current.send(buf, port, address, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function refreshMulticastMemberships(
  current: dgram.Socket,
  networks: readonly { address: string }[]
): void {
  const activeInterfaces = new Set(networks.map(({ address }) => address))
  for (const address of multicastMemberships) {
    if (activeInterfaces.has(address)) continue
    try {
      current.dropMembership(MULTICAST_GROUP, address)
    } catch (error) {
      console.warn(`Failed to leave the Discovery multicast group on ${address}`, error)
    }
    multicastMemberships.delete(address)
  }

  for (const address of activeInterfaces) {
    if (multicastMemberships.has(address)) continue
    try {
      current.addMembership(MULTICAST_GROUP, address)
      multicastMemberships.add(address)
    } catch (error) {
      console.warn(`Failed to join the Discovery multicast group on ${address}`, error)
    }
  }
}

function sendMulticast(
  payload: Buffer,
  networks: readonly { address: string }[],
  operation: string
): Promise<void> {
  const interfaces = [...new Set(networks.map(({ address }) => address))]
  const task = multicastSendQueue.then(async () => {
    const current = socket
    if (!current || !ready) return
    for (const address of interfaces) {
      try {
        current.setMulticastInterface(address)
        await sendWithSocket(current, payload, UDP_PORT, MULTICAST_GROUP)
      } catch (error) {
        console.error(`${operation} on ${address} failed`, error)
      }
    }
  })
  multicastSendQueue = task.catch(() => undefined)
  return task
}

async function sendToDestinations(
  payload: Buffer,
  destinations: readonly string[],
  operation: string
): Promise<void> {
  const results = await Promise.allSettled(
    destinations.map((address) => send(payload, UDP_PORT, address))
  )
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`${operation} to ${destinations[index]} failed`, result.reason)
    }
  })
}

function broadcastDestinations(
  networks: readonly { address: string; netmask: string }[]
): string[] {
  const destinations = new Set([BROADCAST_ADDRESS])
  for (const network of networks) {
    const broadcast = subnetBroadcastAddress(network.address, network.netmask)
    if (broadcast) destinations.add(broadcast)
  }
  return [...destinations]
}

async function sendOnNetworks(
  payload: Buffer,
  networks: readonly { address: string; netmask: string }[],
  operation: string
): Promise<void> {
  const current = socket
  if (current && ready) refreshMulticastMemberships(current, networks)
  await Promise.all([
    sendToDestinations(payload, broadcastDestinations(networks), operation),
    sendMulticast(payload, networks, operation)
  ])
}

function replyHello(deviceUuid: string, queryId: string, port: number, address: string): void {
  if (
    appState.status !== 'available' ||
    !recentReplies.take(`${queryId}:${deviceUuid}@${address}`) ||
    !replyRate.take()
  ) {
    return
  }
  void send(identityPayload(false, queryId), port, address).catch((error) =>
    console.error('Failed to reply to Discovery', error)
  )
}

export function startDiscovery(): Promise<void> {
  if (ready) return Promise.resolve()
  if (startPromise) return startPromise

  const nextSocket = dgram.createSocket('udp4')
  socket = nextSocket

  nextSocket.on('message', (msg, rinfo) => {
    const data = parseUdpMessage(msg.toString('utf8'))
    if (!data || data.uuid === appState.uuid) return

    if (data.type === 'discover') {
      replyHello(data.uuid, data.queryId, rinfo.port, rinfo.address)
      return
    }

    if (data.type === 'hello' && isRelevantDiscoveryHello(data, activeSearch?.queryId)) {
      remember(
        toDevice(data, rinfo.address),
        data.announce
          ? `${data.uuid}@${rinfo.address}`
          : `${data.queryId}:${data.uuid}@${rinfo.address}`
      )
    }
  })

  const pending = new Promise<void>((resolve, reject) => {
    const failStartup = (error: Error): void => {
      nextSocket.off('error', failStartup)
      if (socket === nextSocket) socket = null
      ready = false
      multicastMemberships.clear()
      let startupError: Error = error
      try {
        nextSocket.close()
      } catch (cleanupError) {
        startupError = new AggregateError([error, cleanupError], 'Failed to initialize Discovery')
      }
      reject(startupError)
    }

    nextSocket.once('error', failStartup)
    nextSocket.bind(UDP_PORT, () => {
      try {
        nextSocket.setBroadcast(true)
      } catch (error) {
        failStartup(asError(error))
        return
      }
      try {
        nextSocket.setMulticastTTL(1)
      } catch (error) {
        console.warn('Failed to configure Discovery multicast TTL', error)
      }
      refreshMulticastMemberships(nextSocket, listLanIpv4Networks())

      nextSocket.off('error', failStartup)
      let failureReported = false
      const reportFailure = (error: Error, closeSocket: boolean): void => {
        if (socket !== nextSocket) return
        socket = null
        ready = false
        multicastMemberships.clear()
        cancelDeviceSearch()
        stopAnnounceLoop()
        let failure = error
        if (closeSocket) {
          try {
            nextSocket.close()
          } catch (cleanupError) {
            failure = new AggregateError(
              [error, cleanupError],
              'Discovery failed and its socket could not be closed'
            )
          }
        }
        if (!failureReported) {
          failureReported = true
          discoveryFailureHandler?.(failure)
        }
      }
      nextSocket.on('error', (error) => reportFailure(error, true))
      nextSocket.on('close', () =>
        reportFailure(new Error('Discovery socket closed unexpectedly'), false)
      )
      ready = true
      startAnnounceLoop()
      resolve()
    })
  })

  startPromise = pending
  const clearStartPromise = (): void => {
    if (startPromise === pending) startPromise = null
  }
  void pending.then(clearStartPromise, clearStartPromise)
  return pending
}

export function bindDiscoveryFailureHandler(handler: (error: Error) => void): void {
  discoveryFailureHandler = handler
}

function startAnnounceLoop(): void {
  stopAnnounceLoop()
  const tick = (): void => {
    if (appState.pruneAvailableDevices()) emitState()
    if (appState.status !== 'available' || !ready) return
    const buf = identityPayload(true)
    void sendOnNetworks(buf, listLanIpv4Networks(), 'Presence announcement')
  }
  tick()
  announceTimer = setInterval(tick, ANNOUNCE_INTERVAL_MS)
}

export function stopAnnounceLoop(): void {
  if (announceTimer) {
    clearInterval(announceTimer)
    announceTimer = null
  }
}

export function refreshPresenceAnnounce(): void {
  if (appState.status === 'available') startAnnounceLoop()
  else {
    cancelDeviceSearch()
    stopAnnounceLoop()
    clearPendingCandidates()
  }
}

export function cancelDeviceSearch(): void {
  activeSearch?.controller.abort()
  activeSearch = null
  clearPendingCandidates()
}

export async function searchDevices(manualIp?: string): Promise<void> {
  if (appState.status !== 'available') throw new Error('Discovery requires available status')
  if (manualIp !== undefined && !isIpv4Address(manualIp)) {
    throw new TypeError('IP address must be a valid IPv4 address')
  }
  cancelDeviceSearch()
  const search: DiscoverySearch = {
    queryId: randomUUID(),
    controller: new AbortController()
  }
  activeSearch = search
  const { controller } = search
  clearPendingCandidates()
  appState.clearAvailableDeviceMap()
  emitState()

  try {
    if (manualIp) {
      const hello = await probePresence(manualIp, HANDSHAKE_TIMEOUT_MS, {
        signal: controller.signal
      })
      if (isActiveSearch(controller) && hello && hello.uuid !== appState.uuid) {
        appState.addAvailableDevices([
          { ...hello, endpoints: [{ port: TCP_PORT, address: manualIp }] }
        ])
        emitState()
      }
      return
    }

    const buf = discoverPayload(search.queryId)
    const networks = listLanIpv4Networks()
    for (let i = 0; i < DISCOVER_ROUNDS; i++) {
      if (!isActiveSearch(controller)) return
      await sendOnNetworks(buf, networks, 'Discovery query')
      if (!(await waitForSearchInterval(controller.signal))) return
    }
    if (!isActiveSearch(controller)) return
    flushCandidates()

    // Probe each subnet that produced no UDP candidate; a response on one interface must not
    // suppress recovery on another interface.
    const discoveredAddresses = [...appState.availableDeviceMap.values()].flatMap((device) =>
      device.endpoints.map(({ address }) => address)
    )
    const probeNetworks = subnetsWithoutAddresses(networks, discoveredAddresses)
    const hosts = subnetHostsForNetworks(probeNetworks, SUBNET_PROBE_MAX_HOSTS)

    if (hosts.length > 0) {
      await mapPool(
        hosts,
        SUBNET_PROBE_CONCURRENCY,
        async (host) => {
          if (!isActiveSearch(controller)) return null
          const hello = await probePresence(host, SUBNET_PROBE_TIMEOUT_MS, {
            signal: controller.signal
          })
          if (!isActiveSearch(controller) || !hello || hello.uuid === appState.uuid) return null
          remember(
            {
              uuid: hello.uuid,
              name: hello.name,
              device: hello.device,
              endpoints: [{ port: TCP_PORT, address: host }]
            },
            `${search.queryId}:${hello.uuid}@${host}`
          )
          return hello.uuid
        },
        { signal: controller.signal }
      )
    }

    if (isActiveSearch(controller)) flushCandidates()
  } catch (error) {
    if (activeSearch === search) cancelDeviceSearch()
    throw error
  } finally {
    if (activeSearch === search) activeSearch = null
  }
}

export async function stopDiscovery(): Promise<void> {
  cancelDeviceSearch()
  stopAnnounceLoop()
  if (startPromise) {
    try {
      await startPromise
    } catch {
      return
    }
  }
  await multicastSendQueue
  const current = socket
  socket = null
  ready = false
  if (!current) return
  const cleanupErrors: unknown[] = []
  for (const address of multicastMemberships) {
    try {
      current.dropMembership(MULTICAST_GROUP, address)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  multicastMemberships.clear()
  try {
    await new Promise<void>((resolve, reject) => {
      try {
        current.close(resolve)
      } catch (error) {
        reject(error)
      }
    })
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Failed to stop Discovery')
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isActiveSearch(controller: AbortController): boolean {
  return (
    activeSearch?.controller === controller &&
    !controller.signal.aborted &&
    appState.status === 'available'
  )
}

function waitForSearchInterval(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(completed)
    }
    const onAbort = (): void => finish(false)
    const timer = setTimeout(() => finish(true), DISCOVER_INTERVAL_MS)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
