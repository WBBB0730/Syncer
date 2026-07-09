import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const STORAGE_KEYS = {
  NAME: 'name',
  UUID: 'uuid',
  WHITE_LIST: 'whiteList',
  RECEIVE_HISTORY: 'receiveHistory',
  FILE_PATH: 'filePath'
} as const

type StorageData = Record<string, unknown>

function getStorePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'syncer-store.json')
}

function readAll(): StorageData {
  const path = getStorePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StorageData
  } catch {
    return {}
  }
}

function writeAll(data: StorageData): void {
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf8')
}

export function setStorage(key: string, value: unknown): void {
  const data = readAll()
  data[key] = value
  writeAll(data)
}

export function getStorage<T = unknown>(key: string): T | null {
  const data = readAll()
  return (data[key] as T) ?? null
}
