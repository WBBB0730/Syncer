import { TCP_PORT, type AvailableDevice, type DeviceIdentity } from '@syncer/protocol'

export function createAvailableDeviceFromTcpIdentity(
  candidate: AvailableDevice,
  identity: DeviceIdentity
): AvailableDevice {
  if (identity.uuid !== candidate.uuid) {
    throw new Error('TCP Device UUID does not match the Available Device candidate')
  }
  return {
    uuid: identity.uuid,
    name: identity.name,
    device: identity.device,
    address: candidate.address,
    port: candidate.port || TCP_PORT
  }
}
