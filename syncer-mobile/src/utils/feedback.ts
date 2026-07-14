import { Alert, Platform, ToastAndroid } from 'react-native';

export const FeedbackDuration = {
  SHORT: ToastAndroid.SHORT,
  LONG: ToastAndroid.LONG,
} as const;

export function showFeedback(
  message: string,
  duration: number = FeedbackDuration.SHORT,
): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, duration);
    return;
  }
  Alert.alert('Syncer', message);
}
