import {
  ANNOUNCE_INTERVAL_MS,
  BROADCAST_ADDRESS,
  DISCOVERY_EVENT_DEDUP_MS,
  DISCOVERY_EVENT_RATE_PER_SECOND,
  DISCOVER_INTERVAL_MS,
  DISCOVER_ROUNDS,
  DISCOVERY_UI_FLUSH_MS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_AVAILABLE_DEVICES,
  MULTICAST_GROUP,
  PROTOCOL_VERSION,
  SUBNET_PROBE_CONCURRENCY,
  SUBNET_PROBE_MAX_HOSTS,
  SUBNET_PROBE_TIMEOUT_MS,
  TCP_PORT,
  UDP_PORT,
  RecentKeyLimiter,
  TokenBucket,
  encodeUdpMessage,
  isIpv4Address,
  isRelevantDiscoveryHello,
  mapPool,
  mergeAvailableDevice,
  parseUdpMessage,
  subnetBroadcastAddress,
  subnetHostsForNetworks,
  subnetsWithoutAddresses,
  type AvailableDevice,
  type UdpDiscover,
  type UdpHello,
} from '@syncer/protocol';
import dgram from 'react-native-udp';
import uuid from 'react-native-uuid';

import store from '../store';
import { getIpv4Network, type Ipv4Network } from '../utils/ip';
import { probePresence } from './presence';

type DiscoverySocket = ReturnType<typeof dgram.createSocket> & {
  on(event: 'error', listener: (error: Error) => void): DiscoverySocket;
  on(event: 'close', listener: () => void): DiscoverySocket;
  on(event: 'listening', listener: () => void): DiscoverySocket;
  on(
    event: 'message',
    listener: (
      message: { toString(): string },
      remote: { port: number; address: string },
    ) => void,
  ): DiscoverySocket;
};

let socket: DiscoverySocket | null = null;
let discoveryPromise: Promise<void> | null = null;
let discoveryListening = false;
let announceTimer: ReturnType<typeof setInterval> | null = null;
let presenceReady = false;
let candidateFlushTimer: ReturnType<typeof setTimeout> | null = null;
let discoveryFailureHandler: ((error: Error) => void) | null = null;

type DiscoverySearch = {
  queryId: string;
  controller: AbortController;
};

let activeSearch: DiscoverySearch | null = null;

const replyRate = new TokenBucket(
  DISCOVERY_EVENT_RATE_PER_SECOND,
  DISCOVERY_EVENT_RATE_PER_SECOND,
);
const candidateRate = new TokenBucket(
  DISCOVERY_EVENT_RATE_PER_SECOND,
  DISCOVERY_EVENT_RATE_PER_SECOND,
);
const recentReplies = new RecentKeyLimiter(
  DISCOVERY_EVENT_DEDUP_MS,
  MAX_AVAILABLE_DEVICES,
);
const recentCandidates = new RecentKeyLimiter(
  DISCOVERY_EVENT_DEDUP_MS,
  MAX_AVAILABLE_DEVICES,
);
const pendingCandidates = new Map<string, AvailableDevice>();

function toAvailableDevice(hello: UdpHello, address: string): AvailableDevice {
  return {
    uuid: hello.uuid,
    name: hello.name,
    device: hello.device,
    endpoints: [{ port: hello.tcpPort, address }],
  };
}

function remember(device: AvailableDevice, deduplicationKey = device.uuid): void {
  if (
    store.status !== 'available' ||
    device.uuid === store.uuid ||
    !recentCandidates.take(deduplicationKey) ||
    !candidateRate.take()
  ) {
    return;
  }
  const merged = mergeAvailableDevice(pendingCandidates.get(device.uuid), device);
  if (pendingCandidates.has(device.uuid)) pendingCandidates.delete(device.uuid);
  while (pendingCandidates.size >= MAX_AVAILABLE_DEVICES) {
    const oldest = pendingCandidates.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingCandidates.delete(oldest);
  }
  pendingCandidates.set(device.uuid, merged);
  if (!candidateFlushTimer) {
    candidateFlushTimer = setTimeout(flushCandidates, DISCOVERY_UI_FLUSH_MS);
  }
}

function flushCandidates(): void {
  if (candidateFlushTimer) clearTimeout(candidateFlushTimer);
  candidateFlushTimer = null;
  const devices = [...pendingCandidates.values()];
  pendingCandidates.clear();
  if (devices.length === 0) return;
  store.addAvailableDevices(devices);
}

function clearPendingCandidates(): void {
  if (candidateFlushTimer) clearTimeout(candidateFlushTimer);
  candidateFlushTimer = null;
  pendingCandidates.clear();
}

function identityPayload(
  ...identity: [announce: true] | [announce: false, queryId: string]
): string {
  const [announce] = identity;
  return encodeUdpMessage(
    announce
      ? {
          v: PROTOCOL_VERSION,
          type: 'hello',
          uuid: store.uuid,
          name: store.name,
          device: 'mobile',
          tcpPort: TCP_PORT,
          announce: true,
        }
      : {
          v: PROTOCOL_VERSION,
          type: 'hello',
          queryId: identity[1],
          uuid: store.uuid,
          name: store.name,
          device: 'mobile',
          tcpPort: TCP_PORT,
          announce: false,
        },
  );
}

function discoverPayload(queryId: string): string {
  const message: UdpDiscover = {
    v: PROTOCOL_VERSION,
    type: 'discover',
    queryId,
    uuid: store.uuid,
    name: store.name,
    device: 'mobile',
  };
  return encodeUdpMessage(message);
}

function send(payload: string, port: number, address: string): void {
  if (!socket || !discoveryListening || !store.uuid) return;
  socket.send(payload, undefined, undefined, port, address, (error) => {
    if (error) console.warn(`UDP send to ${address}:${port} failed`, error);
  });
}

function replyHello(deviceUuid: string, queryId: string, port: number, address: string): void {
  if (
    presenceReady &&
    store.status === 'available' &&
    recentReplies.take(`${queryId}:${deviceUuid}@${address}`) &&
    replyRate.take()
  ) {
    send(identityPayload(false, queryId), port, address);
  }
}

export function markPresenceReady(): void {
  presenceReady = true;
  if (discoveryListening) startAnnounceLoop();
}

export function bindDiscoveryFailureHandler(handler: (error: Error) => void): void {
  discoveryFailureHandler = handler;
}

export function markPresenceStopped(): void {
  presenceReady = false;
  cancelDeviceSearch();
  stopAnnounceLoop();
}

export function startDiscovery(): Promise<void> {
  if (discoveryPromise) return discoveryPromise;

  discoveryPromise = new Promise((resolve, reject) => {
    const nextSocket = dgram.createSocket({ type: 'udp4', reusePort: true }) as DiscoverySocket;
    let settled = false;
    socket = nextSocket;

    const fail = (error: Error, closeSocket = true): void => {
      if (socket !== nextSocket) return;
      socket = null;
      discoveryListening = false;
      discoveryPromise = null;
      stopAnnounceLoop();
      cancelDeviceSearch();
      let failure: Error = error;
      if (closeSocket) {
        try {
          nextSocket.close();
        } catch (cleanupError) {
          failure = new AggregateError(
            [error, cleanupError],
            'Discovery failed and its socket could not be closed',
          );
        }
      }
      if (!settled) {
        settled = true;
        reject(failure);
      } else {
        discoveryFailureHandler?.(failure);
      }
    };

    nextSocket.on('error', fail);
    nextSocket.on('close', () =>
      fail(new Error('Discovery socket closed unexpectedly'), false),
    );
    nextSocket.on('listening', () => {
      try {
        discoveryListening = true;
        nextSocket.setBroadcast(true);
        try {
          nextSocket.addMembership(MULTICAST_GROUP);
        } catch (error) {
          console.warn('UDP multicast join failed', error);
        }
        startAnnounceLoop();
        settled = true;
        resolve();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    nextSocket.on(
      'message',
      (message: { toString(): string }, remote: { port: number; address: string }) => {
        const data = parseUdpMessage(message.toString());
        if (!data || data.uuid === store.uuid) return;

        if (data.type === 'discover') {
          replyHello(data.uuid, data.queryId, remote.port, remote.address);
        } else if (isRelevantDiscoveryHello(data, activeSearch?.queryId)) {
          remember(
            toAvailableDevice(data, remote.address),
            data.announce
              ? `${data.uuid}@${remote.address}`
              : `${data.queryId}:${data.uuid}@${remote.address}`,
          );
        }
      },
    );

    try {
      nextSocket.bind(UDP_PORT);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return discoveryPromise;
}

function startAnnounceLoop(): void {
  stopAnnounceLoop();
  const announce = (): void => {
    store.pruneAvailableDevices();
    if (!presenceReady || store.status !== 'available' || !socket || !store.uuid) return;
    const payload = identityPayload(true);
    send(payload, UDP_PORT, MULTICAST_GROUP);
    send(payload, UDP_PORT, BROADCAST_ADDRESS);
  };
  announce();
  announceTimer = setInterval(announce, ANNOUNCE_INTERVAL_MS);
}

function stopAnnounceLoop(): void {
  if (!announceTimer) return;
  clearInterval(announceTimer);
  announceTimer = null;
}

export function refreshPresenceAnnounce(): void {
  if (store.status === 'available') startAnnounceLoop();
  else {
    cancelDeviceSearch();
    stopAnnounceLoop();
    clearPendingCandidates();
  }
}

export function cancelDeviceSearch(): void {
  activeSearch?.controller.abort();
  activeSearch = null;
  clearPendingCandidates();
}

export async function stopDiscovery(): Promise<void> {
  markPresenceStopped();
  const startup = discoveryPromise;
  if (startup) {
    try {
      await startup;
    } catch {
      return;
    }
  }

  const current = socket;
  socket = null;
  discoveryPromise = null;
  discoveryListening = false;
  if (!current) return;

  await new Promise<void>((resolve, reject) => {
    try {
      current.close(resolve);
    } catch (error) {
      reject(error);
    }
  });
}

export async function discoverDevices(
  manualIp?: string,
  knownNetwork?: Ipv4Network | null,
): Promise<void> {
  await store.whenReady();
  if (store.status !== 'available') throw new Error('Discovery requires available status');
  if (manualIp !== undefined && !isIpv4Address(manualIp)) {
    throw new TypeError('IP address must be a valid IPv4 address');
  }
  cancelDeviceSearch();
  const search: DiscoverySearch = {
    queryId: String(uuid.v4()),
    controller: new AbortController(),
  };
  activeSearch = search;
  const { controller } = search;
  clearPendingCandidates();
  store.clearAvailableDevices();

  try {
    if (manualIp) {
      const identity = await probePresence(manualIp, HANDSHAKE_TIMEOUT_MS, {
        signal: controller.signal,
      });
      if (isActiveSearch(controller) && identity && identity.uuid !== store.uuid) {
        store.addAvailableDevices([
          { ...identity, endpoints: [{ port: TCP_PORT, address: manualIp }] },
        ]);
      }
      return;
    }

    await startDiscovery();
    if (!isActiveSearch(controller)) return;
    const network = knownNetwork === undefined ? await getIpv4Network() : knownNetwork;
    if (!isActiveSearch(controller)) return;
    const broadcast = network
      ? subnetBroadcastAddress(network.address, network.netmask)
      : null;
    const payload = discoverPayload(search.queryId);
    for (let round = 0; round < DISCOVER_ROUNDS; round += 1) {
      if (!isActiveSearch(controller)) return;
      send(payload, UDP_PORT, MULTICAST_GROUP);
      send(payload, UDP_PORT, BROADCAST_ADDRESS);
      if (broadcast && broadcast !== BROADCAST_ADDRESS) send(payload, UDP_PORT, broadcast);
      if (!(await waitForSearchInterval(controller.signal))) return;
    }

    if (!isActiveSearch(controller)) return;
    flushCandidates();
    const discoveredAddresses = [...store.availableDeviceMap.values()].flatMap((device) =>
      device.endpoints.map(({ address }) => address),
    );
    const probeNetworks = subnetsWithoutAddresses(network ? [network] : [], discoveredAddresses);
    const hosts = subnetHostsForNetworks(probeNetworks, SUBNET_PROBE_MAX_HOSTS);
    if (hosts.length === 0) return;

    await mapPool(
      hosts,
      SUBNET_PROBE_CONCURRENCY,
      async (host) => {
        if (!isActiveSearch(controller)) return null;
        const identity = await probePresence(host, SUBNET_PROBE_TIMEOUT_MS, {
          signal: controller.signal,
        });
        if (!isActiveSearch(controller) || !identity || identity.uuid === store.uuid) return null;
        remember(
          { ...identity, endpoints: [{ port: TCP_PORT, address: host }] },
          `${search.queryId}:${identity.uuid}@${host}`,
        );
        return identity.uuid;
      },
      { signal: controller.signal },
    );
    if (isActiveSearch(controller)) flushCandidates();
  } catch (error) {
    if (activeSearch === search) cancelDeviceSearch();
    throw error;
  } finally {
    if (activeSearch === search) activeSearch = null;
  }
}

function isActiveSearch(controller: AbortController): boolean {
  return (
    activeSearch?.controller === controller &&
    !controller.signal.aborted &&
    store.status === 'available'
  );
}

function waitForSearchInterval(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = (): void => finish(false);
    const timer = setTimeout(() => finish(true), DISCOVER_INTERVAL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
