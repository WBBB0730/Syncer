import { networkInterfaces } from 'os'

/** 获取本机 IPv4 地址（优先 WLAN） */
export function getIpAddress(): string {
  const interfaces = networkInterfaces()
  let preferred: string | undefined
  const addressList: string[] = []

  for (const name of Object.keys(interfaces)) {
    for (const details of interfaces[name] ?? []) {
      if (details.family === 'IPv4' && !details.internal) {
        if (name.toUpperCase().includes('WLAN')) preferred = details.address
        addressList.push(details.address)
      }
    }
  }

  return preferred || addressList.join(' / ')
}
