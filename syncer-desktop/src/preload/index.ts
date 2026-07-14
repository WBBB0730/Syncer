import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  CONNECTION_ATTEMPT_FAILED_CHANNEL,
  WHITELIST_SESSION_ACCEPTED_CHANNEL,
  type AppSnapshot,
  type CommandKey,
  type ConnectionAttemptFailedPayload,
  type ConnectionRefusedPayload,
  type LegacyLocalStorageValues,
  type ReceiveHistoryItem,
  type ReceivedFileBatch,
  type SaveFilesResult,
  type SyncerAPI,
  type WhitelistSessionAcceptedPayload
} from '../shared/contracts'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: SyncerAPI = {
  rendererReady: (legacyStorage: LegacyLocalStorageValues): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:renderer-ready', legacyStorage),
  getState: (): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:get-state'),
  getIpAddress: (): Promise<string> => ipcRenderer.invoke('syncer:get-ip-address'),
  setDeviceName: (name: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:set-device-name', name),
  discoverDevices: (manualIp?: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:discover-devices', manualIp),
  requestSession: (deviceUuid: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:request-session', deviceUuid),
  cancelConnectionRequest: (): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:cancel-connection-request'),
  acceptConnectionRequest: (requestId: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:accept-connection-request', requestId),
  refuseConnectionRequest: (requestId: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke('syncer:refuse-connection-request', requestId),
  endSession: (): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:end-session'),
  sendText: (content: string): Promise<void> => ipcRenderer.invoke('syncer:send-text', content),
  sendFiles: (files: File[]): Promise<void> => {
    const selected = files.map((file) => ({
      path: webUtils.getPathForFile(file),
      name: file.name,
      mimeType: file.type || undefined
    }))
    return ipcRenderer.invoke('syncer:send-files', selected)
  },
  sendCommand: (command: CommandKey): Promise<void> =>
    ipcRenderer.invoke('syncer:send-command', command),
  setFindDeviceActive: (active: boolean): Promise<void> =>
    ipcRenderer.invoke('syncer:set-find-device-active', active),
  isDeviceWhitelisted: (deviceUuid: string): Promise<boolean> =>
    ipcRenderer.invoke('syncer:is-device-whitelisted', deviceUuid),
  setDeviceWhitelisted: (deviceUuid: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('syncer:set-device-whitelisted', deviceUuid, enabled),
  getReceiveHistory: (): Promise<ReceiveHistoryItem[]> =>
    ipcRenderer.invoke('syncer:get-receive-history'),
  removeReceiveHistory: (items: ReceiveHistoryItem[]): Promise<void> =>
    ipcRenderer.invoke('syncer:remove-receive-history', items),
  showReceivedFile: (item: ReceiveHistoryItem): Promise<boolean> =>
    ipcRenderer.invoke('syncer:show-received-file', item),
  saveReceivedFiles: (receiptId: string): Promise<SaveFilesResult | null> =>
    ipcRenderer.invoke('syncer:save-received-files', receiptId),
  discardReceivedFiles: (receiptId: string): Promise<void> =>
    ipcRenderer.invoke('syncer:discard-received-files', receiptId),
  getPendingReceivedFiles: (): Promise<ReceivedFileBatch[]> =>
    ipcRenderer.invoke('syncer:get-pending-received-files'),
  showWindow: (): Promise<void> => ipcRenderer.invoke('syncer:show-window'),
  onStateChanged: (callback: (state: AppSnapshot) => void): (() => void) =>
    subscribe('syncer:state-changed', callback),
  onWhitelistSessionAccepted: (
    callback: (payload: WhitelistSessionAcceptedPayload) => void
  ): (() => void) => subscribe(WHITELIST_SESSION_ACCEPTED_CHANNEL, callback),
  onConnectionRefused: (callback: (payload: ConnectionRefusedPayload) => void): (() => void) =>
    subscribe('syncer:connection-refused', callback),
  onConnectionAttemptFailed: (
    callback: (payload: ConnectionAttemptFailedPayload) => void
  ): (() => void) => subscribe(CONNECTION_ATTEMPT_FAILED_CHANNEL, callback),
  onTextReceived: (callback: (payload: { content: string }) => void): (() => void) =>
    subscribe('syncer:text-received', callback),
  onFileReceived: (callback: (payload: ReceivedFileBatch) => void): (() => void) =>
    subscribe('syncer:file-received', callback),
  onConnectionLost: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('syncer:connection-lost', handler)
    return () => ipcRenderer.removeListener('syncer:connection-lost', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
