import { makeAutoObservable } from 'mobx'
import { randomNumber } from '../utils/random'
import uuid from 'react-native-uuid'
import { getStorage, setStorage } from '../utils/storage'
import { sendUdpData } from '../service/udpService'
import { closeTcpServer, connectTcpServer, openTcpServer, sendTcpData } from '../service/tcpService'

class Store {
  uuid = uuid.v4()
  status = 'available'
  name = ''
  availableDeviceMap = new Map()

  target = null

  constructor() {
    makeAutoObservable(this)
    initName().then(name => { this.setName(name) })
  }

  /**
   * @param { 'available' | 'connecting' | 'connected' } status
   */
  setStatus(status) { this.status = status }

  setName(name) {
    this.name = name
    setStorage('name', name).then()
  }

  clearAvailableDeviceMap() {
    this.availableDeviceMap.clear()
  }

  addAvailableDevice({ uuid, name, device, port, address }) {
    this.availableDeviceMap.set(uuid, { uuid, name, device, port, address })
  }

  setTarget(device) { this.target = device }


  /** 发起连接请求 */
  async connect(device) {
    await openTcpServer()
    this.setTarget(device)
    this.setStatus('connecting')
    sendUdpData({ type: 'connect' }, device.port, device.address)
  }

  /** 取消连接请求 */
  async cancel() {
    await closeTcpServer()
    this.setStatus('available')
    this.setTarget(null)
  }

  async accept(device) {
    await connectTcpServer(device)
    sendTcpData({
      type: 'accept',
      uuid: this.uuid,
    })
    store.setTarget(device)
    store.setStatus('connected')
  }
}

async function initName() {
  let name = await getStorage('name')
  if (name)
    return name
  name = `MOBILE_${ randomNumber(5) }`
  await getStorage('name', name)
  return name
}

const store = new Store()
export default store
