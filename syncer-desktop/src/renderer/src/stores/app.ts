import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AppSnapshot,
  AvailableDevice,
  ConnectionRequest,
  LegacyLocalStorageValues
} from '../../../shared/contracts'

export const useAppStore = defineStore('app', () => {
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const revision = ref(-1)
  const uuid = ref('')
  const name = ref('')
  const status = ref<AppSnapshot['status']>('available')
  const target = ref<AvailableDevice | null>(null)
  const availableDevices = ref<AvailableDevice[]>([])
  const connectionRequest = ref<ConnectionRequest | null>(null)

  const connected = computed(() => status.value === 'connected')
  const connecting = computed(() => status.value === 'connecting')

  function applySnapshot(snapshot: AppSnapshot): void {
    if (snapshot.revision < revision.value) return
    revision.value = snapshot.revision
    uuid.value = snapshot.uuid
    name.value = snapshot.name
    status.value = snapshot.status
    target.value = snapshot.target
    availableDevices.value = snapshot.availableDevices
    connectionRequest.value = snapshot.connectionRequest
  }

  async function refresh(): Promise<void> {
    applySnapshot(await window.api.getState())
  }

  async function initialize(legacyStorage: LegacyLocalStorageValues): Promise<void> {
    applySnapshot(await window.api.rendererReady(legacyStorage))
    resolveReady()
  }

  function whenReady(): Promise<void> {
    return ready
  }

  async function setDeviceName(next: string): Promise<void> {
    applySnapshot(await window.api.setDeviceName(next))
  }

  async function discoverDevices(manualIp?: string): Promise<void> {
    applySnapshot(await window.api.discoverDevices(manualIp))
  }

  async function requestSession(device: AvailableDevice): Promise<void> {
    applySnapshot(await window.api.requestSession(device.uuid))
  }

  async function cancelConnectionRequest(): Promise<void> {
    applySnapshot(await window.api.cancelConnectionRequest())
  }

  async function acceptConnectionRequest(requestId: string): Promise<void> {
    applySnapshot(await window.api.acceptConnectionRequest(requestId))
  }

  async function refuseConnectionRequest(requestId: string): Promise<void> {
    applySnapshot(await window.api.refuseConnectionRequest(requestId))
  }

  async function endSession(): Promise<void> {
    applySnapshot(await window.api.endSession())
  }

  return {
    revision,
    uuid,
    name,
    status,
    target,
    availableDevices,
    connectionRequest,
    connected,
    connecting,
    applySnapshot,
    initialize,
    whenReady,
    refresh,
    setDeviceName,
    discoverDevices,
    requestSession,
    cancelConnectionRequest,
    acceptConnectionRequest,
    refuseConnectionRequest,
    endSession
  }
})
