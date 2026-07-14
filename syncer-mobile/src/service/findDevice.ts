export const FIND_DEVICE_NOTIFICATION_CATEGORY = 'find_device';
export const FIND_DEVICE_STOP_ACTION = 'stop_find_device';
export const FIND_DEVICE_NOTIFICATION_KIND = 'find-device-ring';

type FindDeviceNotificationResponse = Readonly<{
  actionIdentifier: string;
  notification: {
    request: {
      content: {
        data?: Record<string, unknown>;
      };
    };
  };
}>;

type VerifiedVolumeOptions = Readonly<{
  target: number;
  write: (volume: number) => Promise<void>;
  read: () => Promise<number>;
  maximumAttempts?: number;
  tolerance?: number;
  retryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}>;

export type FindDeviceFeedbackBackend = 'alarmkit' | 'legacy';

type PreferredFeedbackOptions = Readonly<{
  prepareAlarmKit: () => Promise<boolean>;
  startAlarmKit: () => Promise<boolean>;
  dismissAlarmKit: () => Promise<void>;
  startLegacy: () => Promise<void>;
}>;

export type PreferredFeedbackResult = Readonly<{
  backend: FindDeviceFeedbackBackend;
  alarmKitError?: unknown;
}>;

export function findDeviceNotificationIdentifier(ringToken: string): string {
  if (ringToken.length === 0) throw new Error('Find Device ring token must not be empty');
  return `syncer-find-device-${ringToken}`;
}

export function getFindDeviceStopToken(response: FindDeviceNotificationResponse): string | null {
  if (response.actionIdentifier !== FIND_DEVICE_STOP_ACTION) return null;
  const data = response.notification.request.content.data;
  if (!data) return null;
  if (data.kind !== FIND_DEVICE_NOTIFICATION_KIND) return null;
  return typeof data.ringToken === 'string' && data.ringToken.length > 0 ? data.ringToken : null;
}

export async function startPreferredFindDeviceFeedback({
  prepareAlarmKit,
  startAlarmKit,
  dismissAlarmKit,
  startLegacy,
}: PreferredFeedbackOptions): Promise<PreferredFeedbackResult> {
  if (await prepareAlarmKit()) {
    try {
      if (await startAlarmKit()) return { backend: 'alarmkit' };
    } catch (alarmKitError) {
      try {
        await dismissAlarmKit();
      } catch (cleanupError) {
        throw new AggregateError(
          [alarmKitError, cleanupError],
          'AlarmKit start failed and its state could not be cleared',
        );
      }
      await startLegacy();
      return { backend: 'legacy', alarmKitError };
    }
  }

  await startLegacy();
  return { backend: 'legacy' };
}

export async function setVerifiedVolume({
  target,
  write,
  read,
  maximumAttempts = 4,
  tolerance = 0.001,
  retryDelayMs = 80,
  wait = delay,
}: VerifiedVolumeOptions): Promise<void> {
  if (!Number.isFinite(target) || target < 0 || target > 1) {
    throw new Error('Target media volume must be between 0 and 1');
  }
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
    throw new Error('Volume verification attempts must be a positive integer');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Volume verification tolerance must be a non-negative finite number');
  }

  let lastError: unknown = new Error('Media volume was not updated');
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await write(target);
      const actual = await read();
      if (!Number.isFinite(actual) || actual < 0 || actual > 1) {
        throw new Error(`Invalid media volume reported after update: ${actual}`);
      }
      if (Math.abs(actual - target) <= tolerance) return;
      lastError = new Error(`Expected media volume ${target}, received ${actual}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maximumAttempts) await wait(retryDelayMs);
  }

  throw new AggregateError(
    [lastError],
    `Failed to set media volume after ${maximumAttempts} attempts`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
