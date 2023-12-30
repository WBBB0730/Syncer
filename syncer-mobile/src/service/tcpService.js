import net from 'react-native-tcp-socket'
import store from '../store'
import Clipboard from '@react-native-clipboard/clipboard'
import { Text, ToastAndroid, View } from 'react-native'
import { Modal, modalStyles } from '../components/Modal'
import { Button } from '@rneui/base'
import RNFS from 'react-native-fs'


let tcpSocket = null
const server = net.createServer((socket) => {
  if (store.status !== 'connecting')
    return
  socket.once('data', (data) => {
    data = parseData(data)
    console.log(`TCP: receive`, data)
    if (!data || data.type !== 'accept')
      return
    handleAccept(socket, data)
  })
})

function openTcpServer() {
  return new Promise(resolve => {
    server.listen({ port: 5742 }, () => { resolve() })
  })
}

function closeTcpServer() {
  return new Promise(resolve => {
    server.close(() => { resolve() })
  })
}

function connectTcpServer({ port, address }) {
  return new Promise(resolve => {
    tcpSocket = new net.Socket()
    try {
      tcpSocket.connect({ port, host: address }, () => {
        initTcpSocket()
        resolve()
      })
    } catch (e) {}
  })
}

function closeTcpSocket() {
  if (tcpSocket === null)
    return
  tcpSocket.destroy()
  tcpSocket = null
}

function initTcpSocket() {
  tcpSocket.setKeepAlive(true)
  tcpSocket.on('data', (data) => {
    data = parseData(data)
    if (!data)
      return
    console.log('TCP: receive', data.type === 'file' ? { type: 'file', content: data.content.map(file => file.name) } : data)
    switch (data.type) {
      case 'text':
        return handleText(data)
      case 'file':
        return handleFile(data)
      case 'disconnect':
        return handleDisconnect()
    }
  })
  tcpSocket.on('close', () => {
    handleDisconnect()
    ToastAndroid.show('连接中断', ToastAndroid.SHORT)
  })
}

let queue = ''
function parseData(data) {
  data = queue + data.toString()
  if (data.endsWith('^')) {
    data = data.slice(0, -1)
    queue = ''
  } else {
    queue = data
    return
  }
  try {
    data = JSON.parse(data)
  } catch (e) {
    data = null
  }
  if (!data || typeof data !== 'object' || !data.type)
    return null
  return data
}

async function sendTcpData(data) {
  return new Promise((resolve) => {
    if (tcpSocket === null) {
      resolve()
      return
    }
    tcpSocket.write(JSON.stringify(data) + '^', 'utf8', resolve)
    console.log(`TCP: send`, data.type === 'file' ? { type: 'file', content: data.content.map(file => file.name) } : data)
  })
}

function handleAccept(socket, data) {
  if (store.status !== 'connecting' || data.uuid !== store.target.uuid) {
    socket.destroy()
    return
  }
  const { port, address } = socket.address()
  console.log('TCP connected', socket.address())
  tcpSocket = socket
  store.setTarget({ ...store.target, port, address })
  store.setStatus('connected')
  initTcpSocket()
  closeTcpServer().then()
}

function handleDisconnect() {
  store.disconnect()
}

function handleText({ content }) {
  const copy = () => {
    Clipboard.setString(content)
    ToastAndroid.show('已复制到剪贴板', ToastAndroid.SHORT)
  }

  Modal.show({
    title: '收到文本',
    content: (
      <Text>{ content }</Text>
    ),
    footer: (
      <>
        <View style={ modalStyles.button }>
          <Button type="outline" onPress={ Modal.hide }>忽略</Button>
        </View>
        <View style={ modalStyles.button }>
          <Button onPress={ copy }>复制</Button>
        </View>
      </>
    )
  })
}

function handleFile({ content }) {
  const save = async () => {
    Modal.hide()
    const path = RNFS.DownloadDirectoryPath + '/Syncer/'
    const exists = await RNFS.exists(path)
    if (!exists)
      await RNFS.mkdir(path)
    for (const file of content)
      await RNFS.writeFile(path + file.name, file.data, 'base64')
    ToastAndroid.show('已保存到' + path, ToastAndroid.LONG)
  }
  Modal.show({
    title: '收到文件',
    content: (
      <>{ content.map((file, index) => (
        <Text key={ index } style={ { marginBottom: 8 } }>{ file.name }</Text>
      )) }</>
    ),
    footer: (
      <>
        <View style={ modalStyles.button }>
          <Button type="outline" onPress={ Modal.hide }>忽略</Button>
        </View>
        <View style={ modalStyles.button }>
          <Button onPress={ save }>保存</Button>
        </View>
      </>
    )
  })
}

export {
  openTcpServer,
  closeTcpServer,
  connectTcpServer,
  closeTcpSocket,
  sendTcpData,
}

