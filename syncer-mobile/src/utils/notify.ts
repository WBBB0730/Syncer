import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export async function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('syncer', {
      name: 'Syncer',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      sound: null,
    });
    await Notifications.requestPermissionsAsync();
  }
}

export function notify(title: string, content: string) {
  if (AppState.currentState === 'active') return;

  Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: content,
      sound: false,
      ...(Platform.OS === 'android' ? { channelId: 'syncer' } : {}),
    },
    trigger: null,
  }).catch((error) => console.warn('Failed to schedule notification', error));
}
