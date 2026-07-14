import { AntDesign as Icon, MaterialCommunityIcons as MediaIcon } from '@expo/vector-icons';
import { Button, ButtonGroup, Input } from '@rneui/themed';
import type { CommandKey } from '@syncer/protocol';
import * as DocumentPicker from 'expo-document-picker';
import { observer } from 'mobx-react';
import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

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
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Target />
      <Whitelist />
      <SelectType type={type} setType={setType} />
      <SendContent type={type} />
    </ScrollView>
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
        icon={<Icon name="history" size={20} color={theme.secondaryTextColor} />}
        containerStyle={{ marginLeft: 'auto' }}
        onPress={showReceiveHistory}
      />
    </View>
  );
});

const Whitelist = () => {
  const [isWhitelisted, setWhitelisted] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      const whitelist = await setDeviceWhitelisted(targetUuid, next);
      setWhitelisted(Object.hasOwn(whitelist, targetUuid));
    } catch (error) {
      console.error('Failed to update Whitelist', error);
      showFeedback('保存自动接受设置失败', FeedbackDuration.LONG);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.whitelist}>
      <Text style={styles.whitelistLabel}>自动接受此设备的连接请求</Text>
      <Switch
        accessibilityLabel="自动接受此设备的连接请求"
        value={isWhitelisted}
        disabled={saving}
        trackColor={{ false: theme.borderColor, true: theme.hoverColor }}
        thumbColor={theme.bgColorWhite}
        ios_backgroundColor={theme.borderColor}
        onValueChange={(next) => void updateWhitelist(next)}
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
        <ScrollView style={styles.fileList} nestedScrollEnabled>
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
    <View style={styles.commandButtonWrap}>
      {mediaCommandRows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.commandButtonRow}>
          {row.map((item) => (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              activeOpacity={0.7}
              style={styles.commandButton}
              onPress={() => void sendCommand(item.key)}
            >
              <MediaIcon name={item.icon} size={30} color={theme.brandColor} />
              <Text style={styles.commandButtonText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );
};

type MediaCommand = {
  key: CommandKey;
  icon: React.ComponentProps<typeof MediaIcon>['name'];
  label: string;
};

const mediaCommandRows: MediaCommand[][] = [
  [
    { key: 'audio_prev', icon: 'skip-previous', label: '上一曲' },
    { key: 'audio_play_pause', icon: 'play-pause', label: '播放/暂停' },
    { key: 'audio_next', icon: 'skip-next', label: '下一曲' },
  ],
  [
    { key: 'audio_mute', icon: 'volume-mute', label: '静音' },
    { key: 'audio_vol_down', icon: 'volume-minus', label: '音量减' },
    { key: 'audio_vol_up', icon: 'volume-plus', label: '音量加' },
  ],
];

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
