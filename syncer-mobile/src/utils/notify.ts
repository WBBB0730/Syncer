import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import {
  FIND_DEVICE_NOTIFICATION_CATEGORY,
  FIND_DEVICE_NOTIFICATION_KIND,
  FIND_DEVICE_STOP_ACTION,
  findDeviceNotificationIdentifier,
  getFindDeviceStopToken,
} from '../service/findDevice';

const NOTIFICATION_CHANNEL = 'syncer';
const MAX_HANDLED_RESPONSES = 32;
const BACKGROUND_NOTIFICATION_TASK = 'syncer-find-device-notification-action';

type FindDeviceStopHandler = (ringToken: string) => Promise<void>;

let infrastructurePromise: Promise<void> | null = null;
let permissionPromise: Promise<boolean> | null = null;
let findDeviceStopHandler: FindDeviceStopHandler | null = null;
let responseListenerInstalled = false;
const handledResponseKeys = new Set<string>();
let backgroundTaskRegistrationError: unknown = null;

if (Platform.OS === 'android' && !TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_NOTIFICATION_TASK,
    async ({ data, error }) => {
      if (error) {
        console.error('Find Device notification task failed', error);
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
      if (!('actionIdentifier' in data)) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }
      try {
        await handleNotificationResponse(data);
        return Notifications.BackgroundNotificationTaskResult.NoData;
      } catch (taskError) {
        console.error('Failed to stop Find Device from background notification', taskError);
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

const backgroundTaskRegistration =
  Platform.OS === 'android'
    ? Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK)
        .then(() => undefined)
        .catch((error) => {
          backgroundTaskRegistrationError = error;
          console.warn('Failed to register background notification task', error);
        })
    : Promise.resolve();

export async function configureNotifications(): Promise<void> {
  await backgroundTaskRegistration;
  if (backgroundTaskRegistrationError) throw backgroundTaskRegistrationError;
  await ensureNotificationInfrastructure();
  if (!permissionPromise) {
    permissionPromise = Notifications.requestPermissionsAsync()
      .then((permission) => permission.granted)
      .catch((error) => {
        permissionPromise = null;
        throw error;
      });
  }
  if (!(await permissionPromise)) throw new Error('Notification permission was not granted');
}

export function registerFindDeviceNotificationStopHandler(handler: FindDeviceStopHandler): void {
  findDeviceStopHandler = handler;
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;

  Notifications.addNotificationResponseReceivedListener((response) => {
    void handleNotificationResponse(response).catch((error) =>
      console.error('Failed to stop Find Device from notification', error),
    );
  });

  try {
    const response = Notifications.getLastNotificationResponse();
    if (response) {
      void handleNotificationResponse(response).catch((error) =>
        console.error('Failed to stop Find Device from initial notification response', error),
      );
    }
  } catch (error) {
    console.warn('Failed to read initial notification response', error);
  }
}

export async function showFindDeviceNotification(ringToken: string): Promise<string> {
  await configureNotifications();
  const identifier = findDeviceNotificationIdentifier(ringToken);
  return Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: '查找设备',
      body: '你的设备正在响铃',
      data: {
        kind: FIND_DEVICE_NOTIFICATION_KIND,
        ringToken,
      },
      sound: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      ...(Platform.OS === 'android'
        ? {
            categoryIdentifier: FIND_DEVICE_NOTIFICATION_CATEGORY,
            autoDismiss: false,
            sticky: true,
          }
        : {}),
    },
    trigger: immediateNotificationTrigger(),
  });
}

export function dismissFindDeviceNotification(identifier: string): Promise<void> {
  return Notifications.dismissNotificationAsync(identifier);
}

export function notify(title: string, content: string): void {
  if (AppState.currentState === 'active') return;
  void scheduleNotification(title, content).catch((error) =>
    console.warn('Failed to schedule notification', error),
  );
}

async function scheduleNotification(title: string, content: string): Promise<void> {
  await ensureNotificationInfrastructure();
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: content,
      sound: false,
    },
    trigger: immediateNotificationTrigger(),
  });
}

function ensureNotificationInfrastructure(): Promise<void> {
  if (!infrastructurePromise) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    infrastructurePromise = setupNotificationInfrastructure().catch((error) => {
      infrastructurePromise = null;
      throw error;
    });
  }
  return infrastructurePromise;
}

async function setupNotificationInfrastructure(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
      name: 'Syncer',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      sound: null,
    });
    await Notifications.setNotificationCategoryAsync(FIND_DEVICE_NOTIFICATION_CATEGORY, [
      {
        identifier: FIND_DEVICE_STOP_ACTION,
        buttonTitle: '停止响铃',
        options: {
          opensAppToForeground: false,
        },
      },
    ]);
  }
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const ringToken = getFindDeviceStopToken(response);
  if (!ringToken) return;
  if (!findDeviceStopHandler) throw new Error('Find Device stop handler is not ready');

  const notificationIdentifier = response.notification.request.identifier;
  const responseKey = `${notificationIdentifier}:${response.actionIdentifier}`;
  if (handledResponseKeys.has(responseKey)) return;
  rememberHandledResponse(responseKey);

  try {
    await findDeviceStopHandler(ringToken);
  } catch (error) {
    handledResponseKeys.delete(responseKey);
    throw error;
  }

  try {
    await Notifications.dismissNotificationAsync(notificationIdentifier);
  } catch (error) {
    console.warn('Failed to dismiss handled Find Device notification', error);
  }
  clearMatchingLastResponse(responseKey);
}

function clearMatchingLastResponse(responseKey: string): void {
  try {
    const lastResponse = Notifications.getLastNotificationResponse();
    if (!lastResponse) return;
    const lastResponseKey = `${lastResponse.notification.request.identifier}:${lastResponse.actionIdentifier}`;
    if (lastResponseKey === responseKey) Notifications.clearLastNotificationResponse();
  } catch (error) {
    console.warn('Failed to clear handled Find Device notification response', error);
  }
}

function rememberHandledResponse(responseKey: string): void {
  handledResponseKeys.add(responseKey);
  if (handledResponseKeys.size <= MAX_HANDLED_RESPONSES) return;
  const oldestResponseKey = handledResponseKeys.values().next().value;
  if (oldestResponseKey !== undefined) handledResponseKeys.delete(oldestResponseKey);
}

function immediateNotificationTrigger(): null | { channelId: string } {
  return Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL } : null;
}
