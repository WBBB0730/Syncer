import notifyIcon from '../assets/icon.png'
import { performAction } from './action'

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
    void performAction(() => window.api.showWindow(), '打开 Syncer 窗口失败').then(() => {
      notification.close()
    })
  }

  const handler = (): void => {
    if (document.visibilityState !== 'visible') return
    notification.close()
    document.removeEventListener('visibilitychange', handler)
  }
  document.addEventListener('visibilitychange', handler)
}
