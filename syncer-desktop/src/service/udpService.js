import store from '@/store'
import dgram from 'dgram'
import { DesktopOutlined, MobileOutlined, QuestionOutlined, EditOutlined } from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'
import { h } from 'vue'

const udpSocket = dgram.createSocket('udp4')
udpSocket.bind({ port: 5742 }, () => {
  udpSocket.setBroadcast(true)
  // udpSocket.addMembership('239.57.42.42')
})

/** 处理接收到的UDP数据 */
udpSocket.on('message', (msg, { port, address }) => {
  let data
  try {
    data = JSON.parse(msg.toString())
    if (typeof data !== 'object' || !data.type || !data.uuid || data.uuid === store.state.uuid)
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
  const { uuid, name } = store.state
  data = { ...data, uuid, name, device: 'desktop' }
  udpSocket.send(JSON.stringify(data), port, address)
  console.log(`UDP: send to ${ address }:${ port }`, data)
}

/** 处理type为search的UDP数据 */
function handleSearch(port, address) {
  if (store.state.status !== 'available')
    return
  sendUdpData({ type: 'available' }, port, address)
}

/** 处理type为available的UDP数据 */
function handleAvailable({ uuid, name, device }, port, address) {
  store.commit('addAvailableDevice', { uuid, name, device, port, address })
}

/** 处理type为connect的UDP数据 */
function handleConnect({ uuid, name, device }, port, address) {
  if (store.state.status !== 'available')
    return
  Modal.confirm({
    centered: true,
    icon: null,
    title: '连接请求',
    content: h('div', { style: { display: 'flex', alignItems: 'center' } },
      [
        h(device === 'desktop' ? DesktopOutlined : device === 'mobile' ? MobileOutlined : QuestionOutlined, {
          style: { marginRight: '8px', color: '#fa8c16', fontSize: '20px' }
        }),
        `${ name } 请求与你建立连接`
      ]),
    cancelText: '拒绝',
    okText: '接受',
    onCancel: () => {
      sendUdpData({ type: 'refuse' }, port, address)
    },
    onOk: () => {
      store.dispatch('accept', { uuid, name, device, port, address })
    }
  })
}

/** 处理type为refuse的UDP数据 */
async function handleRefuse({ uuid, name, device }, port, address) {
  if (store.state.status !== 'connecting' || store.state.target.uuid !== uuid) {
    return
  }
  await store.dispatch('cancel')
  Modal.info({
    centered: true,
    icon: null,
    title: '连接失败',
    content: `${ name } 拒绝了你的连接请求`,
    okText: '确定',
  })
}

export {
  udpSocket,
  sendUdpData
}
