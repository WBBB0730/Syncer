import { AppState, Platform } from 'react-native';

import SyncerAlarmKit from '../../modules/syncer-alarmkit';

type FindDeviceAlarmStopHandler = (requestId: string) => Promise<void>;

let cleanupPromise: Promise<void> | null = null;
let authorizationPromise: Promise<boolean> | null = null;
let stopHandler: FindDeviceAlarmStopHandler | null = null;
let stopListenerInstalled = false;

function isAvailable(): boolean {
  return Platform.OS === 'ios' && SyncerAlarmKit?.isSupported === true;
}

export function registerFindDeviceAlarmStopHandler(
  handler: FindDeviceAlarmStopHandler,
): void {
  stopHandler = handler;
  if (!isAvailable() || stopListenerInstalled || !SyncerAlarmKit) return;
  stopListenerInstalled = true;

  SyncerAlarmKit.addListener('onAlarmStopped', ({ requestId }) => {
    void handleStoppedRequest(requestId);
  });
  void SyncerAlarmKit.consumeStoppedRequestIdsAsync()
    .then((requestIds) => Promise.all(requestIds.map(handleStoppedRequest)))
    .catch((error) => console.warn('Failed to consume AlarmKit stop actions', error));
}

export async function prepareFindDeviceAlarmKit(): Promise<boolean> {
  if (!isAvailable() || !SyncerAlarmKit) return false;
  await clearOrphanedAlarmsOnce();
  return ensureAuthorization();
}

export async function startFindDeviceAlarmKit(requestId: string): Promise<boolean> {
  if (!isAvailable() || !SyncerAlarmKit) return false;
  return SyncerAlarmKit.startAsync(requestId);
}

export async function prepareFindDeviceAlarmKitForStart(): Promise<boolean> {
  if (!isAvailable() || !SyncerAlarmKit) return false;
  await clearOrphanedAlarmsOnce();
  try {
    return await ensureAuthorization();
  } catch (error) {
    console.warn('AlarmKit authorization failed; using legacy Find Device feedback', error);
    return false;
  }
}

export async function dismissFindDeviceAlarmKit(requestId: string): Promise<void> {
  if (!SyncerAlarmKit) return;
  await SyncerAlarmKit.dismissAsync(requestId);
}

async function clearOrphanedAlarmsOnce(): Promise<void> {
  if (!SyncerAlarmKit) return;
  if (!cleanupPromise) {
    cleanupPromise = SyncerAlarmKit.clearOrphanedAlarmsAsync().catch((error) => {
      cleanupPromise = null;
      throw error;
    });
  }
  await cleanupPromise;
}

async function ensureAuthorization(): Promise<boolean> {
  if (!SyncerAlarmKit) return false;
  const state = await SyncerAlarmKit.getAuthorizationStateAsync();
  if (state === 'authorized') return true;
  if (state === 'denied' || AppState.currentState !== 'active') return false;

  if (!authorizationPromise) {
    authorizationPromise = SyncerAlarmKit.requestAuthorizationAsync().finally(() => {
      authorizationPromise = null;
    });
  }
  return authorizationPromise;
}

async function handleStoppedRequest(requestId: string): Promise<void> {
  if (!stopHandler) return;
  try {
    await stopHandler(requestId);
  } catch (error) {
    console.error('Failed to stop Find Device after AlarmKit action', error);
  }
}
