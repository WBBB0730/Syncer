import { makeAutoObservable, runInAction } from 'mobx';
import uuid from 'react-native-uuid';
import {
  pruneAvailableDevices as pruneAvailableDeviceMaps,
  transitionSessionStatus,
  upsertAvailableDevices,
  type AvailableDevice,
  type CommandKey,
  type SessionLifecycleEvent,
  type SessionStatus,
} from '@syncer/protocol';

import { loadOrCreateIdentity, updateStoredDeviceName } from '../repositories/identity';
import { discoverDevices, refreshPresenceAnnounce } from '../service/discovery';
import type { Ipv4Network } from '../utils/ip';
import { dialAndConnect, rejectPendingConnectionForOutgoing } from '../service/presence';
import {
  disconnectSession,
  sendFiles,
  sendSessionMessage,
  setFindDeviceActive,
  type SelectedFile,
} from '../service/session';
import { randomNumber } from '../utils/random';

class Store {
  uuid = '';
  status: SessionStatus = 'available';
  name = '';
  availableDeviceMap = new Map<string, AvailableDevice>();
  target: AvailableDevice | null = null;
  receivingFileTransfer = false;

  private readonly readyPromise: Promise<void>;
  private connectionAbortController: AbortController | null = null;
  private readonly availableDeviceSeenAt = new Map<string, number>();

  constructor() {
    makeAutoObservable(this);
    this.readyPromise = this.initializeIdentity();
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  transitionSession(event: SessionLifecycleEvent): void {
    const next = transitionSessionStatus(this.status, event);
    if (next === this.status) return;
    this.status = next;
    if (next === 'connected') this.clearAvailableDevices();
    refreshPresenceAnnounce();
  }

  async setName(name: string): Promise<void> {
    const identity = await updateStoredDeviceName(name);
    runInAction(() => {
      this.name = identity.name;
    });
  }

  clearAvailableDevices(): void {
    this.availableDeviceMap.clear();
    this.availableDeviceSeenAt.clear();
  }

  addAvailableDevice(device: AvailableDevice, seenAt = Date.now()): void {
    this.addAvailableDevices([device], seenAt);
  }

  addAvailableDevices(devices: readonly AvailableDevice[], seenAt = Date.now()): void {
    if (this.status !== 'available') return;
    this.pruneAvailableDevices(seenAt);
    upsertAvailableDevices(
      this.availableDeviceMap,
      this.availableDeviceSeenAt,
      devices,
      seenAt,
    );
  }

  pruneAvailableDevices(now = Date.now()): void {
    pruneAvailableDeviceMaps(this.availableDeviceMap, this.availableDeviceSeenAt, now);
  }

  setTarget(device: AvailableDevice | null): void {
    this.target = device;
  }

  setReceivingFileTransfer(active: boolean): void {
    this.receivingFileTransfer = active;
  }

  async discoverDevices(manualIp?: string, network?: Ipv4Network | null): Promise<void> {
    await discoverDevices(manualIp, network);
  }

  async requestSession(device: AvailableDevice): Promise<void> {
    if (this.status !== 'available') return;

    if (!rejectPendingConnectionForOutgoing()) return;
    this.connectionAbortController?.abort();
    const controller = new AbortController();
    this.connectionAbortController = controller;
    this.setTarget(device);
    this.transitionSession('start-connection');

    let result: Awaited<ReturnType<typeof dialAndConnect>> = 'error';
    try {
      result = await dialAndConnect(device, { signal: controller.signal });
    } catch (error) {
      console.error('Connection Request failed', error);
    }
    if (this.connectionAbortController !== controller) return;
    this.connectionAbortController = null;

    if (result !== 'accepted') {
      this.setTarget(null);
      this.transitionSession('settle-available');
    }
  }

  async cancelConnectionRequest(): Promise<void> {
    if (this.status !== 'connecting') return;
    this.connectionAbortController?.abort();
    this.connectionAbortController = null;
    await disconnectSession(false);
  }

  endSession(): void {
    void disconnectSession(true).catch((error) => console.warn('Failed to end Session cleanly', error));
  }

  async sendText(content: string): Promise<void> {
    await sendSessionMessage({ type: 'text', content });
  }

  async sendFiles(files: readonly SelectedFile[]): Promise<void> {
    await sendFiles(files);
  }

  async sendCommand(content: CommandKey): Promise<void> {
    await sendSessionMessage({ type: 'command', content });
  }

  async setFindDeviceActive(content: boolean): Promise<void> {
    await setFindDeviceActive(content);
  }

  private async initializeIdentity(): Promise<void> {
    const identity = await loadOrCreateIdentity(
      `MOBILE_${randomNumber(5)}`,
      String(uuid.v4()),
    );
    runInAction(() => {
      this.name = identity.name;
      this.uuid = identity.uuid;
    });
  }
}

const store = new Store();
export default store;
