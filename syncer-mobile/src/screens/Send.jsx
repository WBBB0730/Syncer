import { Image, ImageBackground, ScrollView, Text, ToastAndroid, Touchable, TouchableOpacity, View } from 'react-native'
import { useState } from 'react'
import { Button, ButtonGroup, Input } from '@rneui/themed'
import { sendTcpData } from '../service/tcpService'
import store from '../store'
import { observer } from 'mobx-react'
import styles from '../styles/SendStyles'
import DocumentPicker from 'react-native-document-picker'
import RNFS from 'react-native-fs'
import Icon from 'react-native-vector-icons/AntDesign'
import { randomFileName } from '../utils/file'
import sleep from '../utils/sleep'
import { Modal, modalStyles } from '../components/Modal'
import Sound from 'react-native-sound'
import {showReceiveHistory} from "../components/ReceiveHistory";
import theme from "../styles/theme";

export default () => {
  const [type, setType] = useState('text')

  return (
    <View>
      <Target />
      <SelectType type={ type } setType={ setType } />
      <SendContent type={ type } />
    </View>
  )
}

const Target = observer(() => {
  const target = store.target

  const disconnect = () => {
    sendTcpData({
      type: 'disconnect'
    })
    store.disconnect()
  }

  return (
    <View style={ styles.target }>
      <Text style={ styles.targetName }>{ target.name }</Text>
      <Button type="outline" onPress={ disconnect }>断开连接</Button>
      <Button type="clear" icon={ <Icon name="filetext1" size={ 20 } color={ theme.secondaryTextColor } /> }
              containerStyle={{marginLeft: 'auto'}} onPress={ showReceiveHistory } />
    </View>
  )
})


const typeList = ['text', 'file', 'command']
const SelectType = ({ type, setType }) => {
  return (
    <ButtonGroup
      selectedIndex={ typeList.indexOf(type) }
      buttons={ ['发送文本', '发送文件', '发送指令'] }
      containerStyle={ styles.selectType }
      onPress={ (index) => { setType(typeList[index]) } } />
  )
}

const SendContent = observer(({ type }) => {
  switch (type) {
    case 'text':
      return <SendText />
    case 'file':
      return <SendFile />
    case 'command':
      return store.target.device === 'desktop' ? <SendCommand /> : <SendRing />
  }
})

const SendText = () => {
  const [text, setText] = useState('')

  const sendText = async () => {
    if (!text)
      return
    await sendTcpData({
      type: 'text',
      content: text,
    })
    ToastAndroid.show('发送成功', ToastAndroid.SHORT)
    setText('')
  }

  return (
    <View>
      <Text style={ styles.sendTextTitle }>待发送文本：</Text>
      <Input value={ text } multiline placeholder="请输入要发送的文本"
             inputStyle={{ fontSize: 16 }} containerStyle={ styles.inputText }
             onChangeText={ setText } />
      <Button disabled={ !text } onPress={ sendText }>发送</Button>
    </View>
  )
}

const SendFile = () => {
  const [files, setFiles] = useState([])
  const [sendingFile, setSendingFile] = useState(false)

  async function selectFile() {
    const tempFiles = await DocumentPicker.pick({
      allowMultiSelection: true,
    })
    const newFiles = []
    for (const file of tempFiles) {
      const data = await RNFS.readFile(file.uri, 'base64')
      newFiles.push({ name: file.name, data })
    }
    setFiles([...files, ...newFiles])
  }

  function removeFile(file) {
    files.splice(files.indexOf(file), 1)
    setFiles([...files])
  }

  async function sendFile() {
    if (!files.length)
      return
    setSendingFile(true)
    await sleep(0)
    await sendTcpData({
      type: 'file',
      content: files,
    })
    setSendingFile(false)
    setFiles([])
    ToastAndroid.show('发送成功', ToastAndroid.SHORT)
  }

  return (
    <>
      <View style={ styles.sendFileTitle }>
        <Text style={ styles.sendFileTitleText }>待发送文件：</Text>
        <Button onPress={ selectFile }>添加文件</Button>
      </View>
      {
        files.length > 0 &&
        <ScrollView style={ styles.fileList }>
          { files.map((file, index) => (
            <View key={ index } style={ styles.fileListItem }>
              <Text style={ styles.fileListItemName }>{ file.name }</Text>
              <Icon style={ styles.fileListItemDelete } name="delete" size={ 16 }
                    onPress={ () => { removeFile(file) } } />
            </View>
          )) }
        </ScrollView>
      }
      <Button disabled={ !files.length } loading={ sendingFile } onPress={ sendFile }>发送</Button>
    </>
  )
}

const SendCommand = () => {
  async function sendCommand(key) {
    await sendTcpData({
      type: 'command',
      content: key
    })
  }

  return (
    <>
      <View style={ styles.commandButtonWrap }>
        <TouchableOpacity style={ [styles.commandButton, { right: 50, bottom: 50 }] }
                          onPress={ () => sendCommand('up') }>
          <Text style={ styles.commandButtonText }>↑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { right: 50, bottom: 0 }] }
                          onPress={ () => sendCommand('down') }>
          <Text style={ styles.commandButtonText }>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { right: 100, bottom: 0 }] }
                          onPress={ () => sendCommand('left') }>
          <Text style={ styles.commandButtonText }>←</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { right: 0, bottom: 0 }] }
                          onPress={ () => sendCommand('right') }>
          <Text style={ styles.commandButtonText }>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { left: 0, bottom: 0, width: 148 }] }
                          onPress={ () => sendCommand('space') }>
          <Text  style={ styles.commandButtonText }>SPACE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { left: 0, top: 0 }] }
                          onPress={ () => sendCommand('escape') }>
          <Text style={ styles.commandButtonText }>ESC</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { left: 50, top: 0 }] }
                          onPress={ () => sendCommand('f5') }>
          <Text style={ styles.commandButtonText }>F5</Text>
        </TouchableOpacity>

        <TouchableOpacity style={ [styles.commandButton, { right: 100, top: 0 }] }
               onPress={ () => sendCommand('audio_mute') }>
          <Image source={ require('../assets/vol_mute.png') } style={ [styles.commandButtonIcon] } />
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { right: 50, top: 0 }] }
               onPress={ () => sendCommand('audio_vol_down') }>
          <Image source={ require('../assets/vol_down.png') } style={ [styles.commandButtonIcon] } />
        </TouchableOpacity>
        <TouchableOpacity style={ [styles.commandButton, { right: 0, top: 0 }] }
               onPress={ () => sendCommand('audio_vol_up') }>
          <Image source={ require('../assets/vol_up.png') } style={ [styles.commandButtonIcon] } />
        </TouchableOpacity>
      </View>
    </>
  )
}

const SendRing = () => {
  const sendRing = async () => {
    await sendTcpData({
      type: 'ring',
      content: true,
    })
    Modal.show({
      title: '正在查找',
      content: (
        <Text>设备正在响铃...</Text>
      ),
      footer: (
        <View style={ modalStyles.button }>
          <Button onPress={ () => {
            sendTcpData({ type: 'ring', content: false })
            Modal.hide()
          } }>停止</Button>
        </View>
      )
    })
  }

  return (
    <Button onPress={ sendRing }>查找设备</Button>
  )
}
