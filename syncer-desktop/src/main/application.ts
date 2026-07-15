import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  type WebContents
} from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AppSnapshot, LegacyLocalStorageValues } from '../shared/contracts'
import { registerIpcHandlers } from './ipc'
import {
  APP_RENDERER_URL,
  APP_SCHEME,
  isAllowedPermissionCheck,
  isAllowedPermissionRequest,
  isSafeExternalUrl,
  isTrustedRendererFrame,
  isTrustedRendererUrl,
  resolveRendererRequestPath
} from './security'
import { startNetworkStack, stopNetworkStack } from './services/bootstrap'
import { appState, initializeAppState } from './state'
import { initializeStorage } from './utils/storage'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let networkStartup: Promise<void> | null = null
let shutdownPromise: Promise<void> | null = null
let networkStarted = false
let applicationReady = false
let quitting = false
let allowQuit = false
const applicationName = /-beta\.\d+$/.test(app.getVersion()) ? 'Syncer Beta' : 'Syncer'

app.setName(applicationName)

const windowIcon =
  process.platform === 'win32'
    ? is.dev
      ? resolve(__dirname, '../../build/icon.ico')
      : join(process.resourcesPath, 'icon.ico')
    : icon

function showPrimaryWindow(): void {
  if (!applicationReady || !mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    title: applicationName,
    icon: windowIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev
    }
  })
  mainWindow = window

  const readyToShow = new Promise<void>((resolveReady) => {
    window.once('ready-to-show', resolveReady)
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(applicationName)
  })

  const openExternal = (url: string): void => {
    if (!isSafeExternalUrl(url)) return
    void shell
      .openExternal(url)
      .catch((error) => console.error('Failed to open external URL', error))
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    if (!process.env.IS_TEST) window.webContents.openDevTools()
  } else {
    await window.loadURL(APP_RENDERER_URL)
  }
  await readyToShow
}

function registerRendererProtocol(): void {
  const rendererDirectory = resolve(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const path = resolveRendererRequestPath(request.url, rendererDirectory)
    if (!path) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })
}

function isTrustedMainRenderer(
  webContents: WebContents | null,
  isMainFrame: boolean,
  requestingUrl?: string
): boolean {
  if (
    !webContents ||
    !mainWindow ||
    webContents !== mainWindow.webContents ||
    !isMainFrame ||
    !isTrustedRendererUrl(webContents.getURL())
  ) {
    return false
  }
  return requestingUrl === undefined || isTrustedRendererUrl(requestingUrl)
}

function registerPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isAllowedPermissionRequest(
          permission,
          isTrustedMainRenderer(webContents, details.isMainFrame, details.requestingUrl)
        )
      )
    }
  )
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      isAllowedPermissionCheck(
        permission,
        isTrustedRendererFrame(requestingOrigin, details.isMainFrame, details.requestingUrl),
        isTrustedMainRenderer(webContents, details.isMainFrame, details.requestingUrl)
      )
  )
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  const resolvedTrayIcon = trayIcon.isEmpty() ? nativeImage.createFromPath(icon) : trayIcon
  if (process.platform === 'darwin') resolvedTrayIcon.setTemplateImage(true)
  tray = new Tray(resolvedTrayIcon.isEmpty() ? icon : resolvedTrayIcon)
  tray.setToolTip(applicationName)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `打开 ${applicationName}`,
        click: showPrimaryWindow
      },
      { type: 'separator' },
      {
        label: '重新加载',
        click: () => mainWindow?.reload()
      },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showPrimaryWindow)
}

function configureApplicationMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  } else if (!is.dev) {
    Menu.setApplicationMenu(null)
  }
}

function registerApplicationLifecycle(): void {
  app.on('activate', showPrimaryWindow)
  app.on('before-quit', (event) => {
    quitting = true
    applicationReady = false
    if (allowQuit) {
      mainWindow?.destroy()
      return
    }

    event.preventDefault()
    mainWindow?.destroy()
    shutdownPromise ??= (async () => {
      try {
        await networkStartup
      } catch {
        return
      }
      if (networkStarted) await stopNetworkStack()
    })()
      .catch((error) => console.error('Failed to stop network stack', error))
      .finally(() => {
        networkStarted = false
        allowQuit = true
        app.quit()
      })
  })
}

export async function startApplication(): Promise<() => void> {
  registerApplicationLifecycle()
  await app.whenReady()

  electronApp.setAppUserModelId('Syncer')
  if (!(is.dev && process.env['ELECTRON_RENDERER_URL'])) registerRendererProtocol()
  registerPermissionHandlers()

  let resolveRendererStartup!: () => void
  let rejectRendererStartup!: (error: unknown) => void
  const rendererStartup = new Promise<void>((resolveStartup, rejectStartup) => {
    resolveRendererStartup = resolveStartup
    rejectRendererStartup = rejectStartup
  })

  const initializeRenderer = (legacyStorage: LegacyLocalStorageValues): Promise<AppSnapshot> => {
    if (!networkStartup) {
      networkStartup = (async () => {
        initializeStorage(legacyStorage)
        initializeAppState()
        await startNetworkStack()
        networkStarted = true
      })()
      void networkStartup.then(resolveRendererStartup, rejectRendererStartup)
    }
    return networkStartup.then(() => appState.snapshot())
  }

  registerIpcHandlers(() => mainWindow, showPrimaryWindow, initializeRenderer)
  const windowReady = createWindow()
  await Promise.all([windowReady, rendererStartup])
  if (quitting) return showPrimaryWindow

  createTray()
  configureApplicationMenu()
  applicationReady = true
  showPrimaryWindow()
  return showPrimaryWindow
}
