import { networkInterfaces } from 'os'

export interface Ipv4Network {
  address: string
  netmask: string
}

/** Prefer a non-internal IPv4 suitable for LAN Discovery. */
export function getIpAddress(): string {
  const networks = listLanIpv4Networks()
  let preferred: string | undefined

  for (const network of networks) {
    const upper = network.name.toUpperCase()
    if (upper.includes('WLAN') || upper.includes('WI-FI') || upper.includes('WIFI')) {
      preferred = network.address
    }
  }

  return preferred || networks[0]?.address || ''
}

export function listLanIpv4Networks(): Array<Ipv4Network & { name: string }> {
  const interfaces = networkInterfaces()
  const networks: Array<Ipv4Network & { name: string }> = []
  for (const [name, list] of Object.entries(interfaces)) {
    for (const details of list ?? []) {
      if (String(details.family) !== 'IPv4' || details.internal) continue
      networks.push({ name, address: details.address, netmask: details.netmask })
    }
  }
  return networks
}
