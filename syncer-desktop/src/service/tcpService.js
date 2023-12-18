import net from 'net'
import store from '@/store'
import { Modal } from 'ant-design-vue'

let tcpSocket = null
const server = net.createServer((socket) => {
  if (store.state.status !== 'connecting')
    return
  socket.once('data', (data) => {
    data = parseData(data)
    console.log(`TCP: receive`, data)
    if (!data || data.type !== 'accept') {
      socket.destroy()
      return
    }
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
    tcpSocket.connect({ port, host: address }, () => {
      tcpSocketHandler()
      resolve()
    })
  })
}

/** 关闭TCP连接 */
function closeTcpSocket() {
  if (tcpSocket === null)
    return
  tcpSocket.destroy()
  tcpSocket = null
}

function tcpSocketHandler() {
  tcpSocket.on('data', (data) => {
    data = parseData(data)
    if (!data)
      return
    console.log('TCP: receive', data)
    switch (data.type) {
      case 'text':
        return handleText(data)
      case 'disconnect':
        return handleDisconnect()
    }
  })
}

function parseData(data) {
  try {
    data = JSON.parse(data)
  } catch (e) {
    data = null
  }
  if (!data || typeof data !== 'object' || !data.type)
    return null
  return data
}

/** 发送TCP数据 */
function sendTcpData(data) {
  if (tcpSocket === null)
    return
  tcpSocket.write(JSON.stringify(data))
  console.log(`TCP: send`, data)
}

function handleAccept(socket, data) {
  if (store.state.status !== 'connecting' || data.uuid !== store.state.target.uuid) {
    socket.destroy()
    return
  }
  const { port, address } = socket.address()
  console.log('TCP connected', socket.address())
  tcpSocket = socket
  store.commit('setTarget', { ...store.state.target, port, address })
  store.commit('setStatus', 'connected')
  tcpSocketHandler()
  closeTcpServer().then()
}

function handleDisconnect() {
  store.dispatch('disconnect').then()
}

function handleText({ content }) {
  navigator.clipboard.writeText(content).then()
  Modal.info({
    icon: null,
    title: '收到文本',
    content,
    centered: true,
  })
}

export {
  openTcpServer,
  closeTcpServer,
  connectTcpServer,
  closeTcpSocket,
  sendTcpData,
}
