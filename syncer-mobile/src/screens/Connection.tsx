import { AntDesign as Icon } from '@expo/vector-icons';
import { Button, Overlay } from '@rneui/themed';
import type { AvailableDevice } from '@syncer/protocol';
import { observer } from 'mobx-react';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { Modal, modalStyles } from '../components/Modal';
import { showReceiveHistory } from '../components/ReceiveHistory';
import { startNetworkStack } from '../service/bootstrap';
import store from '../store';
import styles from '../styles/ConnectionStyles';
import theme from '../styles/theme';
import { FeedbackDuration, showFeedback } from '../utils/feedback';
import { getIpv4Network, type Ipv4Network } from '../utils/ip';

export default function Connection() {
  return (
    <>
      <MyDeviceName />
      <Search />
      <AvailableDevices />
      <ConnectingModal />
    </>
  );
}

const MyDeviceName = observer(() => {
  const [editingName, setEditingName] = useState(false);
  const [inputName, setInputName] = useState('');

  function editName() {
    setEditingName(true);
    setInputName(store.name);
  }

  function cancelEditName() {
    setEditingName(false);
  }

  async function saveName() {
    if (!inputName) return;
    try {
      await store.setName(inputName);
      setEditingName(false);
    } catch (error) {
      console.error('Failed to update Device Name', error);
      showFeedback('设备名称不合法或保存失败', FeedbackDuration.LONG);
    }
  }

  return (
    <View style={styles.myDeviceName}>
      {editingName ? (
        <>
          <View>
            <TextInput
              value={inputName}
              maxLength={255}
              style={styles.inputName}
              placeholder="请输入设备名称"
              onChangeText={setInputName}
            />
          </View>
          <Button type="clear" icon={<Icon name="close" size={20} color={theme.brandColor} />} onPress={cancelEditName} />
          <Button type="clear" icon={<Icon name="check" size={20} color={theme.brandColor} />} onPress={() => void saveName()} />
        </>
      ) : (
        <>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.myDeviceNameText}>
            {store.name}
          </Text>
          <Button type="clear" icon={<Icon name="edit" size={20} color={theme.brandColor} />} onPress={editName} />
          <Button
            type="clear"
            icon={<Icon name="file-text" size={20} color={theme.secondaryTextColor} />}
            containerStyle={{ marginLeft: 'auto' }}
            onPress={showReceiveHistory}
          />
        </>
      )}
    </View>
  );
});

async function prepareDiscovery(): Promise<Ipv4Network | null> {
  await startNetworkStack();
  return getIpv4Network();
}

function reportDiscoveryFailure(error: unknown): void {
  console.error('Device Discovery failed', error);
  showFeedback('查找设备失败', FeedbackDuration.LONG);
}

const Search = () => {
  const [searching, setSearching] = useState(true);
  const [ipAddress, setIpAddress] = useState('');
  const [inputIpAddress, setInputIpAddress] = useState('');

  const runSearch = useCallback(async (ip?: string) => {
    try {
      const network = await prepareDiscovery();
      setIpAddress(network?.address ?? '');
      await store.discoverDevices(ip, network);
    } catch (error) {
      reportDiscoveryFailure(error);
    } finally {
      setSearching(false);
    }
  }, []);

  const search = useCallback(
    (manualIp?: string): Promise<void> => {
      setSearching(true);
      return runSearch(manualIp);
    },
    [runSearch],
  );

  useEffect(() => {
    let active = true;
    void prepareDiscovery()
      .then(async (network) => {
        if (active) setIpAddress(network?.address ?? '');
        await store.discoverDevices(undefined, network);
      })
      .catch(reportDiscoveryFailure)
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function manualSearch() {
    Modal.show({
      title: '手动查找',
      content: <InputIpAddress inputIpAddress={inputIpAddress} setInputIpAddress={setInputIpAddress} />,
      footer: (
        <>
          <Button type="outline" containerStyle={{ flexGrow: 1 }} onPress={() => Modal.hide()}>
            取消
          </Button>
          <Button
            containerStyle={{ flexGrow: 1 }}
            onPress={() => {
              Modal.hide();
              void search(inputIpAddress);
            }}
          >
            确定
          </Button>
        </>
      ),
    });
  }

  return (
    <>
      <Text style={styles.myIpAddress}>{ipAddress}</Text>
      <View style={styles.availableTitle}>
        <Text style={styles.availableTitleText}>可用设备</Text>
        <Button
          loading={searching}
          type="outline"
          buttonStyle={styles.searchButton}
          titleStyle={styles.searchButtonText}
          onPress={() => void search()}
        >
          查找
        </Button>
        <Button
          disabled={searching}
          type="outline"
          buttonStyle={styles.manualSearchButton}
          titleStyle={styles.searchButtonText}
          onPress={manualSearch}
        >
          手动查找
        </Button>
      </View>
    </>
  );
};

type InputIpAddressProps = {
  inputIpAddress: string;
  setInputIpAddress: (value: string) => void;
};

const InputIpAddress = ({ inputIpAddress = '', setInputIpAddress }: InputIpAddressProps) => {
  const [value, setValue] = useState(inputIpAddress);

  useEffect(() => {
    setInputIpAddress(value);
  }, [value, setInputIpAddress]);

  return (
    <TextInput
      value={value}
      placeholder="请输入目标设备的IP地址"
      style={styles.inputIpAddress}
      onChangeText={setValue}
    />
  );
};

const AvailableDevices = observer(() => {
  return (
    <ScrollView style={styles.availableDevices}>
      {Array.from(store.availableDeviceMap.values()).map((device: AvailableDevice) => (
        <View key={device.uuid} style={styles.availableDevice}>
          <Icon
            name={device.device === 'desktop' ? 'desktop' : device.device === 'mobile' ? 'mobile' : 'question'}
            size={32}
            color={theme.mainTextColor}
          />
          <View style={styles.availableDeviceInfo}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.availableDeviceName}>
              {device.name}
            </Text>
            <Text style={styles.availableDeviceAddress}>{device.address}</Text>
          </View>
          <Button
            buttonStyle={styles.connectButton}
            titleStyle={styles.connectButtonText}
            onPress={() => void store.requestSession(device)}
          >
            连接
          </Button>
        </View>
      ))}
      <Text style={styles.tip}>请确保设备已连接至同一个 Wi-Fi 网络</Text>
    </ScrollView>
  );
});

const ConnectingModal = observer(() => {
  return (
    <Overlay isVisible={store.status === 'connecting'} overlayStyle={modalStyles.modal}>
      <Text style={modalStyles.title}>正在连接</Text>
      <View style={modalStyles.content}>
        <Text>等待 {store.target ? store.target.name : ''} 接受连接请求</Text>
      </View>
      <View style={modalStyles.footer}>
        <View style={modalStyles.button}>
          <Button type="outline" onPress={() => void store.cancelConnectionRequest()}>
            取消
          </Button>
        </View>
      </View>
    </Overlay>
  );
});
