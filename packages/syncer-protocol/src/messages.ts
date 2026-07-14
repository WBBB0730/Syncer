import { z } from 'zod'

import {
  MAX_FILE_BATCH_BYTES,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_TEXT_BYTES,
  PROTOCOL_VERSION
} from './constants.js'
import { isWindowsReservedFileName, utf8ByteLength } from './filename.js'
import type { FileMetadata } from './types.js'

export const deviceKindSchema = z.enum(['desktop', 'mobile'])

const unsafeDisplayControlPattern =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/

export function hasUnsafeDisplayControls(value: string): boolean {
  return unsafeDisplayControlPattern.test(value)
}

export const deviceUuidSchema = z.string().uuid()
export const deviceWhitelistSchema = z.record(deviceUuidSchema, z.literal(true))
export type DeviceWhitelist = z.infer<typeof deviceWhitelistSchema>
export const deviceNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => name.trim().length > 0, 'Device Name cannot be blank')
  .refine(
    (name) => utf8ByteLength(name) <= 255,
    'Device Name must not exceed 255 UTF-8 bytes'
  )
  .refine(
    (name) => !hasUnsafeDisplayControls(name),
    'Device Name cannot contain control characters'
  )

export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) => utf8ByteLength(name) <= MAX_FILE_NAME_BYTES,
    `File name must not exceed ${MAX_FILE_NAME_BYTES} UTF-8 bytes`
  )
  .refine((name) => name !== '.' && name !== '..', 'File name cannot be a path segment')
  .refine((name) => !/[<>:"/\\|?*]/.test(name), 'File name is not portable')
  .refine(
    (name) => !hasUnsafeDisplayControls(name),
    'File name cannot contain control characters'
  )
  .refine((name) => !/[. ]$/.test(name), 'File name cannot end with a dot or space')
  .refine((name) => !isWindowsReservedFileName(name), 'File name is reserved')

const fileIdSchema = z.string().min(1).max(128)
const fileSizeSchema = z.number().int().nonnegative().max(MAX_FILE_BYTES).safe()
const mimeTypeSchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .optional()

const fileMetadataSchema = z.object({
  id: fileIdSchema,
  name: fileNameSchema,
  size: fileSizeSchema,
  mimeType: mimeTypeSchema
})

export const udpDiscoverSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('discover'),
  queryId: deviceUuidSchema,
  uuid: deviceUuidSchema,
  name: deviceNameSchema,
  device: deviceKindSchema
}).strict()

const udpHelloBaseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('hello'),
  uuid: deviceUuidSchema,
  name: deviceNameSchema,
  device: deviceKindSchema,
  tcpPort: z.number().int().min(1).max(65_535).safe()
}).strict()

export const udpHelloSchema = z.discriminatedUnion('announce', [
  udpHelloBaseSchema.extend({
    announce: z.literal(false),
    queryId: deviceUuidSchema
  }).strict(),
  udpHelloBaseSchema.extend({
    announce: z.literal(true)
  }).strict()
])

export const udpMessageSchema = z.union([udpDiscoverSchema, udpHelloSchema])

export type UdpDiscover = z.infer<typeof udpDiscoverSchema>
export type UdpHello = z.infer<typeof udpHelloSchema>
export type UdpMessage = z.infer<typeof udpMessageSchema>

export function isRelevantDiscoveryHello(
  hello: UdpHello,
  activeQueryId: string | undefined
): boolean {
  return hello.announce || hello.queryId === activeQueryId
}

export const tcpHelloSchema = z.object({
  type: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  uuid: deviceUuidSchema,
  name: deviceNameSchema,
  device: deviceKindSchema
})

export const tcpConnectSchema = z.object({
  type: z.literal('connect'),
  v: z.literal(PROTOCOL_VERSION),
  uuid: deviceUuidSchema,
  targetUuid: deviceUuidSchema,
  name: deviceNameSchema,
  device: deviceKindSchema
})

export const tcpAcceptSchema = z.object({
  type: z.literal('accept'),
  v: z.literal(PROTOCOL_VERSION),
  uuid: deviceUuidSchema
})

export const tcpRefuseSchema = z.object({
  type: z.literal('refuse'),
  v: z.literal(PROTOCOL_VERSION),
  uuid: deviceUuidSchema,
  name: deviceNameSchema.optional(),
  reason: z.enum(['busy', 'rejected', 'protocol-error']).optional()
})

export const tcpPingSchema = z.object({ type: z.literal('ping') })
export const tcpPongSchema = z.object({ type: z.literal('pong') })

export const tcpDisconnectSchema = z.object({ type: z.literal('disconnect') })

export const tcpTextSchema = z.object({
  type: z.literal('text'),
  content: z.string().refine(
    (content) => new TextEncoder().encode(content).byteLength <= MAX_TEXT_BYTES,
    `Text Transfer must not exceed ${MAX_TEXT_BYTES} UTF-8 bytes`
  )
})

const offeredFilesSchema = z
  .array(fileMetadataSchema)
  .min(1)
  .max(MAX_FILES_PER_BATCH)
  .superRefine((files, context) => {
    if (new Set(files.map((file) => file.id)).size !== files.length) {
      context.addIssue({ code: 'custom', message: 'File ids must be unique' })
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_FILE_BATCH_BYTES) {
      context.addIssue({ code: 'custom', message: 'File batch exceeds the byte limit' })
    }
  })

export const tcpFileOfferSchema = z.object({
  type: z.literal('file-offer'),
  files: offeredFilesSchema
})

export const tcpFileBeginSchema = z.object({
  type: z.literal('file-begin'),
  ...fileMetadataSchema.shape
})

export const tcpFileEndSchema = z.object({
  type: z.literal('file-end'),
  id: fileIdSchema
})

export const commandKeySchema = z.enum([
  'up',
  'down',
  'left',
  'right',
  'space',
  'escape',
  'f5',
  'audio_mute',
  'audio_vol_down',
  'audio_vol_up'
])
export type CommandKey = z.infer<typeof commandKeySchema>

export const tcpCommandSchema = z.object({
  type: z.literal('command'),
  content: commandKeySchema
})

export const tcpRingSchema = z.object({
  type: z.literal('ring'),
  content: z.boolean()
})

export const tcpHandshakeMessageSchema = z.discriminatedUnion('type', [
  tcpHelloSchema,
  tcpConnectSchema,
  tcpAcceptSchema,
  tcpRefuseSchema
])

export const tcpSessionMessageSchema = z.discriminatedUnion('type', [
  tcpPingSchema,
  tcpPongSchema,
  tcpDisconnectSchema,
  tcpTextSchema,
  tcpFileOfferSchema,
  tcpFileBeginSchema,
  tcpFileEndSchema,
  tcpCommandSchema,
  tcpRingSchema
])

export const tcpJsonMessageSchema = z.discriminatedUnion('type', [
  tcpHelloSchema,
  tcpConnectSchema,
  tcpAcceptSchema,
  tcpRefuseSchema,
  tcpPingSchema,
  tcpPongSchema,
  tcpDisconnectSchema,
  tcpTextSchema,
  tcpFileOfferSchema,
  tcpFileBeginSchema,
  tcpFileEndSchema,
  tcpCommandSchema,
  tcpRingSchema
])

export type TcpJsonMessage = z.infer<typeof tcpJsonMessageSchema>
export type TcpHandshakeMessage = z.infer<typeof tcpHandshakeMessageSchema>
export type TcpSessionMessage = z.infer<typeof tcpSessionMessageSchema>
export type TcpApplicationMessage = Extract<TcpSessionMessage, { type: 'text' | 'command' | 'ring' }>
export type DeviceKind = z.infer<typeof deviceKindSchema>
export type FileOffer = Extract<TcpSessionMessage, { type: 'file-offer' }>

export function isHandshakeMessage(message: TcpJsonMessage): message is TcpHandshakeMessage {
  return ['hello', 'connect', 'accept', 'refuse'].includes(message.type)
}

export function isSessionMessage(message: TcpJsonMessage): message is TcpSessionMessage {
  return !isHandshakeMessage(message)
}

export function sameFileMetadata(left: FileMetadata, right: FileMetadata): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.size === right.size &&
    left.mimeType === right.mimeType
  )
}

export function parseUdpMessage(raw: string): UdpMessage | null {
  try {
    return udpMessageSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function encodeUdpMessage(message: UdpMessage): string {
  return JSON.stringify(udpMessageSchema.parse(message))
}

export function parseTcpJsonMessage(raw: string): TcpJsonMessage | null {
  try {
    return tcpJsonMessageSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
