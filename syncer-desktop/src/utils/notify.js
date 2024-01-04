import { ipcRenderer } from 'electron'

/** 向系统发送通知 */
export function notify(title, content) {
  if (document.visibilityState === 'visible')
    return
  const notification = new Notification(title, {
    icon: require('/build/icon.png'),
    body: content,
    tag: 'default',
    requireInteraction: true,
    renotify: true,
  })
  notification.onclick = () => {
    ipcRenderer.send('show')
    notification.close()
  }
  const handler = () => {
    if (document.visibilityState !== 'visible')
      return
    notification.close()
    document.removeEventListener('visibilitychange', handler)
  }
  document.addEventListener('visibilitychange', handler)
}
