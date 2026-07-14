import { FRAME_BINARY, FRAME_JSON, MAX_FRAME_BYTES } from './constants.js'
import { parseTcpJsonMessage, tcpJsonMessageSchema, type TcpJsonMessage } from './messages.js'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function writeU32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false)
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}

function textEncode(text: string): Uint8Array {
  return utf8Encoder.encode(text)
}

function textDecode(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

/** Encode a JSON control frame: [u32be length][u8 kind=0][utf8 json] */
export function encodeJsonFrame(message: TcpJsonMessage): Uint8Array {
  const body = textEncode(JSON.stringify(tcpJsonMessageSchema.parse(message)))
  assertFrameSize(1 + body.length)
  const frame = new Uint8Array(4 + 1 + body.length)
  writeU32BE(new DataView(frame.buffer), 0, 1 + body.length)
  frame[4] = FRAME_JSON
  frame.set(body, 5)
  return frame
}

/** Encode a binary payload frame: [u32be length][u8 kind=1][bytes] */
export function encodeBinaryFrame(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new Error('Binary frames must contain at least one byte')
  assertFrameSize(1 + data.length)
  const frame = new Uint8Array(4 + 1 + data.length)
  writeU32BE(new DataView(frame.buffer), 0, 1 + data.length)
  frame[4] = FRAME_BINARY
  frame.set(data, 5)
  return frame
}

function assertFrameSize(size: number): void {
  if (size > MAX_FRAME_BYTES) throw new Error(`Frame exceeds ${MAX_FRAME_BYTES} bytes`)
}

export type DecodedFrame =
  | { kind: 'json'; message: TcpJsonMessage }
  | { kind: 'binary'; data: Uint8Array }
  | { kind: 'invalid' }

/**
 * Incremental length-prefixed frame reader.
 * Safe across TCP chunk boundaries (unlike trailing-delimiter parsers).
 */
export class FrameReader {
  private readonly header = new Uint8Array(4)
  private headerBytes = 0
  private payload: Uint8Array | null = null
  private payloadBytes = 0

  push(chunk: Uint8Array): DecodedFrame[] {
    const out: DecodedFrame[] = []
    let chunkOffset = 0

    while (chunkOffset < chunk.byteLength) {
      if (!this.payload) {
        const headerLength = Math.min(4 - this.headerBytes, chunk.byteLength - chunkOffset)
        this.header.set(chunk.subarray(chunkOffset, chunkOffset + headerLength), this.headerBytes)
        this.headerBytes += headerLength
        chunkOffset += headerLength
        if (this.headerBytes < 4) break

        const size = readU32BE(this.header, 0)
        this.headerBytes = 0
        if (size === 0 || size > MAX_FRAME_BYTES) {
          this.reset()
          out.push({ kind: 'invalid' })
          break
        }
        this.payload = new Uint8Array(size)
        this.payloadBytes = 0
      }

      const payload = this.payload
      const payloadLength = Math.min(
        payload.byteLength - this.payloadBytes,
        chunk.byteLength - chunkOffset
      )
      payload.set(chunk.subarray(chunkOffset, chunkOffset + payloadLength), this.payloadBytes)
      this.payloadBytes += payloadLength
      chunkOffset += payloadLength
      if (this.payloadBytes < payload.byteLength) break

      this.payload = null
      this.payloadBytes = 0
      out.push(this.decode(payload))
    }

    return out
  }

  reset(): void {
    this.headerBytes = 0
    this.payload = null
    this.payloadBytes = 0
  }

  private decode(payload: Uint8Array): DecodedFrame {
    const kind = payload[0]
    const body = payload.subarray(1)

    if (kind === FRAME_JSON) {
      let message: TcpJsonMessage | null = null
      try {
        message = parseTcpJsonMessage(textDecode(body))
      } catch {
        message = null
      }
      return message ? { kind: 'json', message } : { kind: 'invalid' }
    }
    if (kind === FRAME_BINARY) {
      return body.length > 0 ? { kind: 'binary', data: body.slice() } : { kind: 'invalid' }
    }
    return { kind: 'invalid' }
  }
}
