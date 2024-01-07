/**
 * @format
 */

import { AppRegistry } from 'react-native'
import App from './src/App'
import { name as appName } from './app.json'

import './src/service/udpService'
import PushNotification, { Importance } from 'react-native-push-notification'
import { PERMISSIONS, request } from 'react-native-permissions'

AppRegistry.registerComponent(appName, () => App)

PushNotification.configure({
  // 当打开本地通知时调用
  onNotification: (notification) => {
    console.log("NOTIFICATION:", notification)

  },

  // 当Registered Action被按下并且invokeApp为false时调用，如果为true onNotification将被调用(Android)
  onAction: (notification) => {
    console.log("ACTION:", notification.action)
    console.log("NOTIFICATION:", notification)
  },

  // 初始通知是否会自动弹出
  popInitialNotification: false,

  requestPermissions: false,
})

PushNotification.createChannel({
    channelId: "syncer", // (required)
    channelName: "Syncer", // (required)
    // channelDescription: "A channel to categorise your notifications", // (optional) default: undefined.
    playSound: false, // (optional) default: true
    // soundName: "default", // (optional) See `soundName` parameter of `localNotification` function
    // importance: Importance.HIGH, // (optional) default: Importance.HIGH. Int value of the Android notification importance
    // vibrate: true, // (optional) default: true. Creates the default vibration pattern if true.
})

request(PERMISSIONS.ANDROID.POST_NOTIFICATIONS).then()
