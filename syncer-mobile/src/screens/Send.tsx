import { AntDesign as Icon } from '@expo/vector-icons';
import { Button, ButtonGroup, CheckBox, Input } from '@rneui/themed';
import type { CommandKey } from '@syncer/protocol';
import * as DocumentPicker from 'expo-document-picker';
import { observer } from 'mobx-react';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { showReceiveHistory } from '../components/ReceiveHistory';
import {
  isDeviceWhitelisted,
  setDeviceWhitelisted,
} from '../repositories/whitelist';
import type { SelectedFile } from '../service/session';
import store from '../store';
import styles from '../styles/SendStyles';
import theme from '../styles/theme';
import { FeedbackDuration, showFeedback } from '../utils/feedback';
import sleep from '../utils/sleep';

type SendType = 'text' | 'file' | 'command';

export default function Send() {
  const [type, setType] = useState<SendType>('text');

  return (
    <View>
      <Target />
      <Whitelist />
      <SelectType type={type} setType={setType} />
      <SendContent type={type} />
    </View>
  );
}

const Target = observer(() => {
  const target = store.target;

  const disconnect = () => {
    store.endSession();
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

const Whitelist = () => {
  const [isWhitelisted, setWhitelisted] = useState(false);

  useEffect(() => {
    const targetUuid = store.target?.uuid;
    if (!targetUuid) return;
    void isDeviceWhitelisted(targetUuid)
      .then(setWhitelisted)
      .catch((error) => {
        console.error('Failed to read Whitelist', error);
        showFeedback('读取自动接受设置失败', FeedbackDuration.LONG);
      });
  }, []);

  async function updateWhitelist(next: boolean) {
    const targetUuid = store.target?.uuid;
    if (!targetUuid) return;
    try {
      const whitelist = await setDeviceWhitelisted(targetUuid, next);
      setWhitelisted(Object.hasOwn(whitelist, targetUuid));
    } catch (error) {
      console.error('Failed to update Whitelist', error);
      showFeedback('保存自动接受设置失败', FeedbackDuration.LONG);
    }
  }

  return (
    <View style={styles.whitelist}>
      <CheckBox
        checked={isWhitelisted}
        size={20}
        title="自动接受此设备的连接请求"
        onPress={() => void updateWhitelist(!isWhitelisted)}
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
    try {
      await store.sendText(text);
      showFeedback('发送成功');
      setText('');
    } catch (error) {
      console.error('Failed to send text', error);
      showFeedback('发送失败', FeedbackDuration.LONG);
    }
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
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [sendingFile, setSendingFile] = useState(false);

  async function selectFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      setFiles((current) => [...current, ...result.assets]);
    } catch (error) {
      console.error('Failed to select files', error);
      showFeedback('选择文件失败', FeedbackDuration.LONG);
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  async function sendFile() {
    if (!files.length) return;
    setSendingFile(true);
    try {
      await sleep(0);
      await store.sendFiles(files);
      setFiles([]);
      showFeedback('发送成功');
    } catch (error) {
      console.error('Failed to send files', error);
      showFeedback('发送失败', FeedbackDuration.LONG);
    } finally {
      setSendingFile(false);
    }
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
                  removeFile(index);
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
  async function sendCommand(key: CommandKey) {
    try {
      await store.sendCommand(key);
    } catch (error) {
      console.error('Failed to send command', error);
      showFeedback('发送失败', FeedbackDuration.LONG);
    }
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
    try {
      await store.setFindDeviceActive(true);
    } catch (error) {
      console.error('Failed to start Find Device', error);
      showFeedback('查找设备失败', FeedbackDuration.LONG);
    }
  };

  return <Button onPress={sendRing}>查找设备</Button>;
};
