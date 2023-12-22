'use strict'

import { app, protocol, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
const path = require('path')
require('@electron/remote/main').initialize()

const isDevelopment = process.env.NODE_ENV !== 'production'

// 必须在应用程序准备就绪之前注册方案
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

let win
async function createWindow () {
  // 创建浏览器窗口
  win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Syncer',
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // 请参阅 https://nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration 了解更多信息
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
      // preload: path.join(__dirname, 'preload.js'),
      devTools: isDevelopment,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', (event) => {
    event.preventDefault()
    win.hide()
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // 如果处于开发模式，则加载开发服务器的 url
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) win.webContents.openDevTools()
  } else {
    createProtocol('app')
    // 否则加载index.html
    await win.loadURL('app://./index.html')
  }

  require('@electron/remote/main').enable(win.webContents)
}

let tray
function createTray() {
  const icon = nativeImage.createFromPath('/resources/icon.ico')
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '退出', click: () => { app.quit() } }
  ])
  tray.setContextMenu(contextMenu)
  tray.setTitle('Syncer')
  tray.addListener('click', () => {
    if (win)
      win.show()
  })
}

// 当所有窗口都关闭时退出
app.on('window-all-closed', () => {
  // 在 macOS 上，应用程序及其菜单栏通常会保持活动状态，直到用户使用 Cmd + Q 显式退出
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // 在 macOS 上，当单击停靠图标并且没有打开其他窗口时，通常会在应用程序中重新创建一个窗口。
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 当 Electron 完成初始化并准备好创建浏览器窗口时，将调用此方法
// 有些API只有在该事件发生后才能使用
app.on('ready', async () => {
  // if (isDevelopment && !process.env.IS_TEST) {
  //   // Install Vue Devtools
  //   try {
  //     await installExtension(VUEJS3_DEVTOOLS)
  //   } catch (e) {
  //     console.error('Vue Devtools failed to install:', e.toString())
  //   }
  // }
  createTray()
  createWindow()
})

app.on('before-quit', () => {
  if (win)
    win.destroy()
})

// 在开发模式下，根据父进程的请求退出
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}

// 正式环境
if (!isDevelopment) {
  // 关闭菜单栏
  Menu.setApplicationMenu(null)
}
