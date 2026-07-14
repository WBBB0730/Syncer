import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { LegacyLocalStorageValues } from '../../shared/contracts'
import { AtomicJsonStorage } from './atomicStorage'
import {
  migrateLegacyLocalStorage,
  migrateLegacyStorage,
  storageSchema,
  type StorageData,
  type StorageValues
} from './storageSchema'

export const STORAGE_KEYS = {
  NAME: 'name',
  UUID: 'uuid',
  WHITELIST: 'whitelist',
  RECEIVE_HISTORY: 'receiveHistory',
  FILE_PATH: 'filePath'
} as const

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

let storage: AtomicJsonStorage<StorageData> | null = null

export function initializeStorageFile(
  path: string,
  legacyStorage: LegacyLocalStorageValues
): AtomicJsonStorage<StorageData> {
  const file = new AtomicJsonStorage(path, storageSchema, migrateLegacyStorage)
  if (existsSync(path)) file.read()
  else file.write(migrateLegacyLocalStorage(legacyStorage))
  return file
}

export function initializeStorage(legacyStorage: LegacyLocalStorageValues): void {
  if (storage) throw new Error('Storage is already initialized')
  storage = initializeStorageFile(join(app.getPath('userData'), 'syncer-store.json'), legacyStorage)
}

function getStorageFile(): AtomicJsonStorage<StorageData> {
  if (!storage) throw new Error('Storage is not initialized')
  return storage
}

export function setStorage<K extends StorageKey>(key: K, value: StorageValues[K]): void {
  const data = getStorageFile().read()
  data[key] = value
  getStorageFile().write(data)
}

export function getStorage<K extends StorageKey>(key: K): StorageValues[K] | null {
  return getStorageFile().read()[key] ?? null
}
