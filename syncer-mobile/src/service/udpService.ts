import React from 'react';
import { Button } from '@rneui/themed';
import dgram from 'react-native-udp';
import { Text, View } from 'react-native';

import { Modal, modalStyles } from '../components/Modal';
import store, { Device } from '../store';
import { notify } from '../utils/notify';
import { getStorage, STORAGE_KEYS } from '../utils/storage';

const RneButton = Button as React.ComponentType<any>;

type UdpMessage = Partial<Device> & {
  type?: 'search' | 'available' | 'connect' | 'refuse';
};

type WhiteList = Record<string, boolean>;

const udpSocket = dgram.createSocket({ type: 'udp4' });

udpSocket.bind(5742);
udpSocket.on('listening', () => {
  udpSocket.setBroadcast(true);
});

/** 处理接收到的UDP数据 */
udpSocket.on('message', async (msg: { toString: () => string }, info: { port: number; address: string }) => {
  let data: UdpMessage;
  try {
    data = JSON.parse(msg.toString()) as UdpMessage;
    if (typeof data !== 'object' || !data.type || !data.uuid || data.uuid === store.uuid) return;
  } catch {
    return;
  }

  console.log(`UDP: receive from ${info.address}:${info.port}`, data);

  switch (data.type) {
    case 'search':
      return handleSearch(info.port, info.address);
    case 'available':
      return handleAvailable(data, info.port, info.address);
    case 'connect':
      return handleConnect(data, info.port, info.address);
    case 'refuse':
      return handleRefuse(data);
  }
});

/** 发送UDP数据 */
function sendUdpData(data: UdpMessage, port: number, address: string) {
  const { uuid, name } = store;
  if (!uuid) return;

  const payload = { ...data, uuid, name, device: 'mobile' };
  udpSocket.send(JSON.stringify(payload), undefined, undefined, port, address);
  console.log(`UDP: send to ${address}:${port}`, payload);
}

/** 处理type为search的UDP数据 */
function handleSearch(port: number, address: string) {
  if (store.status !== 'available') return;
  sendUdpData({ type: 'available' }, port, address);
}

/** 处理type为available的UDP数据 */
function handleAvailable({ uuid, name, device }: UdpMessage, port: number, address: string) {
  if (!uuid || !name || !device) return;
  store.addAvailableDevice({ uuid, name, device, port, address });
}

/** 处理type为connect的UDP数据 */
async function handleConnect({ uuid, name, device }: UdpMessage, port: number, address: string) {
  if (store.status !== 'available' || !uuid || !name || !device) return;

  const requestDevice: Device = { uuid, name, device, port, address };
  const whiteList = (await getStorage<WhiteList>(STORAGE_KEYS.WHITE_LIST)) || {};
  if (whiteList[uuid]) {
    await store.accept(requestDevice);
    notify('连接成功', name);
    return;
  }

  const refuse = () => {
    sendUdpData({ type: 'refuse' }, port, address);
    Modal.hide();
  };

  const accept = async () => {
    await store.accept(requestDevice);
    Modal.hide();
  };

  notify('连接请求', name);
  Modal.show({
    title: '连接请求',
    content: React.createElement(Text, null, `${name} 请求与你建立连接`),
    footer: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        View,
        { style: { flexGrow: 1 } },
        React.createElement(RneButton, { type: 'outline', onPress: refuse }, '拒绝'),
      ),
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(RneButton, { onPress: accept }, '接受'),
      ),
    ),
  });
}

/** 处理type为refuse的UDP数据 */
function handleRefuse({ uuid, name }: UdpMessage) {
  if (store.status !== 'connecting' || store.target?.uuid !== uuid) return;

  Modal.show({
    title: '连接失败',
    content: React.createElement(Text, null, `${name} 拒绝了你的连接请求`),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(RneButton, { onPress: Modal.hide }, '确定'),
    ),
  });
  store.cancel();
}

export { sendUdpData, udpSocket };
