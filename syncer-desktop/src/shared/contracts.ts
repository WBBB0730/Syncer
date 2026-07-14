import type {
  AvailableDevice,
  CommandKey,
  ConnectionRequest,
  FileMetadata,
  SessionStatus
} from '@syncer/protocol'

export const WHITELIST_SESSION_ACCEPTED_CHANNEL = 'syncer:whitelist-session-accepted'

export type {
  AvailableDevice,
  CommandKey,
  ConnectionRequest,
  FileMetadata,
  SessionStatus
} from '@syncer/protocol'

export interface AppSnapshot {
  revision: number
  uuid: string
  name: string
  status: SessionStatus
  target: AvailableDevice | null
  availableDevices: AvailableDevice[]
  connectionRequest: ConnectionRequest | null
}

export interface SelectedFile {
  path: string
  name: string
  mimeType?: string
}

export type ReceivedFileSummary = Pick<FileMetadata, 'name' | 'size'>

export interface ReceivedFileBatch {
  receiptId: string
  content: ReceivedFileSummary[]
  historyPending: ReceivedFileSummary[]
}

export interface ReceiveHistoryItem {
  name: string
  path: string
  time: number
}

export interface LegacyLocalStorageValues {
  name: string | null
  uuid: string | null
  whitelist: string | null
  receiveHistory: string | null
  filePath: string | null
}

interface SaveFilesResultBase {
  count: number
  path: string
  paths: string[]
  remaining: ReceivedFileSummary[]
  historyPending: ReceivedFileSummary[]
  historyPendingCount: number
}

export type SaveFilesResult =
  | (SaveFilesResultBase & {
      complete: true
      remainingCount: 0
      historyPendingCount: 0
    })
  | (SaveFilesResultBase & {
      complete: false
      remainingCount: number
    })

export interface ConnectionRefusedPayload {
  uuid: string
  name: string
}

export interface WhitelistSessionAcceptedPayload {
  name: string
}

export interface SyncerAPI {
  rendererReady: (legacyStorage: LegacyLocalStorageValues) => Promise<AppSnapshot>
  getState: () => Promise<AppSnapshot>
  getIpAddress: () => Promise<string>
  setDeviceName: (name: string) => Promise<AppSnapshot>
  discoverDevices: (manualIp?: string) => Promise<AppSnapshot>
  requestSession: (deviceUuid: string) => Promise<AppSnapshot>
  cancelConnectionRequest: () => Promise<AppSnapshot>
  acceptConnectionRequest: (requestId: string) => Promise<AppSnapshot>
  refuseConnectionRequest: (requestId: string) => Promise<AppSnapshot>
  endSession: () => Promise<AppSnapshot>
  sendText: (content: string) => Promise<void>
  sendFiles: (files: File[]) => Promise<void>
  sendCommand: (command: CommandKey) => Promise<void>
  setFindDeviceActive: (active: boolean) => Promise<void>
  isDeviceWhitelisted: (deviceUuid: string) => Promise<boolean>
  setDeviceWhitelisted: (deviceUuid: string, enabled: boolean) => Promise<void>
  getReceiveHistory: () => Promise<ReceiveHistoryItem[]>
  removeReceiveHistory: (items: ReceiveHistoryItem[]) => Promise<void>
  showReceivedFile: (item: ReceiveHistoryItem) => Promise<boolean>
  saveReceivedFiles: (receiptId: string) => Promise<SaveFilesResult | null>
  discardReceivedFiles: (receiptId: string) => Promise<void>
  getPendingReceivedFiles: () => Promise<ReceivedFileBatch[]>
  showWindow: () => Promise<void>
  onStateChanged: (callback: (state: AppSnapshot) => void) => () => void
  onWhitelistSessionAccepted: (
    callback: (payload: WhitelistSessionAcceptedPayload) => void
  ) => () => void
  onConnectionRefused: (callback: (payload: ConnectionRefusedPayload) => void) => () => void
  onTextReceived: (callback: (payload: { content: string }) => void) => () => void
  onFileReceived: (callback: (payload: ReceivedFileBatch) => void) => () => void
  onConnectionLost: (callback: () => void) => () => void
}
