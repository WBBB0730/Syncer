export interface Ipv4Subnet {
  readonly address: string
  readonly netmask: string
}

function assertHostLimit(maxHosts: number): void {
  if (!Number.isSafeInteger(maxHosts) || maxHosts < 0) {
    throw new Error('Subnet probe host limit must be a non-negative safe integer')
  }
}

/** Select at most `maxHosts` usable IPv4 subnet hosts, starting after the local address. */
export function subnetHosts(address: string, netmask: string, maxHosts: number): string[] {
  assertHostLimit(maxHosts)
  const addressValue = parseIpv4(address)
  const netmaskValue = parseIpv4(netmask)
  if (addressValue == null || netmaskValue == null || !isContiguousNetmask(netmaskValue)) return []

  const network = (addressValue & netmaskValue) >>> 0
  const broadcast = (network | ~netmaskValue) >>> 0
  if (addressValue <= network || addressValue >= broadcast) return []

  const usableHostCount = Math.max(0, broadcast - network - 2)
  const limit = Math.min(maxHosts, usableHostCount)
  const hosts: string[] = []
  let value = addressValue + 1
  while (hosts.length < limit) {
    if (value >= broadcast) value = network + 1
    if (value !== addressValue) hosts.push(formatIpv4(value))
    value += 1
  }
  return hosts
}

/** Select a unique, globally bounded probe set across all local IPv4 subnets. */
export function subnetHostsForNetworks(
  networks: readonly Ipv4Subnet[],
  maxHosts: number
): string[] {
  assertHostLimit(maxHosts)
  const candidates = networks.map(({ address, netmask }) => subnetHosts(address, netmask, maxHosts))
  const hosts = new Set<string>()
  for (let index = 0; hosts.size < maxHosts; index += 1) {
    let hasCandidate = false
    for (const networkHosts of candidates) {
      const host = networkHosts[index]
      if (!host) continue
      hasCandidate = true
      hosts.add(host)
      if (hosts.size === maxHosts) return [...hosts]
    }
    if (!hasCandidate) break
  }
  return [...hosts]
}

export function subnetBroadcastAddress(address: string, netmask: string): string | null {
  const addressValue = parseIpv4(address)
  const netmaskValue = parseIpv4(netmask)
  if (addressValue == null || netmaskValue == null || !isContiguousNetmask(netmaskValue)) {
    return null
  }

  const network = (addressValue & netmaskValue) >>> 0
  const broadcast = (network | ~netmaskValue) >>> 0
  return broadcast - network > 1 ? formatIpv4(broadcast) : null
}

export function isIpv4InSubnet(address: string, subnet: Ipv4Subnet): boolean {
  const addressValue = parseIpv4(address)
  const localAddressValue = parseIpv4(subnet.address)
  const netmaskValue = parseIpv4(subnet.netmask)
  if (
    addressValue == null ||
    localAddressValue == null ||
    netmaskValue == null ||
    !isContiguousNetmask(netmaskValue)
  ) {
    return false
  }
  return (addressValue & netmaskValue) === (localAddressValue & netmaskValue)
}

/** Return each valid local subnet that has no known remote address, de-duplicated by CIDR. */
export function subnetsWithoutAddresses(
  networks: readonly Ipv4Subnet[],
  addresses: readonly string[]
): Ipv4Subnet[] {
  const results: Ipv4Subnet[] = []
  const seen = new Set<string>()

  for (const network of networks) {
    const addressValue = parseIpv4(network.address)
    const netmaskValue = parseIpv4(network.netmask)
    if (addressValue == null || netmaskValue == null || !isContiguousNetmask(netmaskValue)) {
      continue
    }
    const key = `${(addressValue & netmaskValue) >>> 0}/${netmaskValue}`
    if (seen.has(key)) continue
    seen.add(key)
    if (addresses.some((address) => isIpv4InSubnet(address, network))) continue
    results.push(network)
  }
  return results
}

function parseIpv4(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255 || String(octet) !== part) return null
    result = (result * 256 + octet) >>> 0
  }
  return result
}

export function isIpv4Address(value: string): boolean {
  return parseIpv4(value) != null
}

function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')
}

function isContiguousNetmask(value: number): boolean {
  const inverted = ~value >>> 0
  return (inverted & (inverted + 1)) === 0
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>,
  options: { signal?: AbortSignal } = {}
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function run(): Promise<void> {
    while (!options.signal?.aborted && index < items.length) {
      const current = items[index++]
      const value = await worker(current)
      if (!options.signal?.aborted && value != null) results.push(value)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}
