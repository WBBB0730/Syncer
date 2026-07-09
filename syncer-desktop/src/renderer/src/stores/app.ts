import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppSnapshot, DeviceInfo } from '../../../preload/index.d'

export const useAppStore = defineStore('app', () => {
  const uuid = ref('')
  const name = ref('')
  const status = ref<AppSnapshot['status']>('available')
  const target = ref<DeviceInfo | null>(null)
  const availableDevices = ref<DeviceInfo[]>([])
  const ipAddress = ref('')

  const connected = computed(() => status.value === 'connected')
  const connecting = computed(() => status.value === 'connecting')

  function applySnapshot(snapshot: AppSnapshot): void {
    uuid.value = snapshot.uuid
    name.value = snapshot.name
    status.value = snapshot.status
    target.value = snapshot.target
    availableDevices.value = snapshot.availableDevices
    ipAddress.value = snapshot.ipAddress
  }

  async function refresh(): Promise<void> {
    applySnapshot(await window.api.getState())
  }

  async function setName(next: string): Promise<void> {
    applySnapshot(await window.api.setName(next))
  }

  async function search(manualIp?: string): Promise<void> {
    applySnapshot(await window.api.search(manualIp))
  }

  async function connect(device: DeviceInfo): Promise<void> {
    applySnapshot(await window.api.connect(device))
  }

  async function cancel(): Promise<void> {
    applySnapshot(await window.api.cancel())
  }

  async function accept(device: DeviceInfo): Promise<void> {
    applySnapshot(await window.api.accept(device))
  }

  async function refuse(device: DeviceInfo): Promise<void> {
    await window.api.refuse(device)
  }

  async function disconnect(): Promise<void> {
    applySnapshot(await window.api.disconnect())
  }

  return {
    uuid,
    name,
    status,
    target,
    availableDevices,
    ipAddress,
    connected,
    connecting,
    applySnapshot,
    refresh,
    setName,
    search,
    connect,
    cancel,
    accept,
    refuse,
    disconnect
  }
})
