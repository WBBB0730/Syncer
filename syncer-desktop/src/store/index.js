import { createStore } from 'vuex'
import { v4 } from 'uuid'
import { randomNumber } from '@/utils/random'
import { getStorage, setStorage } from '@/utils/storage'
import { closeTcpServer, closeTcpSocket, connectTcpServer, openTcpServer, sendTcpData } from '@/service/tcpService'
import { sendUdpData } from '@/service/udpService'

export default createStore({
  state: {
    uuid: initValue('uuid', v4()),
    status: 'available',    // available、connecting、connected
    name: initValue('name', `DESKTOP_${ randomNumber(5) }`),
    availableDeviceMap: new Map(),

    target: null,
  },
  getters: {},
  mutations: {
    setUuid(state, uuid) {
      state.uuid = uuid
      setStorage('uuid', uuid)
    },
    /**
     * @param state
     * @param { 'available' | 'connecting' | 'connected' } status
     */
    setStatus(state, status) {
      state.status = status
    },
    setName(state, name) {
      state.name = name
      setStorage('name', name)
    },
    clearAvailableDeviceMap(state) {
      state.availableDeviceMap.clear()
    },
    addAvailableDevice(state, { uuid, name, device, port, address }) {
      state.availableDeviceMap.set(uuid, { uuid, name, device, port, address })
    },
    setTarget(state, device) {
      state.target = device
    },
  },
  actions: {
    /** 发起连接请求 */
    async connect({ commit }, { uuid, name, device, port, address }) {
      await openTcpServer()
      commit('setStatus', 'connecting')
      commit('setTarget', { uuid, name, device, port, address })
      sendUdpData({ type: 'connect' }, port, address)
    },

    /** 取消连接请求 */
    async cancel({ commit }) {
      await closeTcpServer()
      commit('setStatus', 'available')
      commit('setTarget', null)
    },

    /** 接受连接请求 */
    async accept({ commit, state }, device) {
      await connectTcpServer(device)
      sendTcpData({
        type: 'accept',
        uuid: state.uuid,
      })
      commit('setTarget', device)
      commit('setStatus', 'connected')
    },

    /** 断开连接 */
    async disconnect({ commit, state }) {
      closeTcpSocket()
      commit('setTarget', null)
      commit('setStatus', 'available')
    },
  },
  modules: {}
})

function initValue(key, newValue) {
  return getStorage(key) || newValue
}
