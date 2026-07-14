import SyncerStorage from '../../modules/syncer-storage';
import { mutateStorage, getStorage, setStorage, STORAGE_KEYS } from '../utils/storage';
import {
  migrateReceiveHistory,
  parseReceiveHistory,
  type ReceiveHistoryItem,
} from './receiveHistoryModel';

export type { ReceiveHistoryItem } from './receiveHistoryModel';

let initializationPromise: Promise<void> | null = null;

export function initializeReceiveHistory(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = migrateStoredReceiveHistory().catch((error: unknown) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export async function readReceiveHistory(): Promise<ReceiveHistoryItem[]> {
  await initializeReceiveHistory();
  return parseReceiveHistory(await getStorage<unknown>(STORAGE_KEYS.RECEIVE_HISTORY));
}

export async function prependReceiveHistory(
  items: readonly ReceiveHistoryItem[],
): Promise<ReceiveHistoryItem[]> {
  await initializeReceiveHistory();
  const additions = parseReceiveHistory(items);
  return mutateStorage(STORAGE_KEYS.RECEIVE_HISTORY, (current) => [
    ...additions,
    ...parseReceiveHistory(current),
  ]);
}

export async function removeReceiveHistory(
  items: readonly ReceiveHistoryItem[],
): Promise<ReceiveHistoryItem[]> {
  await initializeReceiveHistory();
  const removed = new Set(items.map(receiveHistoryKey));
  return mutateStorage(STORAGE_KEYS.RECEIVE_HISTORY, (current) =>
    parseReceiveHistory(current).filter((item) => !removed.has(receiveHistoryKey(item))),
  );
}

async function migrateStoredReceiveHistory(): Promise<void> {
  const current = await getStorage<unknown>(STORAGE_KEYS.RECEIVE_HISTORY);
  const migration = await migrateReceiveHistory(
    current,
    (uri, path, name) => SyncerStorage.migrateLegacyFileLocatorAsync(uri, path, name),
  );
  if (migration.changed) {
    await setStorage(STORAGE_KEYS.RECEIVE_HISTORY, migration.items);
  }
}

function receiveHistoryKey(item: ReceiveHistoryItem): string {
  return JSON.stringify([item.name, item.time, item.locator]);
}
