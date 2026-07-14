import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  FrameReader,
  FramedSocket,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  SessionChannel,
  SUBNET_PROBE_TIMEOUT_MS,
  TCP_PORT,
  UDP_PORT,
  encodeUdpMessage,
  parseUdpMessage,
  type CommandKey,
  type DeviceIdentity,
  type SessionChannelHandlers,
  type TcpHandshakeMessage,
  type UdpHello
} from '@syncer/protocol'
import { app } from 'electron'
import type { ReceivedFileBatch } from '../src/shared/contracts.js'
import type { SessionRuntime } from '../src/main/services/session.js'

const TEST_TIMEOUT_MS = 5_000
const HEARTBEAT_TEST_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS + TEST_TIMEOUT_MS
const SUCCESS_MARKER = 'SYNCER_NETWORK_INTEGRATION_OK'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly settled: boolean
  resolve(value: T): void
  reject(reason: unknown): void
}

type HandshakeDecision = Extract<TcpHandshakeMessage, { type: 'accept' | 'refuse' }>
type UdpHelloResponse = Extract<UdpHello, { announce: false }>

interface PeerConnection {
  readonly rawSocket: net.Socket
  readonly socket: FramedSocket
  readonly decision: HandshakeDecision
}

function deferred<T>(): Deferred<T> {
  let settled = false
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    get settled() {
      return settled
    },
    resolve(value) {
      if (settled) return
      settled = true
      resolvePromise(value)
    },
    reject(reason) {
      if (settled) return
      settled = true
      rejectPromise(reason)
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = TEST_TIMEOUT_MS
): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = TEST_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} timed out`)
    await delay(20)
  }
}

function createFramedSocket(rawSocket: net.Socket): FramedSocket {
  rawSocket.setKeepAlive(true)
  rawSocket.setNoDelay(true)
  return new FramedSocket(rawSocket, (chunk) => {
    if (!(chunk instanceof Uint8Array)) throw new Error('TCP peer received non-binary data')
    return chunk
  })
}

async function discover(identity: DeviceIdentity): Promise<UdpHelloResponse> {
  const socket = dgram.createSocket('udp4')
  const response = deferred<UdpHelloResponse>()
  const queryId = randomUUID()
  let bound = false
  socket.on('message', (message) => {
    const parsed = parseUdpMessage(message.toString('utf8'))
    if (parsed?.type === 'hello' && !parsed.announce && parsed.queryId === queryId) {
      response.resolve(parsed)
    }
  })
  socket.on('error', (error) => response.reject(error))

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      socket.once('error', onError)
      socket.bind(0, '127.0.0.1', () => {
        bound = true
        socket.off('error', onError)
        resolve()
      })
    })
    const payload = Buffer.from(
      encodeUdpMessage({
        v: PROTOCOL_VERSION,
        type: 'discover',
        queryId,
        ...identity
      }),
      'utf8'
    )
    await new Promise<void>((resolve, reject) => {
      socket.send(payload, UDP_PORT, '127.0.0.1', (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    return await withTimeout(response.promise, 'Discovery reply')
  } finally {
    if (bound) await new Promise<void>((resolve) => socket.close(() => resolve()))
  }
}

async function connectPeer(identity: DeviceIdentity, targetUuid: string): Promise<PeerConnection> {
  const rawSocket = new net.Socket()
  const socket = createFramedSocket(rawSocket)
  const decision = deferred<HandshakeDecision>()
  let receivedHello = false

  const fail = (error: unknown): void => {
    decision.reject(error)
    socket.destroy()
  }
  socket.setErrorHandler(fail)
  socket.setCloseHandler(() => {
    if (!decision.settled) fail(new Error('Presence connection closed before a decision'))
  })
  socket.transferTo(async (frame) => {
    if (frame.kind !== 'json') {
      fail(new Error('Presence returned a non-JSON handshake frame'))
      return
    }

    if (!receivedHello) {
      if (frame.message.type !== 'hello' || frame.message.uuid !== targetUuid) {
        fail(new Error('Presence returned an unexpected hello identity'))
        return
      }
      receivedHello = true
      await socket.sendJson({
        type: 'connect',
        v: PROTOCOL_VERSION,
        ...identity,
        targetUuid
      })
      return
    }

    if (frame.message.type !== 'accept' && frame.message.type !== 'refuse') {
      fail(new Error(`Presence returned an unexpected ${frame.message.type} decision`))
      return
    }
    if (frame.message.type === 'accept') socket.suspend()
    decision.resolve(frame.message)
  })

  rawSocket.connect(TCP_PORT, '127.0.0.1', () => {
    void socket.sendJson({ type: 'hello', v: PROTOCOL_VERSION, ...identity }).catch(fail)
  })

  try {
    return {
      rawSocket,
      socket,
      decision: await withTimeout(decision.promise, 'Presence handshake')
    }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function sessionHandlers(
  onMessage: SessionChannelHandlers['onMessage'],
  errors: Error[],
  options: { onRemoteDisconnect?: () => void; onClose?: () => void } = {}
): SessionChannelHandlers {
  const unexpected = (event: string): void => {
    errors.push(new Error(`Unexpected ${event} during the peer Session test`))
  }
  return {
    onMessage,
    onFileOffer: () => unexpected('File Transfer offer'),
    onFileBegin: () => unexpected('File Transfer begin'),
    onFileChunk: () => unexpected('File Transfer chunk'),
    onFileEnd: () => unexpected('File Transfer end'),
    onFileBatchEnd: () => unexpected('File Transfer completion'),
    onRemoteDisconnect: () => options.onRemoteDisconnect?.(),
    onClose: () => options.onClose?.(),
    onError: (error) => errors.push(error)
  }
}

async function runIntegration(): Promise<void> {
  const userData = process.env.SYNCER_NETWORK_TEST_USER_DATA
  if (!userData) throw new Error('Network integration userData path is not configured')
  const peerSockets = new Set<FramedSocket>()
  const channels = new Set<SessionChannel>()
  let discoveryStarted = false
  let presenceStarted = false
  let stopDiscovery: (() => Promise<void>) | null = null
  let stopPresenceServer: (() => Promise<void>) | null = null
  let shutdownSession: (() => Promise<void>) | null = null
  let failure: unknown = null

  try {
    app.setPath('userData', userData)
    await app.whenReady()

    const storage = await import('../src/main/utils/storage.js')
    storage.initializeStorage({
      name: null,
      uuid: null,
      whitelist: null,
      receiveHistory: null,
      filePath: null
    })
    const state = await import('../src/main/state.js')
    const appState = state.initializeAppState()
    const presence = await import('../src/main/services/presence.js')
    const discoveryService = await import('../src/main/services/discovery.js')
    const sessionService = await import('../src/main/services/session.js')
    stopDiscovery = discoveryService.stopDiscovery
    stopPresenceServer = presence.stopPresenceServer
    shutdownSession = sessionService.shutdownSession
    await sessionService.initializeSessionStorage()

    const trustedPeer: DeviceIdentity = {
      uuid: randomUUID(),
      name: 'Trusted Mobile',
      device: 'mobile'
    }
    const rejectedPeer: DeviceIdentity = {
      uuid: randomUUID(),
      name: 'Rejected Mobile',
      device: 'mobile'
    }
    storage.setStorage(storage.STORAGE_KEYS.WHITELIST, { [trustedPeer.uuid]: true })

    const sessionErrors: Error[] = []
    const serverAttached = deferred<void>()
    const serverText = deferred<string>()
    const peerText = deferred<string>()
    const staleFindDeviceBarrier = deferred<void>()
    const commandReceived = deferred<CommandKey>()
    const commandAfterFailure = deferred<CommandKey>()
    const fileReceived = deferred<ReceivedFileBatch>()
    const connectionLost = deferred<void>()
    const peerClosed = deferred<void>()
    const peerRings: Array<{ content: boolean; requestId: string }> = []
    const commandFailures: unknown[] = []
    let findDeviceStoppedCount = 0
    let connectionLostCount = 0
    let attachCount = 0

    const sessionRuntime: SessionRuntime = {
      emit(channel, payload) {
        if (channel === 'syncer:text-received') {
          const text = payload as { content?: unknown }
          assert.equal(typeof text.content, 'string')
          if (text.content === 'after-stale-find-device-stop') staleFindDeviceBarrier.resolve()
          else serverText.resolve(text.content as string)
        } else if (channel === 'syncer:file-received') {
          fileReceived.resolve(payload as ReceivedFileBatch)
        } else if (channel === 'syncer:connection-lost') {
          connectionLostCount += 1
          connectionLost.resolve()
        } else if (channel === 'syncer:command-failed') {
          commandFailures.push(payload)
        } else if (channel === 'syncer:find-device-stopped') {
          findDeviceStoppedCount += 1
        }
      },
      executeCommand(command) {
        if (command === 'audio_play_pause') {
          return {
            ok: false,
            reason: 'injection-failed',
            message: 'controlled failure'
          }
        }
        if (command === 'audio_prev') throw new Error('unexpected injection failure')
        if (command === 'audio_next') commandAfterFailure.resolve(command)
        else commandReceived.resolve(command)
        return { ok: true }
      }
    }

    const delayedProbeSockets = new Set<FramedSocket>()
    let outgoingConnectionRequests = 0
    const delayedPresenceServer = net.createServer((rawSocket) => {
      const socket = createFramedSocket(rawSocket)
      let helloSent = false
      delayedProbeSockets.add(socket)
      socket.setCloseHandler(() => delayedProbeSockets.delete(socket))
      socket.setErrorHandler(() => undefined)
      socket.transferTo(async (frame) => {
        if (frame.kind !== 'json') throw new Error('Presence test received a binary handshake')
        if (frame.message.type === 'hello' && !helloSent) {
          await delay(SUBNET_PROBE_TIMEOUT_MS + 100)
          if (!socket.destroyed) {
            helloSent = true
            await socket.sendJson({
              type: 'hello',
              v: PROTOCOL_VERSION,
              ...trustedPeer
            })
          }
          return
        }
        if (
          frame.message.type === 'connect' &&
          helloSent &&
          frame.message.targetUuid === trustedPeer.uuid
        ) {
          outgoingConnectionRequests += 1
          await socket.sendJson({
            type: 'accept',
            v: PROTOCOL_VERSION,
            uuid: trustedPeer.uuid
          })
          return
        }
        throw new Error('Presence test received an invalid handshake')
      })
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      delayedPresenceServer.once('error', onError)
      delayedPresenceServer.listen(TCP_PORT, '127.0.0.1', () => {
        delayedPresenceServer.off('error', onError)
        resolve()
      })
    })
    try {
      await withTimeout(discoveryService.searchDevices('127.0.0.1'), 'Manual Presence probe')
      assert.equal(
        appState.availableDeviceMap.get(trustedPeer.uuid)?.endpoints[0]?.address,
        '127.0.0.1'
      )

      const outgoingAttached = deferred<void>()
      presence.bindSessionAttacher((socket, device, options) => {
        assert.equal(options.inbound, false)
        assert.equal(device.uuid, trustedPeer.uuid)
        assert.equal(device.endpoints[0]?.address, '127.0.0.1')
        socket.destroy()
        outgoingAttached.resolve()
      })
      assert.equal(
        await presence.dialAndConnect({
          ...trustedPeer,
          endpoints: [
            { address: '127.0.0.2', port: TCP_PORT },
            { address: '127.0.0.1', port: TCP_PORT }
          ]
        }),
        'accepted'
      )
      await withTimeout(outgoingAttached.promise, 'Multi-endpoint outgoing Session')
      assert.equal(outgoingConnectionRequests, 1)
    } finally {
      for (const socket of delayedProbeSockets) socket.destroy()
      await new Promise<void>((resolve) => delayedPresenceServer.close(() => resolve()))
    }

    presence.bindSessionAttacher((socket, device, options) => {
      attachCount += 1
      assert.equal(options.inbound, true)
      assert.equal(device.uuid, trustedPeer.uuid)
      sessionService.attachSessionSocket(socket, device, sessionRuntime)
      serverAttached.resolve()
    })

    await presence.startPresenceServer()
    presenceStarted = true
    await discoveryService.startDiscovery()
    discoveryStarted = true

    const hello = await discover(trustedPeer)
    assert.equal(hello.uuid, appState.uuid)
    assert.equal(hello.name, appState.name)
    assert.equal(hello.device, 'desktop')
    assert.equal(hello.tcpPort, TCP_PORT)

    const trustedConnection = await connectPeer(trustedPeer, hello.uuid)
    peerSockets.add(trustedConnection.socket)
    assert.equal(trustedConnection.decision.type, 'accept')
    assert.equal(trustedConnection.decision.uuid, hello.uuid)
    assert.equal(appState.connectionRequest, null)

    const heartbeatReader = new FrameReader()
    const heartbeatFrames = new Set<'ping' | 'pong'>()
    trustedConnection.rawSocket.on('data', (chunk: Buffer) => {
      for (const frame of heartbeatReader.push(chunk)) {
        if (
          frame.kind === 'json' &&
          (frame.message.type === 'ping' || frame.message.type === 'pong')
        ) {
          heartbeatFrames.add(frame.message.type)
        }
      }
    })

    const peerChannel = new SessionChannel(
      trustedConnection.socket,
      sessionHandlers(
        (message) => {
          if (message.type === 'text') {
            peerText.resolve(message.content)
          } else if (message.type === 'ring') {
            peerRings.push({ content: message.content, requestId: message.requestId })
          } else {
            sessionErrors.push(new Error(`Unexpected ${message.type} from desktop`))
          }
        },
        sessionErrors,
        {
          onClose: () => peerClosed.resolve()
        }
      )
    )
    channels.add(peerChannel)
    await withTimeout(serverAttached.promise, 'Whitelist auto-accept')
    assert.equal(attachCount, 1)
    assert.equal(appState.status, 'connected')
    assert.equal(appState.target?.uuid, trustedPeer.uuid)
    assert.equal(await presence.probePresence('127.0.0.1', 300), null)

    await presence.stopPresenceServer()
    presenceStarted = false
    await presence.startPresenceServer()
    presenceStarted = true
    assert.equal(trustedConnection.rawSocket.destroyed, false)

    await discoveryService.stopDiscovery()
    discoveryStarted = false
    await discoveryService.startDiscovery()
    discoveryStarted = true

    await Promise.all([
      sessionService.sendText('from desktop'),
      peerChannel.send({ type: 'text', content: 'from peer' })
    ])
    assert.equal(await withTimeout(peerText.promise, 'Desktop-to-peer text'), 'from desktop')
    assert.equal(await withTimeout(serverText.promise, 'Peer-to-desktop text'), 'from peer')

    await peerChannel.send({ type: 'command', content: 'f5' })
    assert.equal(await withTimeout(commandReceived.promise, 'Desktop Command'), 'f5')

    await peerChannel.send({ type: 'command', content: 'audio_play_pause' })
    await waitFor(() => commandFailures.length === 1, 'controlled Command failure')
    assert.deepEqual(commandFailures[0], {
      command: 'audio_play_pause',
      reason: 'injection-failed',
      message: 'controlled failure'
    })
    assert.equal(trustedConnection.rawSocket.destroyed, false)

    await peerChannel.send({ type: 'command', content: 'audio_prev' })
    await waitFor(() => commandFailures.length === 2, 'unexpected Command failure')
    assert.deepEqual(commandFailures[1], {
      command: 'audio_prev',
      reason: 'injection-failed',
      message: '桌面端执行 Command 失败'
    })
    assert.equal(trustedConnection.rawSocket.destroyed, false)

    await peerChannel.send({ type: 'command', content: 'audio_next' })
    assert.equal(
      await withTimeout(commandAfterFailure.promise, 'Command after failure'),
      'audio_next'
    )

    await sessionService.setFindDeviceActive(true)
    await sessionService.setFindDeviceActive(false)
    await waitFor(() => peerRings.length === 2, 'Find Device messages')
    assert.deepEqual(
      peerRings.map(({ content }) => content),
      [true, false]
    )
    assert.equal(peerRings[0].requestId, peerRings[1].requestId)
    assert.equal(findDeviceStoppedCount, 0)

    await sessionService.setFindDeviceActive(true)
    await waitFor(() => peerRings.length === 3, 'second Find Device message')
    const currentRequestId = peerRings[2].requestId
    assert.notEqual(currentRequestId, peerRings[0].requestId)
    await peerChannel.send({
      type: 'ring',
      content: false,
      requestId: peerRings[0].requestId
    })
    await peerChannel.send({ type: 'text', content: 'after-stale-find-device-stop' })
    await withTimeout(staleFindDeviceBarrier.promise, 'Stale Find Device stop barrier')
    assert.equal(findDeviceStoppedCount, 0)
    await peerChannel.send({ type: 'ring', content: false, requestId: currentRequestId })
    await waitFor(() => findDeviceStoppedCount === 1, 'remote Find Device stop')
    assert.equal(trustedConnection.rawSocket.destroyed, false)

    const fileContent = Buffer.from('production-session-file')
    await peerChannel.sendFileBatch([
      {
        id: randomUUID(),
        name: 'integration.txt',
        size: fileContent.byteLength,
        mimeType: 'text/plain',
        chunks: async function* () {
          yield fileContent.subarray(0, 7)
          yield fileContent.subarray(7)
        }
      }
    ])
    const receivedBatch = await withTimeout(fileReceived.promise, 'Production File Transfer')
    assert.deepEqual(receivedBatch.content, [
      { name: 'integration.txt', size: fileContent.byteLength }
    ])
    assert.deepEqual(await sessionService.getPendingReceivedFiles(), [receivedBatch])
    await sessionService.discardReceivedFiles(receivedBatch.receiptId)
    assert.deepEqual(await sessionService.getPendingReceivedFiles(), [])

    await waitFor(
      () => heartbeatFrames.has('ping') && heartbeatFrames.has('pong'),
      'Session heartbeat',
      HEARTBEAT_TEST_TIMEOUT_MS
    )
    assert.deepEqual([...heartbeatFrames].sort(), ['ping', 'pong'])
    assert.deepEqual(sessionErrors, [])

    trustedConnection.rawSocket.destroy()
    await withTimeout(peerClosed.promise, 'Unexpected peer close')
    await withTimeout(connectionLost.promise, 'Unexpected disconnect signal')
    await waitFor(() => appState.status === 'available', 'Unexpected disconnect recovery')
    assert.equal(appState.target, null)
    assert.equal(connectionLostCount, 1)

    const trustedConnection2 = await connectPeer(trustedPeer, hello.uuid)
    peerSockets.add(trustedConnection2.socket)
    assert.equal(trustedConnection2.decision.type, 'accept')
    await waitFor(
      () => attachCount === 2 && appState.status === 'connected',
      'Second Session attach'
    )
    const peerDisconnected = deferred<void>()
    const peerClosed2 = deferred<void>()
    const peerChannel2 = new SessionChannel(
      trustedConnection2.socket,
      sessionHandlers(() => {}, sessionErrors, {
        onRemoteDisconnect: () => peerDisconnected.resolve(),
        onClose: () => peerClosed2.resolve()
      })
    )
    channels.add(peerChannel2)
    await sessionService.disconnectSession()
    await withTimeout(peerDisconnected.promise, 'Intentional disconnect notification')
    await withTimeout(peerClosed2.promise, 'Intentional disconnect close')
    assert.equal(appState.status, 'available')
    assert.equal(connectionLostCount, 1)

    await discoveryService.stopDiscovery()
    discoveryStarted = false
    await discoveryService.startDiscovery()
    discoveryStarted = true
    assert.equal((await discover(trustedPeer)).uuid, appState.uuid)

    const rejectedConnectionPromise = connectPeer(rejectedPeer, hello.uuid)
    await waitFor(
      () => appState.snapshot().connectionRequest?.device.uuid === rejectedPeer.uuid,
      'Connection Request'
    )
    const requestId = appState.snapshot().connectionRequest?.requestId
    assert.ok(requestId)
    await presence.refusePendingConnection(requestId)
    const rejectedConnection = await rejectedConnectionPromise
    peerSockets.add(rejectedConnection.socket)
    assert.equal(rejectedConnection.decision.type, 'refuse')
    if (rejectedConnection.decision.type === 'refuse') {
      assert.equal(rejectedConnection.decision.uuid, hello.uuid)
      assert.equal(rejectedConnection.decision.reason, 'rejected')
    }
    assert.equal(appState.connectionRequest, null)
    assert.equal(attachCount, 2)
    assert.deepEqual(sessionErrors, [])
  } catch (error) {
    failure = error
  } finally {
    for (const channel of channels) channel.destroy()
    for (const socket of peerSockets) socket.destroy()

    const cleanup: Promise<unknown>[] = []
    if (discoveryStarted && stopDiscovery) cleanup.push(stopDiscovery())
    if (presenceStarted && stopPresenceServer) cleanup.push(stopPresenceServer())
    if (shutdownSession) cleanup.push(shutdownSession())
    const cleanupResults = await Promise.allSettled(cleanup)
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )
    if (cleanupErrors.length > 0) {
      failure = failure
        ? new AggregateError([failure, ...cleanupErrors], 'Network integration and cleanup failed')
        : new AggregateError(cleanupErrors, 'Network integration cleanup failed')
    }
  }

  if (failure) throw failure
}

void runIntegration().then(
  () => {
    console.log(SUCCESS_MARKER)
    app.exit(0)
  },
  (error) => {
    console.error(error)
    app.exit(1)
  }
)
