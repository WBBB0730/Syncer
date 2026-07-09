import { BrowserWindow } from 'electron'
import { PROTOCOL_PORT } from '../constants'
import { appState, type DeviceInfo } from '../state'
import { sendUdpData } from './udpService'
import {
  closeTcpServer,
  closeTcpSocket,
  connectTcpServer,
  openTcpServer,
  sendTcpData
} from './tcpService'

function sendToRenderer(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function emitState(): void {
  sendToRenderer('syncer:state-changed', appState.snapshot())
}

export async function connectToDevice(device: DeviceInfo): Promise<void> {
  await openTcpServer()
  appState.setStatus('connecting')
  appState.setTarget(device)
  sendUdpData({ type: 'connect' }, device.port, device.address)
  emitState()
}

export async function cancelConnect(): Promise<void> {
  await closeTcpServer()
  appState.setStatus('available')
  appState.setTarget(null)
  emitState()
}

export async function acceptConnection(device: DeviceInfo): Promise<void> {
  await connectTcpServer(device)
  await sendTcpData({
    type: 'accept',
    uuid: appState.uuid
  })
  appState.setTarget(device)
  appState.setStatus('connected')
  emitState()
}

export async function disconnect(): Promise<void> {
  closeTcpSocket()
  appState.setTarget(null)
  appState.setStatus('available')
  emitState()
}

export async function searchDevices(manualIp?: string): Promise<void> {
  appState.clearAvailableDeviceMap()
  emitState()
  for (let i = 0; i < 5; i++) {
    sendUdpData({ type: 'search' }, PROTOCOL_PORT, '255.255.255.255')
    if (manualIp) sendUdpData({ type: 'search' }, PROTOCOL_PORT, manualIp)
    await new Promise((r) => setTimeout(r, 500))
  }
  emitState()
}
