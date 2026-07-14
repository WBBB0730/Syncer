import NetInfo from '@react-native-community/netinfo';

export interface Ipv4Network {
  address: string;
  netmask: string;
}

async function getIpv4Network(): Promise<Ipv4Network | null> {
  const { type, details } = await NetInfo.fetch();
  if (type !== 'wifi' || !details.ipAddress || !details.subnet) return null;
  return { address: details.ipAddress, netmask: details.subnet };
}

async function getIpAddress(): Promise<string> {
  return (await getIpv4Network())?.address ?? '';
}

export { getIpAddress, getIpv4Network };
