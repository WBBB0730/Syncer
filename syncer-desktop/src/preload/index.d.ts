import { ElectronAPI } from '@electron-toolkit/preload'

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

export interface SyncerAPI {
  getState: () => Promise<AppSnapshot>
  getIpAddress: () => Promise<string>
  setName: (name: string) => Promise<AppSnapshot>
  search: (manualIp?: string) => Promise<AppSnapshot>
  connect: (device: DeviceInfo) => Promise<AppSnapshot>
  cancel: () => Promise<AppSnapshot>
  accept: (device: DeviceInfo) => Promise<AppSnapshot>
  refuse: (device: DeviceInfo) => Promise<void>
  disconnect: () => Promise<AppSnapshot>
  sendTcp: (data: Record<string, unknown>) => Promise<void>
  saveFiles: (
    content: { name: string; data: string }[]
  ) => Promise<{ count: number; path: string } | null>
  getStorage: <T = unknown>(key: string) => Promise<T | null>
  setStorage: (key: string, value: unknown) => Promise<void>
  getWhiteList: () => Promise<Record<string, boolean>>
  setWhiteList: (whiteList: Record<string, boolean>) => Promise<void>
  getReceiveHistory: () => Promise<{ name: string; path: string; time: number }[]>
  setReceiveHistory: (history: { name: string; path: string; time: number }[]) => Promise<void>
  showItemInFolder: (dir: string, name: string) => Promise<boolean>
  showWindow: () => Promise<void>
  onStateChanged: (callback: (state: AppSnapshot) => void) => () => void
  onConnectRequest: (callback: (device: DeviceInfo) => void) => () => void
  onAutoAccept: (callback: (device: DeviceInfo) => void) => () => void
  onConnectRefused: (callback: (payload: { uuid: string; name: string }) => void) => () => void
  onTextReceived: (callback: (payload: { content: string }) => void) => () => void
  onFileReceived: (
    callback: (payload: { content: { name: string; data: string }[] }) => void
  ) => () => void
  onConnectionLost: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: SyncerAPI
  }
}

export {}
