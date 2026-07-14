/**
 * Localhost smoke: Presence handshake + Session text + heartbeat.
 * Run: node scripts/smoke-session.mjs
 */
import dgram from 'dgram'
import net from 'net'

import {
  FramedSocket,
  PROTOCOL_VERSION,
  SessionChannel,
  TCP_PORT,
  UDP_PORT,
  encodeUdpMessage,
  isSessionMessage,
  parseUdpMessage
} from '@syncer/protocol'

const PORT_B_TCP = 15744
const PORT_UDP = 15742
const QUERY_ID = '00000000-0000-4000-8000-000000000003'

function createFramedSocket(socket) {
  return new FramedSocket(socket, (chunk) => {
    if (!(chunk instanceof Uint8Array)) throw new Error('Expected a TCP byte chunk')
    return chunk
  })
}

function deferred() {
  let settled = false
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve(value) {
      if (settled) return
      settled = true
      resolvePromise(value)
    },
    reject(error) {
      if (settled) return
      settled = true
      rejectPromise(error)
    }
  }
}

async function withTimeout(promise, label, timeoutMs = 2_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function listenPresence({ port, uuid, name, onConnect }) {
  const server = net.createServer((socket) => {
    const channel = createFramedSocket(socket)
    let peer = null

    channel.setErrorHandler(() => {})
    channel.transferTo(async (frame) => {
      if (frame.kind !== 'json') throw new Error('Expected a JSON handshake frame')
      const message = frame.message

      if (message.type === 'hello') {
        if (peer) throw new Error('Duplicate hello')
        peer = message
        await channel.sendJson({
          type: 'hello',
          v: PROTOCOL_VERSION,
          uuid,
          name,
          device: 'desktop'
        })
        return
      }

      if (message.type === 'connect') {
        if (
          !peer ||
          message.targetUuid !== uuid ||
          message.uuid !== peer.uuid ||
          message.name !== peer.name ||
          message.device !== peer.device
        ) {
          throw new Error('Connect identity does not match hello')
        }
        await channel.sendJson({ type: 'accept', v: PROTOCOL_VERSION, uuid })
        onConnect(channel, message)
        return
      }

      throw new Error(`Unexpected handshake message: ${message.type}`)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })
}

function dial({ host, port, self, peerUuid }) {
  return new Promise((resolve, reject) => {
    const channel = createFramedSocket(net.connect({ host, port }))
    let remoteHello = null
    let settled = false

    const timer = setTimeout(() => finish(new Error('TCP handshake timeout')), 2_000)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        channel.destroy()
        reject(error)
      } else {
        resolve(value)
      }
    }

    channel.setErrorHandler((error) => finish(error))
    channel.setCloseHandler(() => finish(new Error('Socket closed during handshake')))
    channel.transferTo(async (frame) => {
      if (frame.kind !== 'json') throw new Error('Expected a JSON handshake frame')
      const message = frame.message

      if (message.type === 'hello') {
        if (remoteHello || message.uuid !== peerUuid) throw new Error('Unexpected peer hello')
        remoteHello = message
        await channel.sendJson({
          type: 'connect',
          v: PROTOCOL_VERSION,
          uuid: self.uuid,
          targetUuid: peerUuid,
          name: self.name,
          device: self.device
        })
        return
      }

      if (message.type === 'accept') {
        if (!remoteHello || message.uuid !== peerUuid) throw new Error('Unexpected accept')
        channel.suspend()
        finish(null, channel)
        return
      }

      if (message.type === 'refuse') throw new Error(`Connection refused: ${message.reason ?? 'unknown'}`)
      throw new Error(`Unexpected handshake message: ${message.type}`)
    })

    channel.sendJson({
      type: 'hello',
      v: PROTOCOL_VERSION,
      uuid: self.uuid,
      name: self.name,
      device: self.device
    }).catch((error) => finish(error))
  })
}

async function main() {
  const UUID_A = '00000000-0000-4000-8000-00000000000a'
  const UUID_B = '00000000-0000-4000-8000-00000000000b'
  let sessionB = null
  const textReceived = deferred()
  const pongReceived = deferred()

  const serverB = await listenPresence({
    port: PORT_B_TCP,
    uuid: UUID_B,
    name: 'B',
    onConnect: (channel) => {
      sessionB = new SessionChannel(channel, {
        onMessage(message) {
          if (message.type === 'text' && message.content === 'hello-vnext') {
            textReceived.resolve()
          }
        },
        onFileOffer() {},
        onFileBegin() {},
        onFileChunk() {},
        onFileEnd() {},
        onFileBatchEnd() {},
        onRemoteDisconnect() {},
        onClose() {
          textReceived.reject(new Error('Session closed before text arrived'))
        },
        onError(error) {
          textReceived.reject(error)
        }
      })
    }
  })

  const udp = dgram.createSocket('udp4')
  await new Promise((resolve) => udp.bind(PORT_UDP, '127.0.0.1', resolve))
  udp.on('message', (message, remote) => {
    const data = parseUdpMessage(message.toString('utf8'))
    if (data?.type !== 'discover') return
    udp.send(
      Buffer.from(
        encodeUdpMessage({
          v: PROTOCOL_VERSION,
          type: 'hello',
          queryId: data.queryId,
          uuid: UUID_B,
          name: 'B',
          device: 'desktop',
          tcpPort: PORT_B_TCP,
          announce: false
        })
      ),
      remote.port,
      remote.address
    )
  })

  const discoverer = dgram.createSocket('udp4')
  const hello = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UDP discovery timeout')), 2_000)
    discoverer.bind(() => {
      discoverer.on('message', (message) => {
        const data = parseUdpMessage(message.toString('utf8'))
        if (data?.type !== 'hello' || data.announce || data.queryId !== QUERY_ID) return
        clearTimeout(timer)
        resolve(data)
      })
      discoverer.send(
        Buffer.from(
          encodeUdpMessage({
            v: PROTOCOL_VERSION,
            type: 'discover',
            queryId: QUERY_ID,
            uuid: UUID_A,
            name: 'A',
            device: 'mobile'
          })
        ),
        PORT_UDP,
        '127.0.0.1'
      )
    })
  })

  if (hello.uuid !== UUID_B || hello.tcpPort !== PORT_B_TCP) {
    throw new Error('Unexpected UDP hello')
  }

  const channelA = await dial({
    host: '127.0.0.1',
    port: PORT_B_TCP,
    self: { uuid: UUID_A, name: 'A', device: 'mobile' },
    peerUuid: UUID_B
  })
  channelA.setErrorHandler((error) => pongReceived.reject(error))
  channelA.setCloseHandler(() => pongReceived.reject(new Error('Session closed before pong arrived')))
  channelA.transferTo(async (frame) => {
    if (frame.kind !== 'json' || !isSessionMessage(frame.message)) {
      throw new Error('Unexpected Session frame')
    }
    if (frame.message.type === 'ping') {
      await channelA.sendJson({ type: 'pong' })
    } else if (frame.message.type === 'pong') {
      pongReceived.resolve()
    }
  })
  channelA.resume()

  await channelA.sendJson({ type: 'text', content: 'hello-vnext' })
  await channelA.sendJson({ type: 'ping' })
  await withTimeout(Promise.all([textReceived.promise, pongReceived.promise]), 'Session smoke')
  if (!sessionB || channelA.destroyed || sessionB.closed) throw new Error('Session closed unexpectedly')

  console.log('SMOKE OK', {
    protocol: PROTOCOL_VERSION,
    udpHello: hello.name,
    text: true,
    heartbeat: true,
    ports: { PORT_B_TCP, PORT_UDP, TCP_PORT, UDP_PORT }
  })

  channelA.destroy()
  sessionB.destroy()
  serverB.close()
  udp.close()
  discoverer.close()
}

main().catch((error) => {
  console.error('SMOKE FAIL', error)
  process.exit(1)
})
