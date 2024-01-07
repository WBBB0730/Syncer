import { makeAutoObservable } from 'mobx'
import { randomNumber } from '../utils/random'
import uuid from 'react-native-uuid'
import { getStorage, setStorage } from '../utils/storage'
import { sendUdpData } from '../service/udpService'
import { closeTcpServer, closeTcpSocket, connectTcpServer, openTcpServer, sendTcpData } from '../service/tcpService'

class Store {
  uuid = ''
  status = 'available'
  name = ''
  availableDeviceMap = new Map()

  target = null

  constructor() {
    makeAutoObservable(this)
    initValue('name', `MOBILE_${ randomNumber(5) }`).then((name) => this.setName(name))
    initValue('uuid', uuid.v4()).then((uuid) => this.setUuid(uuid))
  }

  setUuid(uuid) {
    this.uuid = uuid
    setStorage('uuid', uuid).then()
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

  /** 接收连接请求 */
  async accept(device) {
    await connectTcpServer(device)
    sendTcpData({
      type: 'accept',
      uuid: this.uuid,
    })
    store.setTarget(device)
    store.setStatus('connected')
  }

  disconnect() {
    closeTcpSocket()
    store.setTarget(null)
    store.setStatus('available')
  }
}

async function initValue(key, newValue) {
  return await getStorage(key) || newValue
}

const store = new Store()
export default store
