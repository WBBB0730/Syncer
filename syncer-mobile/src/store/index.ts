import { makeAutoObservable } from 'mobx';
import uuid from 'react-native-uuid';

import { closeTcpServer, closeTcpSocket, connectTcpServer, openTcpServer, sendTcpData } from '../service/tcpService';
import { sendUdpData } from '../service/udpService';
import { randomNumber } from '../utils/random';
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage';

export type DeviceType = 'desktop' | 'mobile' | string;
export type ConnectionStatus = 'available' | 'connecting' | 'connected';

export type Device = {
  uuid: string;
  name: string;
  device: DeviceType;
  port: number;
  address: string;
};

class Store {
  uuid = '';
  status: ConnectionStatus = 'available';
  name = '';
  availableDeviceMap = new Map<string, Device>();
  target: Device | null = null;

  constructor() {
    makeAutoObservable(this);
    initValue(STORAGE_KEYS.NAME, `MOBILE_${randomNumber(5)}`).then((name) => this.setName(name));
    initValue(STORAGE_KEYS.UUID, String(uuid.v4())).then((id) => this.setUuid(id));
  }

  setUuid(id: string) {
    this.uuid = id;
    setStorage(STORAGE_KEYS.UUID, id).then();
  }

  setStatus(status: ConnectionStatus) {
    this.status = status;
  }

  setName(name: string) {
    this.name = name;
    setStorage(STORAGE_KEYS.NAME, name).then();
  }

  clearAvailableDeviceMap() {
    this.availableDeviceMap.clear();
  }

  addAvailableDevice(device: Device) {
    this.availableDeviceMap.set(device.uuid, device);
  }

  setTarget(device: Device | null) {
    this.target = device;
  }

  /** 发起连接请求 */
  async connect(device: Device) {
    await openTcpServer();
    this.setTarget(device);
    this.setStatus('connecting');
    sendUdpData({ type: 'connect' }, device.port, device.address);
  }

  /** 取消连接请求 */
  async cancel() {
    await closeTcpServer();
    this.setStatus('available');
    this.setTarget(null);
  }

  /** 接收连接请求 */
  async accept(device: Device) {
    await connectTcpServer(device);
    await sendTcpData({
      type: 'accept',
      uuid: this.uuid,
    });
    store.setTarget(device);
    store.setStatus('connected');
  }

  disconnect() {
    closeTcpSocket();
    store.setTarget(null);
    store.setStatus('available');
  }
}

async function initValue(key: string, newValue: string) {
  return (await getStorage<string>(key)) || newValue;
}

const store = new Store();
export default store;
