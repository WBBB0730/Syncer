import dgram from 'react-native-udp'
import store from '../store'
import sleep from '../utils/sleep'
import { Modal, modalStyles } from '../components/Modal'
import { Button } from '@rneui/base'
import { Text, View } from 'react-native'

const udpSocket = dgram.createSocket({ type: 'udp4' })
udpSocket.bind(5742)
udpSocket.on('listening', () => {
  udpSocket.setBroadcast(true)
  // udpSocket.addMembership('239.57.42.42')
})

/** 处理接收到的UDP数据 */
udpSocket.on('message', async (msg, { port, address }) => {

  let data
  try {
    data = JSON.parse(msg.toString())
    if (typeof data !== 'object' || !data.type || !data.uuid || data.uuid === store.uuid)
      return
  } catch (e) {
    return
  }

  console.log(`UDP: receive from ${ address }:${ port }`, data)

  switch (data.type) {
    case 'search':
      return handleSearch(port, address)
    case 'available':
      return handleAvailable(data, port, address)
    case 'connect':
      return handleConnect(data, port, address)
    case 'refuse':
      return handleRefuse(data, port, address)
  }
})

/** 发送UDP数据 */
function sendUdpData(data, port, address) {
  const { uuid, name } = store
  data = { ...data, uuid, name, device: 'mobile' }
  udpSocket.send(JSON.stringify(data), undefined, undefined, port, address)
  console.log(`UDP: send to ${ address }:${ port }`, data)
}

/** 处理type为search的UDP数据 */
function handleSearch(port, address) {
  if (store.status !== 'available')
    return
  sendUdpData({ type: 'available' }, port, address)
}

/** 处理type为available的UDP数据 */
function handleAvailable({ uuid, name, device }, port, address) {
  store.addAvailableDevice({ uuid, name, device, port, address })
}

/** 处理type为connect的UDP数据 */
function handleConnect({ uuid, name, device }, port, address) {
  const refuse = () => {
    sendUdpData({ type: 'refuse' }, port, address)
    Modal.hide()
  }

  const accept = async () => {
    await store.accept({ uuid, name, device, port, address })
    Modal.hide()
  }

  Modal.show({
    title: '连接请求',
    content: (
      <Text>{ name } 请求与你建立连接</Text>
    ),
    footer: (
      <>
        <View style={ { flexGrow: 1 } }>
          <Button type="outline" onPress={ refuse }>拒绝</Button>
        </View>
        <View style={ modalStyles.button }>
          <Button onPress={ accept }>接受</Button>
        </View>
      </>
    )
  })
}

/** 处理type为refuse的UDP数据 */
function handleRefuse({ uuid, name, device }, port, address) {
  if (store.status !== 'connecting' || store.target.uuid !== uuid) {
    return
  }
  Modal.show({
    title: '连接失败',
    content: (
      <Text>{ name } 拒绝了你的连接请求</Text>
    ),
    footer: (
      <View style={ modalStyles.button }>
        <Button onPress={ Modal.hide }>确定</Button>
      </View>
    )
  })
  store.cancel()
}

export {
  udpSocket,
  sendUdpData
}
