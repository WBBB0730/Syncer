import dgram from 'dgram'
import { BrowserWindow } from 'electron'
import { DEVICE_TYPE, PROTOCOL_PORT } from '../constants'
import { appState, type DeviceInfo } from '../state'
import { getStorage, STORAGE_KEYS } from '../utils/storage'

export type UdpOutbound = { type: string; [key: string]: unknown }

let udpSocket: dgram.Socket | null = null

function sendToRenderer(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function initUdpService(): void {
  if (udpSocket) return

  udpSocket = dgram.createSocket('udp4')
  udpSocket.bind({ port: PROTOCOL_PORT }, () => {
    udpSocket?.setBroadcast(true)
  })

  udpSocket.on('message', (msg, { port, address }) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(msg.toString()) as Record<string, unknown>
      if (typeof data !== 'object' || !data.type || !data.uuid || data.uuid === appState.uuid) return
    } catch {
      return
    }

    console.log(`UDP: receive from ${address}:${port}`, data)

    switch (data.type) {
      case 'search':
        handleSearch(port, address)
        break
      case 'available':
        handleAvailable(data, port, address)
        break
      case 'connect':
        void handleConnect(data, port, address)
        break
      case 'refuse':
        handleRefuse(data)
        break
    }
  })
}

export function sendUdpData(data: UdpOutbound, port: number, address: string): void {
  if (!udpSocket) return
  const payload = {
    ...data,
    uuid: appState.uuid,
    name: appState.name,
    device: DEVICE_TYPE
  }
  udpSocket.send(JSON.stringify(payload), port, address)
  console.log(`UDP: send to ${address}:${port}`, payload)
}

function handleSearch(port: number, address: string): void {
  if (appState.status !== 'available') return
  sendUdpData({ type: 'available' }, port, address)
}

function handleAvailable(data: Record<string, unknown>, port: number, address: string): void {
  const device: DeviceInfo = {
    uuid: String(data.uuid),
    name: String(data.name ?? ''),
    device: String(data.device ?? 'unknown'),
    port,
    address
  }
  appState.addAvailableDevice(device)
  sendToRenderer('syncer:state-changed', appState.snapshot())
}

async function handleConnect(data: Record<string, unknown>, port: number, address: string): Promise<void> {
  if (appState.status !== 'available') return

  const device: DeviceInfo = {
    uuid: String(data.uuid),
    name: String(data.name ?? ''),
    device: String(data.device ?? 'unknown'),
    port,
    address
  }

  const whiteList = getStorage<Record<string, boolean>>(STORAGE_KEYS.WHITE_LIST) || {}
  if (whiteList[device.uuid]) {
    sendToRenderer('syncer:auto-accept', device)
    return
  }

  sendToRenderer('syncer:notify', { title: '连接请求', body: device.name })
  sendToRenderer('syncer:connect-request', device)
}

function handleRefuse(data: Record<string, unknown>): void {
  if (appState.status !== 'connecting' || appState.target?.uuid !== data.uuid) return
  sendToRenderer('syncer:connect-refused', {
    uuid: data.uuid,
    name: data.name
  })
}

export function refuseConnect(device: DeviceInfo): void {
  sendUdpData({ type: 'refuse' }, device.port, device.address)
}
