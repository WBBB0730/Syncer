import net from 'react-native-tcp-socket'
import store from '../store'
import Clipboard from '@react-native-clipboard/clipboard'
import { Text, ToastAndroid, View } from 'react-native'
import { Modal, modalStyles } from '../components/Modal'
import { Button } from '@rneui/themed'
import RNFS from 'react-native-fs'
import Sound from 'react-native-sound'
import { VolumeManager } from 'react-native-volume-manager'
import ReceiveHistory from "../components/ReceiveHistory";
import {getStorage, setStorage} from "../utils/storage";


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
      case 'disconnect':
        return handleDisconnect()
      case 'text':
        return handleText(data)
      case 'file':
        return handleFile(data)
      case 'ring':
        return handleRing(data)
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
    const receiveHistory = await getStorage('receiveHistory')||[]
    for (const file of content) {
      const name = file.name.slice(0, file.name.lastIndexOf('.'))
      const type = file.name.slice(file.name.lastIndexOf('.'))
      let i = 1
      while (await RNFS.exists(path + file.name))
        file.name = name + ` (${i++})` + type
      await RNFS.writeFile(path + file.name, file.data, 'base64')
      receiveHistory.unshift({ name: file.name, time: Date.now() })
    }
    ToastAndroid.show('已保存到' + path, ToastAndroid.LONG)
    await setStorage('receiveHistory', receiveHistory)
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

Sound.setCategory('Playback')
const sound = new Sound(require('../assets/ring.mp3'))
let volume = 0.5

function handleRing({ content }) {
  const startRing = async () => {
    if (!sound)
      return
    volume = await VolumeManager.getVolume()
    await VolumeManager.setVolume(1)
    sound.setNumberOfLoops(-1).setVolume(1).play()
    Modal.show({
      title: '查找设备',
      content: (
        <Text>你的设备正在被查找，点击停止响铃</Text>
      ),
      footer: (
        <View style={ modalStyles.button }>
          <Button onPress={ stopRing }>停止</Button>
        </View>
      )
    })
  }

  const stopRing = async () => {
    sound.stop()
    Modal.hide()
    await VolumeManager.setVolume(volume)
  }

  if (content)
    startRing().then()
  else
    stopRing().then()
}

export {
  openTcpServer,
  closeTcpServer,
  connectTcpServer,
  closeTcpSocket,
  sendTcpData,
}

