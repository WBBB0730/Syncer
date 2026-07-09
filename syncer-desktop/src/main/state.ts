import { randomUUID } from 'crypto'
import { getStorage, setStorage, STORAGE_KEYS } from './utils/storage'

export type ConnectionStatus = 'available' | 'connecting' | 'connected'

export interface DeviceInfo {
  uuid: string
  name: string
  device: string
  port: number
  address: string
}

function randomDigits(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10)
  return result
}

function initValue(key: string, factory: () => string): string {
  const existing = getStorage<string>(key)
  if (existing) return existing
  const value = factory()
  setStorage(key, value)
  return value
}

class AppState {
  uuid = initValue(STORAGE_KEYS.UUID, () => randomUUID())
  name = initValue(STORAGE_KEYS.NAME, () => `DESKTOP_${randomDigits(5)}`)
  status: ConnectionStatus = 'available'
  availableDeviceMap = new Map<string, DeviceInfo>()
  target: DeviceInfo | null = null

  setName(name: string): void {
    this.name = name
    setStorage(STORAGE_KEYS.NAME, name)
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status
  }

  clearAvailableDeviceMap(): void {
    this.availableDeviceMap.clear()
  }

  addAvailableDevice(device: DeviceInfo): void {
    this.availableDeviceMap.set(device.uuid, device)
  }

  setTarget(device: DeviceInfo | null): void {
    this.target = device
  }

  snapshot() {
    return {
      uuid: this.uuid,
      name: this.name,
      status: this.status,
      target: this.target,
      availableDevices: Array.from(this.availableDeviceMap.values()),
      ipAddress: ''
    }
  }
}

export const appState = new AppState()
