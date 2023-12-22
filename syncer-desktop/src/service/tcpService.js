import net from 'net'
import store from '@/store'
import { Modal } from 'ant-design-vue'
import { dialog, webContents } from '@electron/remote'
import fs from 'fs/promises'
import { h } from 'vue'
import { getStorage, setStorage } from '@/utils/storage'

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
      initTcpSocket()
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

function initTcpSocket() {
  tcpSocket.setKeepAlive(true)
  tcpSocket.on('data', (data) => {
    data = parseData(data)
    if (!data)
      return
    console.log('TCP: receive', data)
    switch (data.type) {
      case 'text':
        return handleText(data)
      case 'file':
        return handleFile(data)
      case 'disconnect':
        return handleDisconnect()
    }
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

/** 发送TCP数据 */
function sendTcpData(data) {
  return new Promise((resolve) => {
    if (tcpSocket === null) {
      resolve()
      return
    }
    tcpSocket.write(JSON.stringify(data) + '^', 'utf8', resolve)
    console.log(`TCP: send`, data)
  })
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
  initTcpSocket()
  closeTcpServer().then()
}

function handleDisconnect() {
  store.dispatch('disconnect').then()
}

function handleText({ content }) {
  Modal.confirm({
    icon: null,
    title: '收到文本',
    content,
    cancelText: '忽略',
    okText: '复制',
    onOk: async () => {
      await navigator.clipboard.writeText(content)
    },
    centered: true,
  })
}

function handleFile({ content }) {
  Modal.confirm({
    icon: null,
    title: '收到文件',
    content: h('div', {}, [
      content.map(file => h('div', {
        style: 'margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
      }, file.name))
    ]),
    cancelText: '忽略',
    okText: '保存',
    onOk: async () => {
      const res = dialog.showOpenDialogSync({
        title: '测试',
        defaultPath: getStorage('filePath') || undefined,
        properties: ['openDirectory']
      })
      if (!res)
        return Promise.reject('')
      const path = res[0]
      setStorage('filePath', path)
      for (const file of content)
        await fs.writeFile(path + '/' + file.name, file.data, { encoding: 'base64' })
    },
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
