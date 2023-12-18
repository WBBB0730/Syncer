import net from 'react-native-tcp-socket'
import store from '../store'
import { showTextModal } from '../components/TextModal'
import Clipboard from '@react-native-clipboard/clipboard'


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
    tcpSocket.connect({ port, host: address }, () => {
      tcpSocketHandler()
      resolve()
    })
  })
}

function closeTcpSocket() {
  if (tcpSocket === null)
    return
  tcpSocket.destroy()
  tcpSocket = null
}

function sendTcpData(data) {
  if (tcpSocket === null)
    return
  tcpSocket.write(JSON.stringify(data))
  console.log('TCP: send', data)
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
  tcpSocketHandler()
  closeTcpServer().then()
}

function handleDisconnect() {
  store.disconnect()
}

function handleText({ content }) {
  Clipboard.setString(content)
  showTextModal(content)
}

export {
  openTcpServer,
  closeTcpServer,
  connectTcpServer,
  closeTcpSocket,
  sendTcpData,
}

