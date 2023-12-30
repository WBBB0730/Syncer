import { ScrollView, Text, ToastAndroid, View } from 'react-native'
import { useState } from 'react'
import { Button, ButtonGroup, Input } from '@rneui/base'
import { sendTcpData } from '../service/tcpService'
import store from '../store'
import { observer } from 'mobx-react'
import styles from '../styles/SendStyles'
import DocumentPicker from 'react-native-document-picker'
import RNFS from 'react-native-fs'
import Icon from 'react-native-vector-icons/AntDesign'
import { randomFileName } from '../utils/file'
import sleep from '../utils/sleep'

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
    </View>
  )
})


const typeList = ['text', 'file']
const SelectType = ({ type, setType }) => {
  return (
    <ButtonGroup
      selectedIndex={ typeList.indexOf(type) }
      buttons={ ['发送文本', '发送文件'] }
      containerStyle={ styles.selectType }
      onPress={ (index) => { setType(typeList[index]) } } />
  )
}

const SendContent = ({ type }) => {
  switch (type) {
    case 'text':
      return <SendText />
    case 'file':
      return <SendFile />
  }
}

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
      <Button onPress={ sendText }>发送</Button>
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
      content: files.map(({ name, data }) => ({
        name: randomFileName(name),
        data,
      })),
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
              <Text>{ file.name }</Text>
              <Icon style={styles.fileListItemDelete} name="delete" size={ 16 } onPress={ () => { removeFile(file) } } />
            </View>
          )) }
        </ScrollView>
      }
      <Button disabled={ !files.length } loading={ sendingFile } onPress={ sendFile }>发送</Button>
    </>
  )
}
