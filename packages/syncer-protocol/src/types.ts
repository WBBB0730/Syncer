import type { DeviceKind } from './messages.js'

export type SessionStatus = 'available' | 'connecting' | 'connected'

export interface DeviceIdentity {
  uuid: string
  name: string
  device: DeviceKind
}

export interface DeviceEndpoint {
  address: string
  port: number
}

export interface AvailableDevice extends DeviceIdentity {
  endpoints: readonly DeviceEndpoint[]
}

export type ConnectionFailureReason = 'unreachable' | 'timeout' | 'busy' | 'protocol-error'

export type ConnectionAttemptResult = 'accepted' | 'refused' | 'cancelled' | ConnectionFailureReason

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
