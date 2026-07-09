import AsyncStorage from '@react-native-async-storage/async-storage';
import Storage from 'react-native-storage';

const storage = new Storage({
  size: 1000,
  storageBackend: AsyncStorage,
  defaultExpires: null,
  enableCache: true,
});

async function setStorage<T>(key: string, data: T) {
  await storage.save({ key, data });
}

async function getStorage<T = unknown>(key: string): Promise<T | null> {
  return storage.load({ key }).catch(() => null);
}

const STORAGE_KEYS = {
  NAME: 'name',
  UUID: 'uuid',
  WHITE_LIST: 'whiteList',
  RECEIVE_HISTORY: 'receiveHistory',
} as const;

export { getStorage, setStorage, STORAGE_KEYS };
