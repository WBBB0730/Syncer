import {
  deviceUuidSchema,
  deviceWhitelistSchema,
  type DeviceWhitelist,
} from '@syncer/protocol';

import { getStorage, mutateStorage, STORAGE_KEYS } from '../utils/storage';

export async function readDeviceWhitelist(): Promise<DeviceWhitelist> {
  const value = await getStorage<unknown>(STORAGE_KEYS.WHITELIST);
  return deviceWhitelistSchema.parse(value ?? {});
}

export async function isDeviceWhitelisted(deviceUuid: string): Promise<boolean> {
  const uuid = deviceUuidSchema.parse(deviceUuid);
  const whitelist = await readDeviceWhitelist();
  return Object.hasOwn(whitelist, uuid) && whitelist[uuid] === true;
}

export function setDeviceWhitelisted(
  deviceUuid: string,
  enabled: boolean,
): Promise<DeviceWhitelist> {
  const uuid = deviceUuidSchema.parse(deviceUuid);
  return mutateStorage(STORAGE_KEYS.WHITELIST, (current) => {
    const whitelist = deviceWhitelistSchema.parse(current ?? {});
    const next: DeviceWhitelist = { ...whitelist };
    if (enabled) next[uuid] = true;
    else delete next[uuid];
    return deviceWhitelistSchema.parse(next);
  });
}
