import net from 'net'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { PROTOCOL_PORT, TCP_DELIMITER } from '../constants'
import { appState } from '../state'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

let tcpSocket: net.Socket | null = null
let queue = ''

const server = net.createServer((socket) => {
  if (appState.status !== 'connecting') return
  socket.once('data', (data) => {
    const parsed = parseData(data)
    console.log('TCP: receive', parsed)
    if (!parsed || parsed.type !== 'accept') {
      socket.destroy()
      return
    }
    handleAccept(socket, parsed)
  })
})

function sendToRenderer(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function openTcpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      resolve()
      return
    }
    server.once('error', reject)
    server.listen({ port: PROTOCOL_PORT }, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

export function closeTcpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

export function connectTcpServer({ port, address }: { port: number; address: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    tcpSocket = new net.Socket()
    tcpSocket.connect({ port, host: address }, () => {
      initTcpSocket()
      resolve()
    })
    tcpSocket.once('error', reject)
  })
}

export function closeTcpSocket(): void {
  if (!tcpSocket) return
  tcpSocket.destroy()
  tcpSocket = null
}

function initTcpSocket(): void {
  if (!tcpSocket) return
  tcpSocket.setKeepAlive(true)
  tcpSocket.on('data', (data) => {
    const parsed = parseData(data)
    if (!parsed) return
    console.log(
      'TCP: receive',
      parsed.type === 'file'
        ? { type: 'file', content: (parsed.content as { name: string }[]).map((f) => f.name) }
        : parsed
    )
    switch (parsed.type) {
      case 'disconnect':
        handleDisconnect()
        break
      case 'text':
        sendToRenderer('syncer:text-received', { content: parsed.content })
        break
      case 'file':
        sendToRenderer('syncer:file-received', {
          content: parsed.content as { name: string; data: string }[]
        })
        break
      case 'command':
        void handleCommand(String(parsed.content))
        break
    }
  })
  tcpSocket.on('close', () => {
    handleDisconnect()
    sendToRenderer('syncer:connection-lost')
  })
}

function parseData(data: Buffer | string): Record<string, unknown> | null | undefined {
  const text = queue + data.toString()
  if (text.endsWith(TCP_DELIMITER)) {
    queue = ''
    try {
      const parsed = JSON.parse(text.slice(0, -1)) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || !parsed.type) return null
      return parsed
    } catch {
      return null
    }
  }
  queue = text
  return undefined
}

export function sendTcpData(data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!tcpSocket) {
      resolve()
      return
    }
    tcpSocket.write(JSON.stringify(data) + TCP_DELIMITER, 'utf8', () => resolve())
    console.log(
      'TCP: send',
      data.type === 'file'
        ? { type: 'file', content: (data.content as { name: string }[]).map((f) => f.name) }
        : data
    )
  })
}

function handleAccept(socket: net.Socket, data: Record<string, unknown>): void {
  if (appState.status !== 'connecting' || data.uuid !== appState.target?.uuid) {
    socket.destroy()
    return
  }
  const addr = socket.address()
  console.log('TCP connected', addr)
  tcpSocket = socket
  if (typeof addr === 'object' && addr !== null && 'port' in addr) {
    const info = addr as net.AddressInfo
    appState.setTarget({
      ...appState.target!,
      port: info.port,
      address: info.address
    })
  }
  appState.setStatus('connected')
  initTcpSocket()
  void closeTcpServer()
  sendToRenderer('syncer:state-changed', appState.snapshot())
}

function handleDisconnect(): void {
  closeTcpSocket()
  appState.setTarget(null)
  appState.setStatus('available')
  sendToRenderer('syncer:state-changed', appState.snapshot())
}

export async function saveReceivedFiles(
  content: { name: string; data: string }[]
): Promise<{ count: number; path: string } | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '保存文件',
    defaultPath: getStorage<string>(STORAGE_KEYS.FILE_PATH) || undefined,
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const dir = result.filePaths[0]
  setStorage(STORAGE_KEYS.FILE_PATH, dir)
  const receiveHistory =
    getStorage<{ name: string; path: string; time: number }[]>(STORAGE_KEYS.RECEIVE_HISTORY) || []

  for (const file of content) {
    const extIndex = file.name.lastIndexOf('.')
    const base = file.name.slice(0, extIndex)
    const ext = file.name.slice(extIndex)
    let fileName = file.name
    let i = 1
    while (existsSync(join(dir, fileName))) {
      fileName = `${base} (${i++})${ext}`
    }
    await writeFile(join(dir, fileName), file.data, { encoding: 'base64' })
    receiveHistory.unshift({ name: fileName, path: dir, time: Date.now() })
  }
  setStorage(STORAGE_KEYS.RECEIVE_HISTORY, receiveHistory)
  return { count: content.length, path: dir }
}

const KEY_MAP: Record<string, Key> = {
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  space: Key.Space,
  escape: Key.Escape,
  f5: Key.F5,
  audio_mute: Key.AudioMute,
  audio_vol_down: Key.AudioVolDown,
  audio_vol_up: Key.AudioVolUp
}

async function handleCommand(content: string): Promise<void> {
  const key = KEY_MAP[content]
  if (!key) {
    console.warn('Unknown command key:', content)
    return
  }
  await keyboard.pressKey(key)
  await keyboard.releaseKey(key)
}
