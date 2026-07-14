import {
  FILE_TRANSFER_IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  SESSION_DISCONNECT_TIMEOUT_MS
} from './constants.js'
import {
  encodeBinaryFrame,
  encodeJsonFrame,
  FrameReader,
  type DecodedFrame
} from './frame.js'
import {
  isSessionMessage,
  sameFileMetadata,
  tcpFileBeginSchema,
  tcpFileOfferSchema,
  tcpSessionMessageSchema,
  type TcpApplicationMessage,
  type TcpJsonMessage,
  type TcpSessionMessage
} from './messages.js'
import type { FileMetadata } from './types.js'

type TransportListener = (...args: unknown[]) => void

export interface FramedTransport {
  readonly destroyed?: boolean
  write(data: Uint8Array): boolean
  on(event: string, listener: TransportListener): unknown
  once(event: string, listener: TransportListener): unknown
  removeListener(event: string, listener: TransportListener): unknown
  pause?(): unknown
  resume?(): unknown
  destroy(): unknown
}

export type FrameHandler = (frame: DecodedFrame) => void | Promise<void>

export class FramedSocket {
  private readonly reader = new FrameReader()
  private readonly frames: DecodedFrame[] = []
  private frameHandler: FrameHandler | null = null
  private closeHandler: (() => void) | null = null
  private errorHandler: ((error: Error) => void) | null = null
  private inputTail = Promise.resolve()
  private writeTail = Promise.resolve()
  private queuedChunks = 0
  private suspended = false
  private closed = false
  private closeHandled = false

  private readonly onData: TransportListener = (chunk) => {
    if (this.closed) return
    this.transport.pause?.()
    this.queuedChunks += 1
    this.inputTail = this.inputTail
      .then(async () => {
        this.frames.push(...this.reader.push(this.toBytes(chunk)))
        await this.drainFrames()
      })
      .catch((error: unknown) => this.fail(toError(error)))
      .finally(() => {
        this.queuedChunks -= 1
        if (!this.suspended && this.queuedChunks === 0 && !this.closed) this.transport.resume?.()
      })
  }

  private readonly onError: TransportListener = (error) => {
    this.errorHandler?.(toError(error))
    this.destroy()
  }

  private readonly onClose: TransportListener = () => {
    if (this.closeHandled) return
    this.closed = true
    this.closeHandled = true
    this.frames.length = 0
    this.detach()
    this.closeHandler?.()
  }

  constructor(
    private readonly transport: FramedTransport,
    private readonly toBytes: (chunk: unknown) => Uint8Array
  ) {
    transport.on('data', this.onData)
    transport.on('error', this.onError)
    transport.once('close', this.onClose)
  }

  get destroyed(): boolean {
    return this.closed || this.transport.destroyed === true
  }

  transferTo(handler: FrameHandler): void {
    this.frameHandler = handler
    if (!this.suspended && this.frames.length > 0) {
      this.inputTail = this.inputTail
        .then(() => this.drainFrames())
        .catch((error: unknown) => this.fail(toError(error)))
    }
  }

  setCloseHandler(handler: () => void): void {
    this.closeHandler = handler
  }

  setErrorHandler(handler: (error: Error) => void): void {
    this.errorHandler = handler
  }

  suspend(): void {
    this.suspended = true
    this.transport.pause?.()
  }

  resume(): void {
    if (!this.suspended || this.closed) return
    this.suspended = false
    this.inputTail = this.inputTail
      .then(() => this.drainFrames())
      .catch((error: unknown) => this.fail(toError(error)))
      .finally(() => {
        if (!this.suspended && this.queuedChunks === 0 && !this.closed) this.transport.resume?.()
      })
  }

  sendJson(message: TcpJsonMessage): Promise<void> {
    return this.enqueueWrite(encodeJsonFrame(message))
  }

  sendBinary(data: Uint8Array): Promise<void> {
    return this.enqueueWrite(encodeBinaryFrame(data))
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.suspended = true
    this.frames.length = 0
    this.transport.destroy()
  }

  private async drainFrames(): Promise<void> {
    while (!this.suspended && !this.closed && this.frames.length > 0) {
      const frame = this.frames.shift()
      if (!frame || !this.frameHandler) throw new Error('Frame received without an owner')
      await this.frameHandler(frame)
    }
  }

  private enqueueWrite(data: Uint8Array): Promise<void> {
    const result = this.writeTail.then(() => this.write(data))
    this.writeTail = result.catch(() => undefined)
    return result
  }

  private write(data: Uint8Array): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Socket is closed'))
    if (this.transport.write(data)) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const onDrain: TransportListener = () => finish()
      const onClose: TransportListener = () => finish(new Error('Socket closed before drain'))
      const onError: TransportListener = (error) => finish(toError(error))

      const cleanup = (): void => {
        this.transport.removeListener('drain', onDrain)
        this.transport.removeListener('close', onClose)
        this.transport.removeListener('error', onError)
      }
      const finish = (error?: Error): void => {
        cleanup()
        if (error) reject(error)
        else resolve()
      }

      this.transport.once('drain', onDrain)
      this.transport.once('close', onClose)
      this.transport.once('error', onError)
    })
  }

  private fail(error: Error): void {
    this.errorHandler?.(error)
    this.destroy()
  }

  private detach(): void {
    this.transport.removeListener('data', this.onData)
    this.transport.removeListener('error', this.onError)
    this.transport.removeListener('close', this.onClose)
  }
}

export interface OutgoingFile extends FileMetadata {
  chunks(): AsyncIterable<Uint8Array>
}

export interface SessionChannelHandlers {
  onMessage(message: TcpApplicationMessage): void | Promise<void>
  onFileOffer(files: readonly FileMetadata[]): void | Promise<void>
  onFileBegin(file: FileMetadata): void | Promise<void>
  onFileChunk(file: FileMetadata, chunk: Uint8Array): void | Promise<void>
  onFileEnd(file: FileMetadata): void | Promise<void>
  onFileBatchEnd(files: readonly FileMetadata[]): void | Promise<void>
  onRemoteDisconnect(): void
  onClose(): void
  onError(error: Error): void
}

export interface SessionChannelOptions {
  fileTransferIdleTimeoutMs?: number
  disconnectTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
}

export class SessionChannel {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private unansweredHeartbeatMs = 0
  private offeredFiles: readonly FileMetadata[] | null = null
  private receivingIndex = 0
  private receivingBytes = 0
  private receivingStarted = false
  private sendingFiles = false
  private fileTransferTimer: ReturnType<typeof setTimeout> | null = null
  private readonly fileTransferIdleTimeoutMs: number
  private readonly disconnectTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number

  constructor(
    private readonly socket: FramedSocket,
    private readonly handlers: SessionChannelHandlers,
    options: SessionChannelOptions = {}
  ) {
    this.fileTransferIdleTimeoutMs =
      options.fileTransferIdleTimeoutMs ?? FILE_TRANSFER_IDLE_TIMEOUT_MS
    if (!Number.isFinite(this.fileTransferIdleTimeoutMs) || this.fileTransferIdleTimeoutMs <= 0) {
      throw new Error('File Transfer idle timeout must be a positive finite number')
    }
    this.disconnectTimeoutMs = options.disconnectTimeoutMs ?? SESSION_DISCONNECT_TIMEOUT_MS
    if (!Number.isFinite(this.disconnectTimeoutMs) || this.disconnectTimeoutMs <= 0) {
      throw new Error('Session disconnect timeout must be a positive finite number')
    }
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    if (!Number.isFinite(this.heartbeatIntervalMs) || this.heartbeatIntervalMs <= 0) {
      throw new Error('Heartbeat interval must be a positive finite number')
    }
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS
    if (
      !Number.isFinite(this.heartbeatTimeoutMs) ||
      this.heartbeatTimeoutMs < this.heartbeatIntervalMs
    ) {
      throw new Error('Heartbeat timeout must be finite and at least one interval')
    }
    socket.setErrorHandler((error) => handlers.onError(error))
    socket.setCloseHandler(() => {
      this.stopHeartbeat()
      this.stopFileTransferTimeout()
      handlers.onClose()
    })
    socket.transferTo((frame) => this.handleFrame(frame))
    socket.resume()
    this.startHeartbeat()
  }

  get closed(): boolean {
    return this.socket.destroyed
  }

  async send(message: TcpApplicationMessage): Promise<void> {
    await this.socket.sendJson(tcpSessionMessageSchema.parse(message))
  }

  async sendFileBatch(files: readonly OutgoingFile[]): Promise<void> {
    if (files.length === 0) return
    if (this.sendingFiles) throw new Error('A File Transfer is already in progress')

    const offer = tcpFileOfferSchema.parse({
      type: 'file-offer',
      files: files.map(({ id, name, size, mimeType }) => ({ id, name, size, mimeType }))
    })
    const begins = files.map(({ id, name, size, mimeType }) =>
      tcpFileBeginSchema.parse({ type: 'file-begin', id, name, size, mimeType })
    )
    this.sendingFiles = true

    try {
      await this.socket.sendJson(offer)

      for (const [index, file] of files.entries()) {
        await this.socket.sendJson(begins[index])
        let sent = 0
        for await (const chunk of file.chunks()) {
          if (chunk.byteLength === 0) continue
          sent += chunk.byteLength
          if (sent > file.size) throw new Error(`File ${file.name} exceeds its declared size`)
          await this.socket.sendBinary(chunk)
        }
        if (sent !== file.size) throw new Error(`File ${file.name} size changed during transfer`)
        await this.socket.sendJson({ type: 'file-end', id: file.id })
      }
    } catch (error) {
      this.socket.destroy()
      throw error
    } finally {
      this.sendingFiles = false
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat()
    this.stopFileTransferTimeout()
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        this.socket.sendJson({ type: 'disconnect' }),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, this.disconnectTimeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
      this.socket.destroy()
    }
  }

  destroy(): void {
    this.stopHeartbeat()
    this.stopFileTransferTimeout()
    this.socket.destroy()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.unansweredHeartbeatMs = 0
    this.heartbeatTimer = setInterval(() => {
      this.unansweredHeartbeatMs += this.heartbeatIntervalMs
      if (this.unansweredHeartbeatMs > this.heartbeatTimeoutMs) {
        this.socket.destroy()
        return
      }
      void this.socket.sendJson({ type: 'ping' }).catch(() => this.socket.destroy())
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private async handleFrame(frame: DecodedFrame): Promise<void> {
    if (frame.kind === 'invalid') throw new Error('Invalid Session frame')
    if (frame.kind === 'binary') {
      await this.handleBinary(frame.data)
      return
    }
    if (!isSessionMessage(frame.message)) throw new Error('Handshake message received in Session')
    await this.handleJson(frame.message)
  }

  private async handleJson(message: TcpSessionMessage): Promise<void> {
    switch (message.type) {
      case 'ping':
        await this.socket.sendJson({ type: 'pong' })
        return
      case 'pong':
        this.unansweredHeartbeatMs = 0
        return
      case 'disconnect':
        this.handlers.onRemoteDisconnect()
        this.socket.destroy()
        return
      case 'file-offer':
        if (this.offeredFiles) throw new Error('Overlapping File Transfer offers are not allowed')
        this.offeredFiles = message.files
        this.receivingIndex = 0
        this.receivingBytes = 0
        this.receivingStarted = false
        this.resetFileTransferTimeout()
        await this.handlers.onFileOffer(message.files)
        return
      case 'file-begin': {
        const expected = this.expectedFile()
        if (!expected || !sameFileMetadata(expected, message)) {
          throw new Error('File Transfer metadata does not match its offer')
        }
        if (this.receivingStarted) throw new Error('A file is already being received')
        this.receivingStarted = true
        this.resetFileTransferTimeout()
        await this.handlers.onFileBegin(expected)
        return
      }
      case 'file-end': {
        const expected = this.expectedFile()
        if (
          !expected ||
          !this.receivingStarted ||
          expected.id !== message.id ||
          this.receivingBytes !== expected.size
        ) {
          throw new Error('File Transfer ended with an invalid byte count')
        }
        this.resetFileTransferTimeout()
        await this.handlers.onFileEnd(expected)
        this.receivingIndex += 1
        this.receivingBytes = 0
        this.receivingStarted = false
        if (this.offeredFiles && this.receivingIndex === this.offeredFiles.length) {
          const completed = this.offeredFiles
          this.offeredFiles = null
          this.receivingIndex = 0
          this.stopFileTransferTimeout()
          await this.handlers.onFileBatchEnd(completed)
        }
        return
      }
      default:
        await this.handlers.onMessage(message)
    }
  }

  private async handleBinary(chunk: Uint8Array): Promise<void> {
    const expected = this.expectedFile()
    if (!expected || !this.receivingStarted) {
      throw new Error('Binary frame received outside a File Transfer')
    }
    this.receivingBytes += chunk.byteLength
    if (this.receivingBytes > expected.size) throw new Error('File Transfer exceeds its declared size')
    this.resetFileTransferTimeout()
    await this.handlers.onFileChunk(expected, chunk)
  }

  private resetFileTransferTimeout(): void {
    this.stopFileTransferTimeout()
    if (!this.offeredFiles || this.socket.destroyed) return
    this.fileTransferTimer = setTimeout(() => {
      this.fileTransferTimer = null
      try {
        this.handlers.onError(new Error('File Transfer timed out while waiting for progress'))
      } finally {
        this.socket.destroy()
      }
    }, this.fileTransferIdleTimeoutMs)
  }

  private stopFileTransferTimeout(): void {
    if (this.fileTransferTimer) clearTimeout(this.fileTransferTimer)
    this.fileTransferTimer = null
  }

  private expectedFile(): FileMetadata | null {
    return this.offeredFiles?.[this.receivingIndex] ?? null
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
