import { randomUUID } from 'crypto'
import {
  deviceNameSchema,
  pruneAvailableDevices as pruneAvailableDeviceMaps,
  transitionSessionStatus,
  upsertAvailableDevices,
  type AvailableDevice,
  type ConnectionRequest,
  type SessionLifecycleEvent,
  type SessionStatus
} from '@syncer/protocol'
import type { AppSnapshot } from '../shared/contracts'
import { getStorage, setStorage, STORAGE_KEYS } from './utils/storage'

function randomDigits(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10)
  return result
}

function initUuid(): string {
  const existing = getStorage(STORAGE_KEYS.UUID)
  if (existing) return existing
  const value = randomUUID()
  setStorage(STORAGE_KEYS.UUID, value)
  return value
}

function initName(): string {
  const existing = getStorage(STORAGE_KEYS.NAME)
  if (existing) return existing
  const value = `DESKTOP_${randomDigits(5)}`
  setStorage(STORAGE_KEYS.NAME, value)
  return value
}

class AppState {
  revision = 0
  uuid = initUuid()
  name = initName()
  status: SessionStatus = 'available'
  availableDeviceMap = new Map<string, AvailableDevice>()
  private availableDeviceSeenAt = new Map<string, number>()
  target: AvailableDevice | null = null
  connectionRequest: ConnectionRequest | null = null

  setName(name: string): void {
    const validated = deviceNameSchema.parse(name)
    if (this.name === validated) return
    setStorage(STORAGE_KEYS.NAME, validated)
    this.name = validated
    this.touch()
  }

  transitionSession(event: SessionLifecycleEvent): void {
    const next = transitionSessionStatus(this.status, event)
    if (this.status === next) return
    this.status = next
    if (next === 'connected') {
      this.availableDeviceMap.clear()
      this.availableDeviceSeenAt.clear()
    }
    this.touch()
  }

  clearAvailableDeviceMap(): void {
    if (this.availableDeviceMap.size === 0) return
    this.availableDeviceMap.clear()
    this.availableDeviceSeenAt.clear()
    this.touch()
  }

  addAvailableDevices(devices: readonly AvailableDevice[], seenAt = Date.now()): void {
    if (this.status !== 'available') return
    let changed = pruneAvailableDeviceMaps(
      this.availableDeviceMap,
      this.availableDeviceSeenAt,
      seenAt
    )
    changed =
      upsertAvailableDevices(
        this.availableDeviceMap,
        this.availableDeviceSeenAt,
        devices,
        seenAt
      ) || changed
    if (changed) this.touch()
  }

  pruneAvailableDevices(now = Date.now()): boolean {
    if (
      this.status !== 'available' ||
      !pruneAvailableDeviceMaps(this.availableDeviceMap, this.availableDeviceSeenAt, now)
    ) {
      return false
    }
    this.touch()
    return true
  }

  setTarget(device: AvailableDevice | null): void {
    if (this.target === device) return
    this.target = device
    this.touch()
  }

  setConnectionRequest(request: ConnectionRequest | null): void {
    if (this.connectionRequest === request) return
    this.connectionRequest = request
    this.touch()
  }

  snapshot(): AppSnapshot {
    return {
      revision: this.revision,
      uuid: this.uuid,
      name: this.name,
      status: this.status,
      target: this.target,
      availableDevices: Array.from(this.availableDeviceMap.values()),
      connectionRequest: this.connectionRequest
    }
  }

  private touch(): void {
    this.revision += 1
  }
}

export let appState: AppState

export function initializeAppState(): AppState {
  if (appState) throw new Error('AppState is already initialized')
  appState = new AppState()
  return appState
}
