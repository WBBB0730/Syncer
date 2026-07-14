import { AVAILABLE_DEVICE_TTL_MS, MAX_AVAILABLE_DEVICES } from './constants.js'
import type { AvailableDevice } from './types.js'

export function upsertAvailableDevices(
  availableDevices: Map<string, AvailableDevice>,
  lastSeenAt: Map<string, number>,
  devices: readonly AvailableDevice[],
  seenAt: number
): boolean {
  if (!Number.isFinite(seenAt)) {
    throw new RangeError('Available Device last-seen timestamp must be finite')
  }

  let visibleChanged = false
  for (const device of devices) {
    if (!availableDevices.has(device.uuid) && availableDevices.size >= MAX_AVAILABLE_DEVICES) {
      const oldestUuid = leastRecentlySeenUuid(availableDevices, lastSeenAt)
      availableDevices.delete(oldestUuid)
      lastSeenAt.delete(oldestUuid)
      visibleChanged = true
    }

    const current = availableDevices.get(device.uuid)
    if (!current || !sameAvailableDevice(current, device)) {
      availableDevices.set(device.uuid, device)
      visibleChanged = true
    }
    lastSeenAt.set(device.uuid, seenAt)
  }
  return visibleChanged
}

export function pruneAvailableDevices(
  availableDevices: Map<string, AvailableDevice>,
  lastSeenAt: Map<string, number>,
  now: number
): boolean {
  if (!Number.isFinite(now)) {
    throw new RangeError('Available Device prune timestamp must be finite')
  }

  let changed = false
  for (const [deviceUuid, seenAt] of lastSeenAt) {
    if (now - seenAt <= AVAILABLE_DEVICE_TTL_MS) continue
    lastSeenAt.delete(deviceUuid)
    availableDevices.delete(deviceUuid)
    changed = true
  }
  return changed
}

function leastRecentlySeenUuid(
  availableDevices: ReadonlyMap<string, AvailableDevice>,
  lastSeenAt: ReadonlyMap<string, number>
): string {
  let oldestUuid: string | null = null
  let oldestSeenAt = Number.POSITIVE_INFINITY

  for (const deviceUuid of availableDevices.keys()) {
    const seenAt = lastSeenAt.get(deviceUuid)
    if (seenAt === undefined) {
      throw new Error('Available Device is missing its last-seen timestamp')
    }
    if (oldestUuid === null || seenAt < oldestSeenAt) {
      oldestUuid = deviceUuid
      oldestSeenAt = seenAt
    }
  }

  if (oldestUuid === null) {
    throw new Error('Available Device capacity was reached by an empty collection')
  }
  return oldestUuid
}

function sameAvailableDevice(left: AvailableDevice, right: AvailableDevice): boolean {
  return (
    left.uuid === right.uuid &&
    left.name === right.name &&
    left.device === right.device &&
    left.port === right.port &&
    left.address === right.address
  )
}
