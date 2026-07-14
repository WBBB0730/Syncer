import { AntDesign as Icon } from '@expo/vector-icons';
import { Button, CheckBox } from '@rneui/themed';
import moment from 'moment';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import SyncerStorage from '../../modules/syncer-storage';
import {
  readReceiveHistory,
  removeReceiveHistory,
  type ReceiveHistoryItem,
} from '../repositories/receiveHistory';
import styles from '../styles/ReceiveHistoryStyles';
import theme from '../styles/theme';
import { FeedbackDuration, showFeedback } from '../utils/feedback';
import { Modal, modalStyles } from './Modal';

type ReceiveHistoryStateItem = ReceiveHistoryItem & {
  selected: boolean;
};

const PAGE_SIZE = 20;

const ReceiveHistory = () => {
  const [receiveHistory, setReceiveHistory] = useState<ReceiveHistoryStateItem[]>([]);
  const [pageIndex, setPageIndex] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const path = SyncerStorage.downloadsPath;

  useEffect(() => {
    void readReceiveHistory()
      .then((history) => {
        setReceiveHistory(history.map((item) => ({ ...item, selected: false })));
      })
      .catch((error) => console.error('Failed to read Receive History', error));
  }, []);

  const selectedList = receiveHistory.filter((item) => item.selected);
  const allSelected = useMemo(
    () => receiveHistory.length && selectedList.length === receiveHistory.length,
    [selectedList.length, receiveHistory.length],
  );
  const hasMore = useMemo(
    () => receiveHistory.length > pageIndex * PAGE_SIZE,
    [receiveHistory.length, pageIndex],
  );

  function handleSelectItem(index: number) {
    const temp = receiveHistory.slice();
    temp[index].selected = !temp[index].selected;
    setReceiveHistory(temp);
  }

  function selectAll() {
    const temp = receiveHistory.slice();
    temp.forEach((item) => {
      item.selected = !allSelected;
    });
    setReceiveHistory(temp);
  }

  async function deleteSelectedItems() {
    try {
      const remaining = await removeReceiveHistory(selectedList);
      setReceiveHistory(remaining.map((item) => ({ ...item, selected: false })));
      setSelecting(false);
    } catch (error) {
      console.error('Failed to update Receive History', error);
      showFeedback('删除失败', FeedbackDuration.LONG);
    }
  }

  async function handlePressItem(item: ReceiveHistoryItem, index: number) {
    if (selecting) {
      handleSelectItem(index);
      return;
    }
    try {
      await SyncerStorage.openFileAsync(item.locator);
    } catch {
      showFeedback('文件不存在');
    }
  }

  const listItems = receiveHistory.slice(0, pageIndex * PAGE_SIZE).map((item, index) => (
    <TouchableOpacity
      key={index}
      style={styles.item}
      activeOpacity={0.5}
      onPress={() => handlePressItem(item, index)}
    >
      {selecting ? (
        <CheckBox checked={item.selected} size={20} onPress={() => handleSelectItem(index)} />
      ) : null}
      <View style={styles.itemDetails}>
        <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
          {item.name}
        </Text>
        <Text style={styles.time}>{moment(item.time).format('YYYY-MM-DD HH:mm')}</Text>
      </View>
      <Icon name="right" size={14} color={theme.tipTextColor} />
    </TouchableOpacity>
  ));

  return (
    <View>
      <View style={styles.operation}>
        {selecting ? (
          <CheckBox checked={!!allSelected} size={20} title="全选" textStyle={styles.selectAll} onPress={selectAll} />
        ) : (
          <Text>共 {receiveHistory.length} 条记录</Text>
        )}
        <View style={styles.operationRight}>
          <Button type="outline" buttonStyle={styles.button} titleStyle={styles.select} onPress={() => setSelecting(!selecting)}>
            {selecting ? '取消' : '选择'}
          </Button>
          {selecting ? (
            <Button
              color="error"
              disabled={selectedList.length === 0}
              buttonStyle={styles.button}
              titleStyle={styles.delete}
              onPress={deleteSelectedItems}
            >
              删除
            </Button>
          ) : null}
        </View>
      </View>
      <Text style={styles.path}>{path}</Text>
      <ScrollView contentContainerStyle={styles.list} style={styles.listWrap}>
        {listItems}
        {hasMore ? (
          <Button type="clear" containerStyle={styles.showMore} onPress={() => setPageIndex(pageIndex + 1)}>
            显示更多
          </Button>
        ) : (
          <Text style={styles.noMore}>没有更多了</Text>
        )}
      </ScrollView>
    </View>
  );
};

export default ReceiveHistory;

export function showReceiveHistory() {
  Modal.show({
    title: '接收历史',
    content: <ReceiveHistory />,
    footer: (
      <View style={modalStyles.button}>
        <Button onPress={() => Modal.hide()}>关闭</Button>
      </View>
    ),
  });
}
