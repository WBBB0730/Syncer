import notifyIcon from '../assets/icon.png'

/** 向系统发送通知（与 legacy 行为一致：前台不弹） */
export function notify(title: string, content: string): void {
  if (document.visibilityState === 'visible') return

  const options: NotificationOptions & { renotify?: boolean } = {
    icon: notifyIcon,
    body: content,
    tag: 'default',
    requireInteraction: true,
    renotify: true
  }
  const notification = new Notification(title, options)

  notification.onclick = () => {
    void window.api.showWindow()
    notification.close()
  }

  const handler = (): void => {
    if (document.visibilityState !== 'visible') return
    notification.close()
    document.removeEventListener('visibilitychange', handler)
  }
  document.addEventListener('visibilitychange', handler)
}
