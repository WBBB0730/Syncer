import {
  prioritizeDeviceEndpoint,
  type AvailableDevice,
  type DeviceEndpoint,
  type DeviceIdentity
} from '@syncer/protocol'

export function createAvailableDeviceFromTcpIdentity(
  candidate: AvailableDevice,
  identity: DeviceIdentity,
  endpoint: DeviceEndpoint
): AvailableDevice {
  if (identity.uuid !== candidate.uuid) {
    throw new Error('TCP Device UUID does not match the Available Device candidate')
  }
  if (
    !candidate.endpoints.some(
      (candidateEndpoint) =>
        candidateEndpoint.address === endpoint.address && candidateEndpoint.port === endpoint.port
    )
  ) {
    throw new Error('TCP Device Endpoint does not belong to the Available Device candidate')
  }
  return {
    ...prioritizeDeviceEndpoint(candidate, endpoint),
    uuid: identity.uuid,
    name: identity.name,
    device: identity.device
  }
}
