import PushNotification from 'react-native-push-notification'
import { AppState } from 'react-native'

export function notify(title, content) {
  if (AppState.currentState === 'active')
    return
  PushNotification.localNotification({
    channelId: 'syncer',
    title,
    message: content,
  })
}
