import { existsSync } from 'fs'
import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import {
  commandKeySchema,
  deviceNameSchema,
  deviceUuidSchema,
  isIpv4Address
} from '@syncer/protocol'
import type {
  AppSnapshot,
  LegacyLocalStorageValues,
  ReceiveHistoryItem,
  SelectedFile
} from '../shared/contracts'
import { appState } from './state'
import { isTrustedRendererUrl } from './security'
import {
  acceptConnectionRequest,
  cancelConnectionRequest,
  discoverDevices,
  endSession,
  refuseConnectionRequest,
  requestSession,
  sendCommandMessage,
  sendFileTransfer,
  sendTextTransfer,
  setFindDevice
} from './services/connection'
import {
  discardReceivedFiles,
  getPendingReceivedFiles,
  saveReceivedFiles
} from './services/session'
import { getIpAddress } from './utils/ip'
import { getStorage, setStorage, STORAGE_KEYS } from './utils/storage'
import { legacyLocalStorageValuesSchema, resolveReceiveHistoryPath } from './utils/storageSchema'

type IpcHandler<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult | Promise<TResult>

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  showMainWindow: () => void,
  initializeRenderer: (legacyStorage: LegacyLocalStorageValues) => Promise<AppSnapshot>
): void {
  const handle = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: IpcHandler<TArgs, TResult>
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, getMainWindow())
      return handler(...(args as TArgs))
    })
  }

  handle('syncer:renderer-ready', (value: unknown) =>
    initializeRenderer(legacyLocalStorageValuesSchema.parse(value))
  )
  handle('syncer:get-state', () => appState.snapshot())
  handle('syncer:get-ip-address', () => getIpAddress())

  handle('syncer:set-device-name', (value: unknown) => {
    appState.setName(deviceNameSchema.parse(value))
    return appState.snapshot()
  })

  handle('syncer:discover-devices', async (value?: unknown) => {
    const manualIp = value == null ? undefined : expectString(value, 'IP address')
    if (manualIp && !isIpv4Address(manualIp))
      throw new TypeError('IP address must be a valid IPv4 address')
    await discoverDevices(manualIp)
    return appState.snapshot()
  })

  handle('syncer:request-session', async (value: unknown) => {
    await requestSession(deviceUuidSchema.parse(value))
    return appState.snapshot()
  })

  handle('syncer:cancel-connection-request', async () => {
    await cancelConnectionRequest()
    return appState.snapshot()
  })

  handle('syncer:accept-connection-request', async (value: unknown) => {
    await acceptConnectionRequest(deviceUuidSchema.parse(value))
    return appState.snapshot()
  })

  handle('syncer:refuse-connection-request', async (value: unknown) => {
    await refuseConnectionRequest(deviceUuidSchema.parse(value))
    return appState.snapshot()
  })

  handle('syncer:end-session', async () => {
    await endSession()
    return appState.snapshot()
  })

  handle('syncer:send-text', async (value: unknown) => {
    await sendTextTransfer(expectString(value, 'Text Transfer content', true))
  })

  handle('syncer:send-files', async (value: unknown) => {
    await sendFileTransfer(expectSelectedFiles(value))
  })

  handle('syncer:send-command', async (value: unknown) => {
    await sendCommandMessage(commandKeySchema.parse(value))
  })

  handle('syncer:set-find-device-active', async (value: unknown) => {
    if (typeof value !== 'boolean') throw new TypeError('Find Device state must be a boolean')
    await setFindDevice(value)
  })

  handle('syncer:is-device-whitelisted', (value: unknown) => {
    const uuid = deviceUuidSchema.parse(value)
    const whitelist = getStorage(STORAGE_KEYS.WHITELIST) ?? {}
    return Object.hasOwn(whitelist, uuid) && whitelist[uuid] === true
  })

  handle('syncer:set-device-whitelisted', (uuidValue: unknown, enabledValue: unknown) => {
    const uuid = deviceUuidSchema.parse(uuidValue)
    if (typeof enabledValue !== 'boolean') throw new TypeError('Whitelist state must be a boolean')
    const whitelist = getStorage(STORAGE_KEYS.WHITELIST) ?? {}
    if (enabledValue) whitelist[uuid] = true
    else delete whitelist[uuid]
    setStorage(STORAGE_KEYS.WHITELIST, whitelist)
  })

  handle('syncer:get-receive-history', () => getStorage(STORAGE_KEYS.RECEIVE_HISTORY) ?? [])

  handle('syncer:remove-receive-history', (value: unknown) => {
    const removed = new Set(expectHistoryItems(value).map(historyKey))
    const history = getStorage(STORAGE_KEYS.RECEIVE_HISTORY) ?? []
    setStorage(
      STORAGE_KEYS.RECEIVE_HISTORY,
      history.filter((item) => !removed.has(historyKey(item)))
    )
  })

  handle('syncer:show-received-file', (value: unknown) => {
    const item = expectHistoryItem(value)
    const history = getStorage(STORAGE_KEYS.RECEIVE_HISTORY) ?? []
    if (!history.some((entry) => historyKey(entry) === historyKey(item))) return false
    const path = resolveReceiveHistoryPath(item)
    if (!path || !existsSync(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  handle('syncer:save-received-files', (value: unknown) =>
    saveReceivedFiles(deviceUuidSchema.parse(value))
  )

  handle('syncer:discard-received-files', async (value: unknown) => {
    await discardReceivedFiles(deviceUuidSchema.parse(value))
  })

  handle('syncer:get-pending-received-files', () => getPendingReceivedFiles())

  handle('syncer:show-window', () => {
    showMainWindow()
  })
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('Rejected IPC from an untrusted renderer')
  }
}

function expectString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
  return value
}

function expectSelectedFiles(value: unknown): SelectedFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('File Transfer is empty')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new TypeError('Invalid selected file')
    const selected = item as Record<string, unknown>
    const mimeType = selected.mimeType
    if (mimeType != null && typeof mimeType !== 'string') {
      throw new TypeError('Selected file MIME type must be a string')
    }
    return {
      path: expectString(selected.path, 'Selected file path'),
      name: expectString(selected.name, 'Selected file name'),
      mimeType: mimeType || undefined
    }
  })
}

function expectHistoryItems(value: unknown): ReceiveHistoryItem[] {
  if (!Array.isArray(value)) throw new TypeError('Receive History selection must be an array')
  return value.map(expectHistoryItem)
}

function expectHistoryItem(value: unknown): ReceiveHistoryItem {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid Receive History item')
  const item = value as Record<string, unknown>
  if (typeof item.time !== 'number' || !Number.isFinite(item.time)) {
    throw new TypeError('Receive History time must be a finite number')
  }
  return {
    name: expectString(item.name, 'Receive History file name'),
    path: expectString(item.path, 'Receive History path'),
    time: item.time
  }
}

function historyKey(item: ReceiveHistoryItem): string {
  return JSON.stringify([item.name, item.path, item.time])
}
