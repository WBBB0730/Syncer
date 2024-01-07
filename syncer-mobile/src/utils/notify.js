import PushNotification from 'react-native-push-notification'

export function notify(title, content) {
  PushNotification.localNotification({
    channelId: 'syncer',
    title,
    message: content,
    ongoing: true
  })
}
