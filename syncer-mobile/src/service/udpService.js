import dgram from 'react-native-udp'
import store from '../store'
import { showConnectModal } from '../components/ConnectModal'
import { showRefuseModal } from '../components/RefuseModal'
import sleep from '../utils/sleep'

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
  showConnectModal({ uuid, name, device, port, address })
}

/** 处理type为refuse的UDP数据 */
function handleRefuse({ uuid, name, device }, port, address) {
  if (store.status !== 'connecting' || store.target.uuid !== uuid) {
    return
  }
  showRefuseModal({ uuid, name, device, port, address })
  store.cancel()
}

export {
  udpSocket,
  sendUdpData
}
