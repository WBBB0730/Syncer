import { randomUUID } from 'crypto'
import net from 'net'
import {
  FramedSocket,
  CONNECTION_REQUEST_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_PENDING_HANDSHAKES,
  PROTOCOL_VERSION,
  TCP_PORT,
  isIpv4Address,
  type AvailableDevice,
  type ConnectionAttemptResult,
  type DeviceEndpoint,
  type DeviceIdentity,
  type TcpHandshakeMessage
} from '@syncer/protocol'
import { DEVICE_TYPE } from '../constants'
import {
  WHITELIST_SESSION_ACCEPTED_CHANNEL,
  type WhitelistSessionAcceptedPayload
} from '../../shared/contracts'
import { appState } from '../state'
import { getStorage, STORAGE_KEYS } from '../utils/storage'
import { emit } from './emit'
import { createAvailableDeviceFromTcpIdentity } from './tcpIdentity'

type AttachSession = (
  socket: FramedSocket,
  device: AvailableDevice,
  options: { inbound: boolean }
) => void

type PresenceFailureHandler = (error: Error) => void

interface EndpointDialResult {
  readonly result: ConnectionAttemptResult
  readonly connectionRequestSent: boolean
}

let attachSession: AttachSession | null = null
let presenceFailureHandler: PresenceFailureHandler | null = null
let server: net.Server | null = null
let pendingSocket: FramedSocket | null = null
let pendingRequestId: string | null = null
let pendingTimer: NodeJS.Timeout | null = null
let sessionUpgradeInProgress = false

const handshakeTimers = new Map<FramedSocket, NodeJS.Timeout>()
const acceptedSockets = new Set<net.Socket>()
const rawSocketByFramedSocket = new Map<FramedSocket, net.Socket>()

export function bindSessionAttacher(fn: AttachSession): void {
  attachSession = fn
}

export function bindPresenceFailureHandler(fn: PresenceFailureHandler): void {
  presenceFailureHandler = fn
}

export function isSessionUpgradeInProgress(): boolean {
  return sessionUpgradeInProgress
}

function emitState(): void {
  emit('syncer:state-changed', appState.snapshot())
}

function localHello(): Extract<TcpHandshakeMessage, { type: 'hello' }> {
  return {
    type: 'hello',
    v: PROTOCOL_VERSION,
    uuid: appState.uuid,
    name: appState.name,
    device: DEVICE_TYPE
  }
}

function createFramedSocket(socket: net.Socket): FramedSocket {
  socket.setKeepAlive(true)
  socket.setNoDelay(true)
  return new FramedSocket(socket, (chunk) => {
    if (!(chunk instanceof Uint8Array)) throw new Error('TCP transport produced a non-binary chunk')
    return chunk
  })
}

function trackHandshake(socket: FramedSocket): void {
  const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS)
  handshakeTimers.set(socket, timer)
  socket.setCloseHandler(() => releaseHandshake(socket))
  socket.setErrorHandler(() => releaseHandshake(socket))
}

function releaseHandshake(socket: FramedSocket): void {
  const timer = handshakeTimers.get(socket)
  if (timer) clearTimeout(timer)
  handshakeTimers.delete(socket)
}

function clearPendingConnectionRequest(socket = pendingSocket): void {
  if (!socket || pendingSocket !== socket) return
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
  pendingSocket = null
  pendingRequestId = null
  appState.setConnectionRequest(null)
  emitState()
}

async function refuse(
  socket: FramedSocket,
  reason: Extract<TcpHandshakeMessage, { type: 'refuse' }>['reason']
): Promise<void> {
  try {
    await socket.sendJson({
      type: 'refuse',
      v: PROTOCOL_VERSION,
      uuid: appState.uuid,
      name: appState.name,
      reason
    })
  } finally {
    socket.destroy()
  }
}

function sameIdentity(
  hello: Extract<TcpHandshakeMessage, { type: 'hello' }>,
  request: Extract<TcpHandshakeMessage, { type: 'connect' }>
): boolean {
  return (
    hello.uuid === request.uuid &&
    hello.name === request.name &&
    hello.device === request.device &&
    request.targetUuid === appState.uuid
  )
}

async function upgradeToSession(
  socket: FramedSocket,
  device: AvailableDevice,
  inbound: boolean
): Promise<boolean> {
  if (!attachSession || sessionUpgradeInProgress) {
    await refuse(socket, 'busy')
    return false
  }

  sessionUpgradeInProgress = true
  releaseHandshake(socket)
  let timeout: NodeJS.Timeout | null = null
  try {
    await Promise.race([
      socket.sendJson({ type: 'accept', v: PROTOCOL_VERSION, uuid: appState.uuid }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          socket.destroy()
          reject(new Error('Session acceptance timed out'))
        }, HANDSHAKE_TIMEOUT_MS)
      })
    ])
    if (socket.destroyed) return false
    attachSession(socket, device, { inbound })
    releaseAcceptedSocket(socket)
    return true
  } finally {
    if (timeout) clearTimeout(timeout)
    sessionUpgradeInProgress = false
  }
}

async function handleInboundConnectionRequest(
  socket: FramedSocket,
  rawSocket: net.Socket,
  hello: Extract<TcpHandshakeMessage, { type: 'hello' }>,
  request: Extract<TcpHandshakeMessage, { type: 'connect' }>
): Promise<void> {
  if (!sameIdentity(hello, request)) {
    await refuse(socket, 'protocol-error')
    return
  }

  const address = rawSocket.remoteAddress?.replace(/^::ffff:/, '') ?? ''
  if (!isIpv4Address(address)) {
    await refuse(socket, 'protocol-error')
    return
  }

  const device: AvailableDevice = {
    uuid: request.uuid,
    name: request.name,
    device: request.device,
    endpoints: [{ port: TCP_PORT, address }]
  }

  if (appState.status !== 'available' || pendingSocket || sessionUpgradeInProgress) {
    await refuse(socket, 'busy')
    return
  }

  const whitelist = getStorage(STORAGE_KEYS.WHITELIST) ?? {}
  if (Object.hasOwn(whitelist, device.uuid) && whitelist[device.uuid] === true) {
    const attached = await upgradeToSession(socket, device, true)
    if (attached) {
      const payload: WhitelistSessionAcceptedPayload = { name: device.name }
      emit(WHITELIST_SESSION_ACCEPTED_CHANNEL, payload)
    }
    return
  }

  releaseHandshake(socket)
  const requestId = randomUUID()
  pendingSocket = socket
  pendingRequestId = requestId
  appState.setConnectionRequest({ requestId, device })
  socket.setCloseHandler(() => clearPendingConnectionRequest(socket))
  socket.setErrorHandler(() => clearPendingConnectionRequest(socket))
  socket.transferTo(async () => {
    await refuse(socket, 'protocol-error')
  })
  pendingTimer = setTimeout(() => {
    if (pendingSocket !== socket) return
    clearPendingConnectionRequest(socket)
    socket.destroy()
  }, CONNECTION_REQUEST_TIMEOUT_MS)
  emitState()
}

function acceptDoorConnection(rawSocket: net.Socket): void {
  acceptedSockets.add(rawSocket)
  rawSocket.once('close', () => acceptedSockets.delete(rawSocket))

  if (
    appState.status === 'connected' ||
    appState.status === 'connecting' ||
    handshakeTimers.size >= MAX_PENDING_HANDSHAKES
  ) {
    rawSocket.destroy()
    return
  }

  const socket = createFramedSocket(rawSocket)
  rawSocketByFramedSocket.set(socket, rawSocket)
  rawSocket.once('close', () => rawSocketByFramedSocket.delete(socket))
  let hello: Extract<TcpHandshakeMessage, { type: 'hello' }> | null = null
  trackHandshake(socket)

  socket.transferTo(async (frame) => {
    if (!hello && appState.status !== 'available') {
      socket.destroy()
      return
    }
    if (frame.kind !== 'json') {
      await refuse(socket, 'protocol-error')
      return
    }

    const message = frame.message
    if (!hello) {
      if (message.type !== 'hello') {
        await refuse(socket, 'protocol-error')
        return
      }
      hello = message
      await socket.sendJson(localHello())
      return
    }

    if (message.type !== 'connect') {
      await refuse(socket, 'protocol-error')
      return
    }
    await handleInboundConnectionRequest(socket, rawSocket, hello, message)
  })
}

export function startPresenceServer(): Promise<void> {
  if (server?.listening) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const nextServer = net.createServer(acceptDoorConnection)
    server = nextServer
    const handleStartupError = (error: Error): void => {
      if (server === nextServer) server = null
      reject(error)
    }
    nextServer.once('error', handleStartupError)
    nextServer.listen(TCP_PORT, () => {
      nextServer.off('error', handleStartupError)
      let failureReported = false
      const reportFailure = (error: Error): void => {
        if (server !== nextServer || failureReported) return
        failureReported = true
        presenceFailureHandler?.(error)
      }
      nextServer.on('error', reportFailure)
      nextServer.on('close', () => reportFailure(new Error('Presence server closed unexpectedly')))
      resolve()
    })
  })
}

export function stopPresenceServer(): Promise<void> {
  if (pendingSocket) {
    const socket = pendingSocket
    clearPendingConnectionRequest(socket)
    socket.destroy()
  }
  for (const socket of handshakeTimers.keys()) socket.destroy()
  for (const socket of acceptedSockets) socket.destroy()
  acceptedSockets.clear()
  rawSocketByFramedSocket.clear()

  if (!server) return Promise.resolve()
  const current = server
  server = null
  if (!current.listening) return Promise.resolve()
  current.close()
  return Promise.resolve()
}

function releaseAcceptedSocket(socket: FramedSocket): void {
  const rawSocket = rawSocketByFramedSocket.get(socket)
  if (!rawSocket) return
  rawSocketByFramedSocket.delete(socket)
  acceptedSockets.delete(rawSocket)
}

/** TCP Presence probe — exchange hello then close. */
export function probePresence(
  host: string,
  timeoutMs: number,
  options: { signal?: AbortSignal } = {}
): Promise<DeviceIdentity | null> {
  return new Promise((resolve) => {
    const rawSocket = new net.Socket()
    const socket = createFramedSocket(rawSocket)
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (value: DeviceIdentity | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(value)
    }
    const onAbort = (): void => finish(null)

    timer = setTimeout(() => finish(null), timeoutMs)
    if (options.signal?.aborted) {
      finish(null)
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    socket.setCloseHandler(() => finish(null))
    socket.setErrorHandler(() => finish(null))
    socket.transferTo((frame) => {
      if (frame.kind !== 'json' || frame.message.type !== 'hello') {
        finish(null)
        return
      }
      finish({
        uuid: frame.message.uuid,
        name: frame.message.name,
        device: frame.message.device
      })
    })

    rawSocket.connect(TCP_PORT, host, () => {
      void socket.sendJson(localHello()).catch(() => finish(null))
    })
  })
}

export async function dialAndConnect(
  device: AvailableDevice,
  options: { signal?: AbortSignal } = {}
): Promise<ConnectionAttemptResult> {
  let lastResult: ConnectionAttemptResult = 'unreachable'
  for (const endpoint of device.endpoints) {
    if (options.signal?.aborted) return 'cancelled'
    const attempt = await dialEndpoint(device, endpoint, options)
    lastResult = attempt.result
    if (
      attempt.connectionRequestSent ||
      attempt.result === 'accepted' ||
      attempt.result === 'refused' ||
      attempt.result === 'cancelled'
    ) {
      return attempt.result
    }
  }
  return lastResult
}

function dialEndpoint(
  device: AvailableDevice,
  endpoint: DeviceEndpoint,
  options: { signal?: AbortSignal }
): Promise<EndpointDialResult> {
  return new Promise((resolve) => {
    const rawSocket = new net.Socket()
    const socket = createFramedSocket(rawSocket)
    let phase: 'hello' | 'decision' = 'hello'
    let tcpDevice: AvailableDevice | null = null
    let settled = false
    let connectionRequestSent = false

    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (result: ConnectionAttemptResult, destroy = true): void => {
      if (settled) return
      settled = true
      cleanup()
      if (destroy) socket.destroy()
      resolve({ result, connectionRequestSent })
    }
    const onAbort = (): void => finish('cancelled')
    let timer = setTimeout(() => finish('timeout'), HANDSHAKE_TIMEOUT_MS)

    if (options.signal?.aborted) {
      finish('cancelled')
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    socket.setCloseHandler(() =>
      finish(options.signal?.aborted ? 'cancelled' : 'unreachable', false)
    )
    socket.setErrorHandler(() => finish(options.signal?.aborted ? 'cancelled' : 'unreachable'))
    socket.transferTo(async (frame) => {
      if (settled || frame.kind !== 'json') {
        finish('protocol-error')
        return
      }

      const message = frame.message
      if (phase === 'hello') {
        if (message.type !== 'hello') {
          finish('protocol-error')
          return
        }
        try {
          tcpDevice = createAvailableDeviceFromTcpIdentity(device, message, endpoint)
        } catch {
          finish('protocol-error')
          return
        }
        phase = 'decision'
        connectionRequestSent = true
        try {
          await socket.sendJson({
            type: 'connect',
            v: PROTOCOL_VERSION,
            uuid: appState.uuid,
            targetUuid: device.uuid,
            name: appState.name,
            device: DEVICE_TYPE
          })
        } catch {
          finish('unreachable')
          return
        }
        if (!settled) {
          clearTimeout(timer)
          timer = setTimeout(() => finish('timeout'), CONNECTION_REQUEST_TIMEOUT_MS)
        }
        return
      }

      if (!tcpDevice) {
        finish('protocol-error')
        return
      }
      if (message.type === 'accept' && message.uuid === tcpDevice.uuid && attachSession) {
        if (options.signal?.aborted) {
          finish('cancelled')
          return
        }
        settled = true
        cleanup()
        try {
          attachSession(socket, tcpDevice, { inbound: false })
          resolve({ result: 'accepted', connectionRequestSent })
        } catch (error) {
          socket.destroy()
          console.error('Failed to attach an accepted Session', error)
          resolve({ result: 'protocol-error', connectionRequestSent })
        }
        return
      }
      if (message.type === 'refuse' && message.uuid === tcpDevice.uuid) {
        finish(
          message.reason === 'rejected'
            ? 'refused'
            : message.reason === 'busy'
              ? 'busy'
              : 'protocol-error'
        )
        return
      }
      finish('protocol-error')
    })

    try {
      rawSocket.connect(endpoint.port || TCP_PORT, endpoint.address, () => {
        void socket.sendJson(localHello()).catch(() => finish('unreachable'))
      })
    } catch {
      finish('unreachable')
    }
  })
}

export async function acceptPendingConnection(requestId: string): Promise<void> {
  if (!pendingSocket || pendingRequestId !== requestId || !appState.connectionRequest) return
  const socket = pendingSocket
  const device = appState.connectionRequest.device
  clearPendingConnectionRequest(socket)
  if (appState.status !== 'available') {
    await refuse(socket, 'busy')
    return
  }
  await upgradeToSession(socket, device, true)
}

export async function refusePendingConnection(requestId: string): Promise<void> {
  if (!pendingSocket || pendingRequestId !== requestId) return
  const socket = pendingSocket
  clearPendingConnectionRequest(socket)
  await refuse(socket, 'rejected')
}
