import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface DeviceInfo {
  uuid: string
  name: string
  device: string
  port: number
  address: string
}

export interface AppSnapshot {
  uuid: string
  name: string
  status: 'available' | 'connecting' | 'connected'
  target: DeviceInfo | null
  availableDevices: DeviceInfo[]
  ipAddress: string
}

const api = {
  getState: (): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:get-state'),
  getIpAddress: (): Promise<string> => ipcRenderer.invoke('syncer:get-ip-address'),
  setName: (name: string): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:set-name', name),
  search: (manualIp?: string): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:search', manualIp),
  connect: (device: DeviceInfo): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:connect', device),
  cancel: (): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:cancel'),
  accept: (device: DeviceInfo): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:accept', device),
  refuse: (device: DeviceInfo): Promise<void> => ipcRenderer.invoke('syncer:refuse', device),
  disconnect: (): Promise<AppSnapshot> => ipcRenderer.invoke('syncer:disconnect'),
  sendTcp: (data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('syncer:send-tcp', data),
  saveFiles: (
    content: { name: string; data: string }[]
  ): Promise<{ count: number; path: string } | null> =>
    ipcRenderer.invoke('syncer:save-files', content),
  getStorage: <T = unknown>(key: string): Promise<T | null> =>
    ipcRenderer.invoke('syncer:get-storage', key),
  setStorage: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('syncer:set-storage', key, value),
  getWhiteList: (): Promise<Record<string, boolean>> => ipcRenderer.invoke('syncer:get-whitelist'),
  setWhiteList: (whiteList: Record<string, boolean>): Promise<void> =>
    ipcRenderer.invoke('syncer:set-whitelist', whiteList),
  getReceiveHistory: (): Promise<{ name: string; path: string; time: number }[]> =>
    ipcRenderer.invoke('syncer:get-receive-history'),
  setReceiveHistory: (history: { name: string; path: string; time: number }[]): Promise<void> =>
    ipcRenderer.invoke('syncer:set-receive-history', history),
  showItemInFolder: (dir: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke('syncer:show-item-in-folder', dir, name),
  showWindow: (): Promise<void> => ipcRenderer.invoke('syncer:show-window'),

  onStateChanged: (callback: (state: AppSnapshot) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: AppSnapshot): void => callback(state)
    ipcRenderer.on('syncer:state-changed', handler)
    return () => ipcRenderer.removeListener('syncer:state-changed', handler)
  },
  onConnectRequest: (callback: (device: DeviceInfo) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, device: DeviceInfo): void => callback(device)
    ipcRenderer.on('syncer:connect-request', handler)
    return () => ipcRenderer.removeListener('syncer:connect-request', handler)
  },
  onAutoAccept: (callback: (device: DeviceInfo) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, device: DeviceInfo): void => callback(device)
    ipcRenderer.on('syncer:auto-accept', handler)
    return () => ipcRenderer.removeListener('syncer:auto-accept', handler)
  },
  onConnectRefused: (callback: (payload: { uuid: string; name: string }) => void): (() => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { uuid: string; name: string }
    ): void => callback(payload)
    ipcRenderer.on('syncer:connect-refused', handler)
    return () => ipcRenderer.removeListener('syncer:connect-refused', handler)
  },
  onTextReceived: (callback: (payload: { content: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { content: string }): void =>
      callback(payload)
    ipcRenderer.on('syncer:text-received', handler)
    return () => ipcRenderer.removeListener('syncer:text-received', handler)
  },
  onFileReceived: (
    callback: (payload: { content: { name: string; data: string }[] }) => void
  ): (() => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { content: { name: string; data: string }[] }
    ): void => callback(payload)
    ipcRenderer.on('syncer:file-received', handler)
    return () => ipcRenderer.removeListener('syncer:file-received', handler)
  },
  onConnectionLost: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('syncer:connection-lost', handler)
    return () => ipcRenderer.removeListener('syncer:connection-lost', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error fallback without isolation
  window.electron = electronAPI
  // @ts-expect-error fallback without isolation
  window.api = api
}
