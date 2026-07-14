import type { SyncerAPI } from '../shared/contracts'

declare global {
  interface Window {
    api: SyncerAPI
  }
}

export {}
