import { BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { appState } from './state'
import { getIpAddress } from './utils/ip'
import { getStorage, setStorage, STORAGE_KEYS } from './utils/storage'
import {
  acceptConnection,
  cancelConnect,
  connectToDevice,
  disconnect,
  searchDevices
} from './services/connection'
import { refuseConnect } from './services/udpService'
import { saveReceivedFiles, sendTcpData } from './services/tcpService'
import type { DeviceInfo } from './state'

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('syncer:get-state', () => appState.snapshot())

  ipcMain.handle('syncer:get-ip-address', () => getIpAddress())

  ipcMain.handle('syncer:set-name', (_e, name: string) => {
    appState.setName(name)
    return appState.snapshot()
  })

  ipcMain.handle('syncer:search', async (_e, manualIp?: string) => {
    await searchDevices(manualIp)
    return appState.snapshot()
  })

  ipcMain.handle('syncer:connect', async (_e, device: DeviceInfo) => {
    await connectToDevice(device)
    return appState.snapshot()
  })

  ipcMain.handle('syncer:cancel', async () => {
    await cancelConnect()
    return appState.snapshot()
  })

  ipcMain.handle('syncer:accept', async (_e, device: DeviceInfo) => {
    await acceptConnection(device)
    return appState.snapshot()
  })

  ipcMain.handle('syncer:refuse', (_e, device: DeviceInfo) => {
    refuseConnect(device)
  })

  ipcMain.handle('syncer:disconnect', async () => {
    await disconnect()
    return appState.snapshot()
  })

  ipcMain.handle('syncer:send-tcp', async (_e, data: Record<string, unknown>) => {
    await sendTcpData(data)
  })

  ipcMain.handle(
    'syncer:save-files',
    async (_e, content: { name: string; data: string }[]) => saveReceivedFiles(content)
  )

  ipcMain.handle('syncer:get-storage', (_e, key: string) => getStorage(key))
  ipcMain.handle('syncer:set-storage', (_e, key: string, value: unknown) => {
    setStorage(key, value)
  })

  ipcMain.handle('syncer:get-whitelist', () => getStorage(STORAGE_KEYS.WHITE_LIST) || {})
  ipcMain.handle('syncer:set-whitelist', (_e, whiteList: Record<string, boolean>) => {
    setStorage(STORAGE_KEYS.WHITE_LIST, whiteList)
  })

  ipcMain.handle('syncer:get-receive-history', () => getStorage(STORAGE_KEYS.RECEIVE_HISTORY) || [])
  ipcMain.handle(
    'syncer:set-receive-history',
    (_e, history: { name: string; path: string; time: number }[]) => {
      setStorage(STORAGE_KEYS.RECEIVE_HISTORY, history)
    }
  )

  ipcMain.handle('syncer:show-item-in-folder', (_e, dir: string, name: string) => {
    const path = join(dir, name)
    if (!existsSync(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle('syncer:show-window', () => {
    const win = getMainWindow()
    win?.show()
  })
}
