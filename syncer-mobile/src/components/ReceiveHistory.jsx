import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, ToastAndroid, TouchableOpacity, View } from 'react-native'
import { Button, CheckBox } from '@rneui/themed'
import styles from '../styles/ReceiveHistoryStyles'
import Icon from 'react-native-vector-icons/AntDesign'
import theme from '../styles/theme'
import RNFS from 'react-native-fs'
import moment from 'moment'
import FileViewer from 'react-native-file-viewer'
import { Modal, modalStyles } from './Modal'


const ReceiveHistory = () => {
  const [receiveHistory, setReceiveHistory] = useState([])
  useEffect(() => {
    getStorage(STORAGE_KEYS.RECEIVE_HISTORY).then((res) => {
      const temp = res?.map(item => ({ ...item, selected: false })) || []
      setReceiveHistory(temp)
    })
  }, [])
  const selectedList = receiveHistory.filter(item => item.selected)
  const allSelected = useMemo(
    () => receiveHistory.length && selectedList.length === receiveHistory.length,
    [selectedList.length, receiveHistory.length]
  )
  const [pageIndex, setPageIndex] = useState(1)
  const hasMore = useMemo(
    () => receiveHistory.length > pageIndex * 20,
    [receiveHistory.length, pageIndex]
  )
  const [selecting, setSelecting] = useState(false)

  function handleSelectItem(i) {
    const temp = receiveHistory.slice()
    temp[i].selected = !temp[i].selected
    setReceiveHistory(temp)
  }

  function selectAll() {
    const temp = receiveHistory.slice()
    temp.forEach((item) => { item.selected = !allSelected })
    setReceiveHistory(temp)
  }

  async function deleteSelectedItems() {
    const remainList = receiveHistory.filter(item => !item.selected)
    setReceiveHistory(remainList)
    await setStorage(STORAGE_KEYS.RECEIVE_HISTORY, remainList)
    setSelecting(false)
  }

  async function handlePressItem(name, i) {
    if (selecting) {
      handleSelectItem(i)
      return
    }
    const path = RNFS.DownloadDirectoryPath + '/Syncer/' + name
    if (!await RNFS.exists(path)) {
      ToastAndroid.show('文件不存在', ToastAndroid.SHORT)
      return
    }
    await FileViewer.open(path)
  }

  const listItems = receiveHistory.slice(0, pageIndex * 20).map((item, index) =>
    <TouchableOpacity key={ index } style={ styles.item } activeOpacity={ 0.5 }
                      onPress={ () => handlePressItem(item.name, index) }>
      {
        selecting && (
          <CheckBox
            checked={ item.selected }
            size={ 20 }
            onPress={ () => handleSelectItem(index) } />)
      }
      <View style={ styles.itemDetails }>
        <Text style={ styles.fileName } numberOfLines={ 1 } ellipsizeMode={ 'tail' }>{ item.name }</Text>
        <Text style={ styles.time }>{ moment(item.time).format('YYYY-MM-DD HH:mm') }</Text>
      </View>
      <Icon name="right" size={ 14 } color={ theme.tipTextColor } />
    </TouchableOpacity>)
  return (
    <>
      <View>
        <View style={ styles.operation }>
          {
            selecting ? (
              <CheckBox
                checked={ allSelected }
                size={ 20 }
                title="全选"
                textStyle={ styles.selectAll }
                onPress={ selectAll } />
            ) : <Text>共 { receiveHistory.length } 条记录</Text>
          }
          <View style={ styles.operationRight }>
            <Button onPress={ () => setSelecting(!selecting) } type="outline"
                    buttonStyle={ styles.button }
                    titleStyle={ styles.select }>{ selecting ? '取消' : '选择' }</Button>
            { selecting && (
              <Button onPress={ deleteSelectedItems }
                      disabled={ selectedList.length === 0 } color="error"
                      buttonStyle={ styles.button } titleStyle={ styles.delete }>删除</Button>) }
          </View>
        </View>
        <ScrollView contentContainerStyle={ styles.list } style={ styles.listWrap }>
          { listItems }
          { hasMore ? (
            <Button type="clear" containerStyle={ styles.showMore }
                    onPress={ () => setPageIndex(pageIndex + 1) }>显示更多</Button>
          ) : <Text style={ styles.noMore }>没有更多了</Text> }
        </ScrollView>
      </View>
    </>
  )
}
export default ReceiveHistory

export function showReceiveHistory() {
  Modal.show({
    title: '接收历史',
    content: <ReceiveHistory />,
    footer: (
      <View style={ modalStyles.button }>
        <Button onPress={ Modal.hide }>关闭</Button>
      </View>
    )
  })
}
