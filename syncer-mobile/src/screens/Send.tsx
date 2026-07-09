import { AntDesign as Icon } from '@expo/vector-icons';
import { Button, ButtonGroup, CheckBox, Input } from '@rneui/themed';
import * as DocumentPicker from 'expo-document-picker';
import { observer } from 'mobx-react';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
import RNFS from 'react-native-fs';

import { Modal, modalStyles } from '../components/Modal';
import { showReceiveHistory } from '../components/ReceiveHistory';
import { sendTcpData, TcpFile } from '../service/tcpService';
import store from '../store';
import styles from '../styles/SendStyles';
import theme from '../styles/theme';
import sleep from '../utils/sleep';
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage';

type SendType = 'text' | 'file' | 'command';
type WhiteList = Record<string, boolean>;

export default function Send() {
  const [type, setType] = useState<SendType>('text');

  return (
    <View>
      <Target />
      <WhiteList />
      <SelectType type={type} setType={setType} />
      <SendContent type={type} />
    </View>
  );
}

const Target = observer(() => {
  const target = store.target;

  const disconnect = () => {
    sendTcpData({
      type: 'disconnect',
    });
    store.disconnect();
  };

  return (
    <View style={styles.target}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.targetName}>
        {target?.name}
      </Text>
      <Button type="outline" onPress={disconnect}>
        断开连接
      </Button>
      <Button
        type="clear"
        icon={<Icon name="file-text" size={20} color={theme.secondaryTextColor} />}
        containerStyle={{ marginLeft: 'auto' }}
        onPress={showReceiveHistory}
      />
    </View>
  );
});

const WhiteList = () => {
  const [isInWhiteList, setIsInWhiteList] = useState(false);

  useEffect(() => {
    getStorage<WhiteList>(STORAGE_KEYS.WHITE_LIST).then((whiteList) => {
      whiteList = whiteList || {};
      setIsInWhiteList(whiteList[store.target!.uuid] === true);
    });
  }, []);

  async function getIsInWhiteList() {
    const whiteList = (await getStorage<WhiteList>(STORAGE_KEYS.WHITE_LIST)) || {};
    setIsInWhiteList(whiteList[store.target!.uuid] === true);
  }

  async function setIsInWhiteList_(next: boolean) {
    const whiteList = (await getStorage<WhiteList>(STORAGE_KEYS.WHITE_LIST)) || {};
    if (next) {
      whiteList[store.target!.uuid] = true;
    } else {
      delete whiteList[store.target!.uuid];
    }
    await setStorage(STORAGE_KEYS.WHITE_LIST, whiteList);
    await getIsInWhiteList();
  }

  return (
    <View style={styles.whiteList}>
      <CheckBox
        checked={isInWhiteList}
        size={20}
        title="自动接受此设备的连接请求"
        onPress={() => setIsInWhiteList_(!isInWhiteList)}
      />
    </View>
  );
};

const typeList: SendType[] = ['text', 'file', 'command'];
const SelectType = ({ type, setType }: { type: SendType; setType: (type: SendType) => void }) => {
  return (
    <ButtonGroup
      selectedIndex={typeList.indexOf(type)}
      buttons={['发送文本', '发送文件', '发送指令']}
      containerStyle={styles.selectType}
      onPress={(index) => {
        setType(typeList[index]);
      }}
    />
  );
};

const SendContent = observer(({ type }: { type: SendType }) => {
  switch (type) {
    case 'text':
      return <SendText />;
    case 'file':
      return <SendFile />;
    case 'command':
      return store.target?.device === 'desktop' ? <SendCommand /> : <SendRing />;
  }
});

const SendText = () => {
  const [text, setText] = useState('');

  const sendText = async () => {
    if (!text) return;
    await sendTcpData({
      type: 'text',
      content: text,
    });
    ToastAndroid.show('发送成功', ToastAndroid.SHORT);
    setText('');
  };

  return (
    <View>
      <Text style={styles.sendTextTitle}>待发送文本：</Text>
      <Input
        value={text}
        multiline
        placeholder="请输入要发送的文本"
        containerStyle={styles.inputText}
        onChangeText={setText}
      />
      <Button disabled={!text} onPress={sendText}>
        发送
      </Button>
    </View>
  );
};

const SendFile = () => {
  const [files, setFiles] = useState<TcpFile[]>([]);
  const [sendingFile, setSendingFile] = useState(false);

  async function selectFile() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const newFiles: TcpFile[] = [];
    for (const asset of result.assets) {
      const data = await RNFS.readFile(asset.uri, 'base64');
      newFiles.push({ name: asset.name, data });
    }
    setFiles([...files, ...newFiles]);
  }

  function removeFile(file: TcpFile) {
    files.splice(files.indexOf(file), 1);
    setFiles([...files]);
  }

  async function sendFile() {
    if (!files.length) return;
    setSendingFile(true);
    await sleep(0);
    await sendTcpData({
      type: 'file',
      content: files,
    });
    setSendingFile(false);
    setFiles([]);
    ToastAndroid.show('发送成功', ToastAndroid.SHORT);
  }

  return (
    <>
      <View style={styles.sendFileTitle}>
        <Text style={styles.sendFileTitleText}>待发送文件：</Text>
        <Button onPress={selectFile}>添加文件</Button>
      </View>
      {files.length > 0 ? (
        <ScrollView style={styles.fileList}>
          {files.map((file, index) => (
            <View key={index} style={styles.fileListItem}>
              <Text style={styles.fileListItemName}>{file.name}</Text>
              <Icon
                style={styles.fileListItemDelete}
                name="delete"
                size={16}
                onPress={() => {
                  removeFile(file);
                }}
              />
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Button disabled={!files.length} loading={sendingFile} onPress={sendFile}>
        发送
      </Button>
    </>
  );
};

const SendCommand = () => {
  async function sendCommand(key: string) {
    await sendTcpData({
      type: 'command',
      content: key,
    });
  }

  return (
    <>
      <View style={styles.commandButtonWrap}>
        <TouchableOpacity style={[styles.commandButton, { right: 50, bottom: 50 }]} onPress={() => sendCommand('up')}>
          <Text style={styles.commandButtonText}>↑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { right: 50, bottom: 0 }]} onPress={() => sendCommand('down')}>
          <Text style={styles.commandButtonText}>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { right: 100, bottom: 0 }]} onPress={() => sendCommand('left')}>
          <Text style={styles.commandButtonText}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { right: 0, bottom: 0 }]} onPress={() => sendCommand('right')}>
          <Text style={styles.commandButtonText}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { left: 0, bottom: 0, width: 148 }]} onPress={() => sendCommand('space')}>
          <Text style={styles.commandButtonText}>SPACE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { left: 0, top: 0 }]} onPress={() => sendCommand('escape')}>
          <Text style={styles.commandButtonText}>ESC</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { left: 50, top: 0 }]} onPress={() => sendCommand('f5')}>
          <Text style={styles.commandButtonText}>F5</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.commandButton, { right: 100, top: 0 }]} onPress={() => sendCommand('audio_mute')}>
          <Image source={require('../assets/vol_mute.png')} style={styles.commandButtonIcon} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { right: 50, top: 0 }]} onPress={() => sendCommand('audio_vol_down')}>
          <Image source={require('../assets/vol_down.png')} style={styles.commandButtonIcon} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.commandButton, { right: 0, top: 0 }]} onPress={() => sendCommand('audio_vol_up')}>
          <Image source={require('../assets/vol_up.png')} style={styles.commandButtonIcon} />
        </TouchableOpacity>
      </View>
    </>
  );
};

const SendRing = () => {
  const sendRing = async () => {
    await sendTcpData({
      type: 'ring',
      content: true,
    });
    Modal.show({
      title: '正在查找',
      content: <Text>设备正在响铃...</Text>,
      footer: (
        <View style={modalStyles.button}>
          <Button
            onPress={() => {
              sendTcpData({ type: 'ring', content: false });
              Modal.hide();
            }}
          >
            停止
          </Button>
        </View>
      ),
    });
  };

  return <Button onPress={sendRing}>查找设备</Button>;
};
