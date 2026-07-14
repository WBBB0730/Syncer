import { isAbsolute, relative, resolve, sep } from 'path'
import {
  deviceNameSchema,
  deviceUuidSchema,
  deviceWhitelistSchema,
  hasUnsafeDisplayControls,
  utf8ByteLength,
  type DeviceWhitelist
} from '@syncer/protocol'
import { z } from 'zod'
import type { LegacyLocalStorageValues, ReceiveHistoryItem } from '../../shared/contracts'

const MAX_DEVICE_NAME_BYTES = 255
const MIGRATED_DEVICE_NAME = 'DESKTOP'
const LEGACY_WHITELIST_KEY = 'whiteList'

const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), 'Stored filesystem path must be absolute')

const receiveHistoryItemSchema = z
  .object({
    name: z.string().min(1),
    path: absolutePathSchema,
    time: z.number().finite()
  })
  .strict()

const legacyReceiveHistoryItemSchema = receiveHistoryItemSchema
  .extend({ selected: z.boolean().optional() })
  .strict()

const legacyDeviceWhitelistSchema = z.record(z.boolean())

export interface StorageValues {
  name: string
  uuid: string
  whitelist: DeviceWhitelist
  receiveHistory: ReceiveHistoryItem[]
  filePath: string
}

export type StorageData = Partial<StorageValues>

export const storageSchema: z.ZodType<StorageData> = z
  .object({
    name: deviceNameSchema.optional(),
    uuid: deviceUuidSchema.optional(),
    whitelist: deviceWhitelistSchema.optional(),
    receiveHistory: z.array(receiveHistoryItemSchema).optional(),
    filePath: absolutePathSchema.optional()
  })
  .catchall(z.unknown())
  .superRefine((value, context) => {
    if (!Object.hasOwn(value, LEGACY_WHITELIST_KEY)) return
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Legacy Whitelist key must be migrated'
    })
  })

const legacyStorageSchema = z
  .object({
    name: z.string().min(1).nullable().optional(),
    uuid: deviceUuidSchema.nullable().optional(),
    whitelist: deviceWhitelistSchema.nullable().optional(),
    [LEGACY_WHITELIST_KEY]: z.unknown().optional(),
    receiveHistory: z.array(legacyReceiveHistoryItemSchema).nullable().optional(),
    filePath: absolutePathSchema.nullable().optional()
  })
  .catchall(z.unknown())

export const legacyLocalStorageValuesSchema: z.ZodType<LegacyLocalStorageValues> = z
  .object({
    name: z.string().nullable(),
    uuid: z.string().nullable(),
    whitelist: z.string().nullable(),
    receiveHistory: z.string().nullable(),
    filePath: z.string().nullable()
  })
  .strict()

export function migrateLegacyStorage(value: unknown): StorageData {
  const legacy = legacyStorageSchema.parse(value)
  const migrated: Record<string, unknown> = { ...legacy }
  delete migrated[LEGACY_WHITELIST_KEY]

  for (const key of ['name', 'uuid', 'whitelist', 'receiveHistory', 'filePath'] as const) {
    if (legacy[key] === null) delete migrated[key]
  }
  if (typeof legacy.name === 'string') migrated.name = migrateLegacyDeviceName(legacy.name)
  if (legacy.receiveHistory) {
    migrated.receiveHistory = legacy.receiveHistory.map(({ name, path, time }) => ({
      name,
      path,
      time
    }))
  }
  if (
    !Object.hasOwn(legacy, 'whitelist') &&
    legacy[LEGACY_WHITELIST_KEY] !== null &&
    legacy[LEGACY_WHITELIST_KEY] !== undefined
  ) {
    migrated.whitelist = migrateLegacyWhitelist(
      legacyDeviceWhitelistSchema.parse(legacy[LEGACY_WHITELIST_KEY])
    )
  }

  return storageSchema.parse(migrated)
}

export function migrateLegacyLocalStorage(value: unknown): StorageData {
  const legacy = legacyLocalStorageValuesSchema.parse(value)
  return migrateLegacyStorage({
    name: parseLegacyLocalStorageValue(legacy.name),
    uuid: parseLegacyLocalStorageValue(legacy.uuid),
    [LEGACY_WHITELIST_KEY]: parseLegacyLocalStorageValue(legacy.whitelist),
    receiveHistory: parseLegacyLocalStorageValue(legacy.receiveHistory),
    filePath: parseLegacyLocalStorageValue(legacy.filePath)
  })
}

export function migrateLegacyDeviceName(value: string): string {
  let migrated = ''
  for (const character of value) {
    if (hasUnsafeDisplayControls(character)) continue
    const next = migrated + character
    if (next.length > MAX_DEVICE_NAME_BYTES || utf8ByteLength(next) > MAX_DEVICE_NAME_BYTES) break
    migrated = next
  }
  const parsed = deviceNameSchema.safeParse(migrated)
  return parsed.success ? parsed.data : MIGRATED_DEVICE_NAME
}

export function resolveReceiveHistoryPath(item: ReceiveHistoryItem): string | null {
  const directory = resolve(item.path)
  const path = resolve(directory, item.name)
  const child = relative(directory, path)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    return null
  }
  return path
}

function migrateLegacyWhitelist(legacy: Record<string, boolean>): DeviceWhitelist {
  const migrated: DeviceWhitelist = {}
  for (const [uuid, enabled] of Object.entries(legacy)) {
    const parsedUuid = deviceUuidSchema.safeParse(uuid)
    if (enabled && parsedUuid.success) migrated[parsedUuid.data] = true
  }
  return deviceWhitelistSchema.parse(migrated)
}

function parseLegacyLocalStorageValue(value: string | null): unknown {
  return value === null ? null : JSON.parse(value)
}
