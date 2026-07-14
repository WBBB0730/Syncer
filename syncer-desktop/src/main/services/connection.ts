import type { CommandKey, SelectedFile } from '../../shared/contracts'
import { appState } from '../state'
import { refreshPresenceAnnounce, searchDevices } from './discovery'
import { emit } from './emit'
import {
  acceptPendingConnection,
  dialAndConnect,
  isSessionUpgradeInProgress,
  refusePendingConnection
} from './presence'
import { disconnectSession, sendCommand, sendFiles, sendText, setFindDeviceActive } from './session'

let activeDialController: AbortController | null = null

export function abortActiveConnectionAttempt(): void {
  activeDialController?.abort()
  activeDialController = null
}

function emitState(): void {
  emit('syncer:state-changed', appState.snapshot())
}

export async function discoverDevices(manualIp?: string): Promise<void> {
  await searchDevices(manualIp)
}

export async function requestSession(deviceUuid: string): Promise<void> {
  if (appState.status !== 'available' || isSessionUpgradeInProgress()) {
    throw new Error('A Session is already active')
  }
  if (appState.connectionRequest) throw new Error('A Connection Request is awaiting a decision')
  const device = appState.availableDeviceMap.get(deviceUuid)
  if (!device) throw new Error('Available Device is no longer present')

  activeDialController?.abort()
  const controller = new AbortController()
  activeDialController = controller
  appState.transitionSession('start-connection')
  appState.setTarget(device)
  refreshPresenceAnnounce()
  emitState()

  let result: Awaited<ReturnType<typeof dialAndConnect>>
  try {
    result = await dialAndConnect(device, { signal: controller.signal })
  } catch (error) {
    if (activeDialController === controller) {
      activeDialController = null
      appState.setTarget(null)
      appState.transitionSession('settle-available')
      refreshPresenceAnnounce()
      emitState()
    }
    throw error
  }
  if (activeDialController !== controller) return
  activeDialController = null
  if (result === 'accepted') return

  appState.setTarget(null)
  appState.transitionSession('settle-available')
  refreshPresenceAnnounce()
  emitState()
}

export async function cancelConnectionRequest(): Promise<void> {
  abortActiveConnectionAttempt()
  if (appState.status !== 'connecting') return
  await disconnectSession(false)
}

export async function acceptConnectionRequest(requestId: string): Promise<void> {
  await acceptPendingConnection(requestId)
}

export async function refuseConnectionRequest(requestId: string): Promise<void> {
  await refusePendingConnection(requestId)
}

export async function endSession(): Promise<void> {
  await disconnectSession(true)
}

export async function sendTextTransfer(content: string): Promise<void> {
  await sendText(content)
}

export async function sendFileTransfer(files: readonly SelectedFile[]): Promise<void> {
  await sendFiles(files)
}

export async function sendCommandMessage(command: CommandKey): Promise<void> {
  await sendCommand(command)
}

export async function setFindDevice(active: boolean): Promise<void> {
  await setFindDeviceActive(active)
}
