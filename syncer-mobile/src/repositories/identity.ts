import {
  deviceNameSchema,
  deviceUuidSchema,
  hasUnsafeDisplayControls,
  utf8ByteLength,
} from '@syncer/protocol';

import { getStorage, mutateStorage, setStorage, STORAGE_KEYS } from '../utils/storage';

export type StoredDeviceIdentity = {
  name: string;
  uuid: string;
};

export async function loadOrCreateIdentity(
  defaultName: string,
  defaultUuid: string,
): Promise<StoredDeviceIdentity> {
  const stored = await getStorage<unknown>(STORAGE_KEYS.IDENTITY);
  if (stored !== null) return parseStoredIdentity(stored);

  const [legacyName, legacyUuid] = await Promise.all([
    getStorage<unknown>(STORAGE_KEYS.NAME),
    getStorage<unknown>(STORAGE_KEYS.UUID),
  ]);
  const identity = {
    name: migrateLegacyName(legacyName, deviceNameSchema.parse(defaultName)),
    uuid: deviceUuidSchema.safeParse(legacyUuid).success
      ? deviceUuidSchema.parse(legacyUuid)
      : deviceUuidSchema.parse(defaultUuid),
  };
  await setStorage(STORAGE_KEYS.IDENTITY, identity);
  return identity;
}

export function updateStoredDeviceName(name: string): Promise<StoredDeviceIdentity> {
  const parsedName = deviceNameSchema.parse(name);
  return mutateStorage(STORAGE_KEYS.IDENTITY, (current) => {
    if (current === null) throw new Error('Device identity has not been initialized');
    return { ...parseStoredIdentity(current), name: parsedName };
  });
}

function parseStoredIdentity(value: unknown): StoredDeviceIdentity {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Device identity must be an object');
  }
  const identity = value as Record<string, unknown>;
  return {
    name: deviceNameSchema.parse(identity.name),
    uuid: deviceUuidSchema.parse(identity.uuid),
  };
}

function migrateLegacyName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  let migrated = '';
  for (const character of value) {
    if (hasUnsafeDisplayControls(character)) continue;
    const next = migrated + character;
    if (next.length > 255 || utf8ByteLength(next) > 255) break;
    migrated = next;
  }
  const parsed = deviceNameSchema.safeParse(migrated);
  return parsed.success ? parsed.data : fallback;
}
