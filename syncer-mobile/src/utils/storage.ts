import AsyncStorage from '@react-native-async-storage/async-storage';

import { createSerializedStorage } from './serializedStorage';

const storage = createSerializedStorage(AsyncStorage);

function setStorage<T>(key: string, data: T): Promise<void> {
  return storage.set(key, data);
}

function getStorage<T = unknown>(key: string): Promise<T | null> {
  return storage.get<T>(key);
}

function mutateStorage<T>(
  key: string,
  mutate: (current: unknown | null) => T,
): Promise<T> {
  return storage.mutate(key, mutate);
}

const STORAGE_KEYS = {
  IDENTITY: 'identity',
  NAME: 'name',
  UUID: 'uuid',
  WHITELIST: 'whiteList',
  RECEIVE_HISTORY: 'receiveHistory',
} as const;

export { getStorage, mutateStorage, setStorage, STORAGE_KEYS };
