import type { DeviceKind } from './messages.js'

export type SessionStatus = 'available' | 'connecting' | 'connected'

export interface DeviceIdentity {
  uuid: string
  name: string
  device: DeviceKind
}

export interface AvailableDevice extends DeviceIdentity {
  port: number
  address: string
}

export interface ConnectionRequest {
  requestId: string
  device: AvailableDevice
}

export interface FileMetadata {
  id: string
  name: string
  size: number
  mimeType?: string
}
