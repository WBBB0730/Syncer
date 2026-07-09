import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initUdpService } from './services/udpService'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    title: 'Syncer',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(trayIcon.isEmpty() ? icon : trayIcon)
  tray.setToolTip('Syncer')
  tray.setTitle('Syncer')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '重新加载',
        click: () => {
          mainWindow?.reload()
        }
      },
      {
        label: '退出',
        click: () => {
          ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.addListener('click', () => {
    if (mainWindow) mainWindow.show()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('Syncer')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(() => mainWindow)
  initUdpService()
  createWindow()
  createTray()

  if (!is.dev) {
    Menu.setApplicationMenu(null)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
  if (mainWindow) mainWindow.destroy()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
