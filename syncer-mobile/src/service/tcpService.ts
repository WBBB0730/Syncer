import React from 'react';
import { Button } from '@rneui/themed';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import net from 'react-native-tcp-socket';
import { Platform, Text, ToastAndroid, Vibration, View } from 'react-native';
import RNFS from 'react-native-fs';
import { VolumeManager } from 'react-native-volume-manager';

import { Loading } from '../components/Loading';
import { Modal, modalStyles } from '../components/Modal';
import { ReceiveHistoryItem } from '../components/ReceiveHistory';
import store, { Device } from '../store';
import { notify } from '../utils/notify';
import sleep from '../utils/sleep';
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage';

const RneButton = Button as React.ComponentType<any>;

type TcpFile = {
  name: string;
  data: string;
};

type TcpMessage = {
  type: 'accept' | 'disconnect' | 'text' | 'file' | 'command' | 'ring';
  uuid?: string;
  content?: string | boolean | TcpFile[];
};

type SocketAddress = {
  port: number;
  address: string;
};

let tcpSocket: any = null;
const server = net.createServer((socket: any) => {
  if (store.status !== 'connecting') return;

  socket.once('data', (socketData: { toString: () => string }) => {
    const data = parseData(socketData);
    console.log('TCP: receive', data);
    if (!data || data.type !== 'accept') return;
    handleAccept(socket, data);
  });
});

function showToast(message: string, duration = ToastAndroid.SHORT) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, duration);
  }
}

function openTcpServer() {
  return new Promise<void>((resolve) => {
    server.listen({ port: 5742 }, () => {
      resolve();
    });
  });
}

function closeTcpServer() {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function connectTcpServer({ port, address }: Device) {
  return new Promise<void>((resolve) => {
    tcpSocket = new net.Socket();
    try {
      tcpSocket.connect({ port, host: address }, () => {
        initTcpSocket();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function closeTcpSocket() {
  if (tcpSocket === null) return;
  tcpSocket.destroy();
  tcpSocket = null;
}

function initTcpSocket() {
  tcpSocket.setKeepAlive(true);
  tcpSocket.on('data', async (socketData: { toString: () => string }) => {
    // 如果需要拼接，显示Loading
    if (queue) {
      Loading.show();
      await sleep(0);
    }

    const data = parseData(socketData);
    if (!data) return;

    Loading.hide();
    console.log(
      'TCP: receive',
      data.type === 'file' && Array.isArray(data.content)
        ? { type: 'file', content: data.content.map((file) => file.name) }
        : data,
    );

    switch (data.type) {
      case 'disconnect':
        return handleDisconnect();
      case 'text':
        return handleText(data);
      case 'file':
        return handleFile(data);
      case 'ring':
        return handleRing(data);
    }
  });
  tcpSocket.on('close', () => {
    handleDisconnect();
    showToast('连接中断');
  });
}

let queue = '';
function parseData(socketData: { toString: () => string }) {
  let data = queue + socketData.toString();
  if (data.endsWith('^')) {
    data = data.slice(0, -1);
    queue = '';
  } else {
    queue = data;
    return null;
  }

  try {
    const parsed = JSON.parse(data) as TcpMessage;
    if (!parsed || typeof parsed !== 'object' || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function sendTcpData(data: TcpMessage) {
  return new Promise<void>((resolve) => {
    if (tcpSocket === null) {
      resolve();
      return;
    }

    tcpSocket.write(JSON.stringify(data) + '^', 'utf8', resolve);
    console.log(
      'TCP: send',
      data.type === 'file' && Array.isArray(data.content)
        ? { type: 'file', content: data.content.map((file) => file.name) }
        : data,
    );
  });
}

function handleAccept(socket: any, data: TcpMessage) {
  const target = store.target;
  if (store.status !== 'connecting' || !target || data.uuid !== target.uuid) {
    socket.destroy();
    return;
  }

  const { port, address } = socket.address() as SocketAddress;
  console.log('TCP connected', socket.address());
  tcpSocket = socket;
  store.setTarget({ ...target, port, address });
  store.setStatus('connected');
  initTcpSocket();
  closeTcpServer().then();
}

function handleDisconnect() {
  store.disconnect();
}

function handleText({ content }: TcpMessage) {
  if (typeof content !== 'string') return;

  notify(store.name, '向你发送了一段文本');

  const copy = () => {
    Clipboard.setStringAsync(content).then(() => {
      showToast('已复制到剪贴板');
    });
  };

  Modal.show({
    title: '收到文本',
    content: React.createElement(Text, null, content),
    footer: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(RneButton, { type: 'outline', onPress: Modal.hide }, '忽略'),
      ),
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(RneButton, { onPress: copy }, '复制'),
      ),
    ),
  });
}

function handleFile({ content }: TcpMessage) {
  if (!Array.isArray(content)) return;

  notify(store.name, `向你发送了 ${content.length} 个文件`);

  const save = async () => {
    Modal.hide();
    const path = RNFS.DownloadDirectoryPath + '/Syncer/';
    const exists = await RNFS.exists(path);
    if (!exists) await RNFS.mkdir(path);
    const receiveHistory = (await getStorage<ReceiveHistoryItem[]>(STORAGE_KEYS.RECEIVE_HISTORY)) || [];

    for (const receivedFile of content) {
      const name = receivedFile.name.slice(0, receivedFile.name.lastIndexOf('.'));
      const type = receivedFile.name.slice(receivedFile.name.lastIndexOf('.'));
      let i = 1;
      while (await RNFS.exists(path + receivedFile.name)) {
        receivedFile.name = name + ` (${i++})` + type;
      }
      await RNFS.writeFile(path + receivedFile.name, receivedFile.data, 'base64');
      receiveHistory.unshift({ name: receivedFile.name, time: Date.now() });
    }

    ToastAndroid.show('已保存到' + path, ToastAndroid.LONG);
    await setStorage(STORAGE_KEYS.RECEIVE_HISTORY, receiveHistory);
  };

  Modal.show({
    title: '收到文件',
    content: React.createElement(
      React.Fragment,
      null,
      content.map((file, index) =>
        React.createElement(Text, { key: `${file.name}-${index}`, style: { marginBottom: 8 } }, file.name),
      ),
    ),
    footer: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(RneButton, { type: 'outline', onPress: Modal.hide }, '忽略'),
      ),
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(RneButton, { onPress: save }, '保存'),
      ),
    ),
  });
}

let sound: Audio.Sound | null = null;
let volume = 0.5;

async function startRing() {
  Vibration.vibrate([0, 1000, 1000], true);
  volume = (await VolumeManager.getVolume()).volume;
  await VolumeManager.setVolume(1);
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

  if (!sound) {
    const result = await Audio.Sound.createAsync(require('../assets/ring.mp3'), {
      isLooping: true,
      volume: 1,
      shouldPlay: true,
    });
    sound = result.sound;
  } else {
    await sound.setIsLoopingAsync(true);
    await sound.setVolumeAsync(1);
    await sound.replayAsync();
  }

  Modal.show({
    title: '查找设备',
    content: React.createElement(Text, null, '你的设备正在被查找，点击停止响铃'),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(RneButton, { onPress: stopRing }, '停止'),
    ),
  });
}

async function stopRing() {
  Vibration.cancel();
  if (sound) await sound.stopAsync();
  Modal.hide();
  await VolumeManager.setVolume(volume);
}

function handleRing({ content }: TcpMessage) {
  if (content) {
    startRing().then();
  } else {
    stopRing().then();
  }
}

export { closeTcpServer, closeTcpSocket, connectTcpServer, openTcpServer, sendTcpData };
export type { TcpFile, TcpMessage };
