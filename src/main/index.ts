import { app, BrowserWindow, shell, nativeImage, Tray, Menu } from 'electron'
import path from 'path'
import log from 'electron-log'
import { registerAuthIpc } from './ipc/auth'
import { registerCoursesIpc } from './ipc/courses'
import { registerNotificationsIpc } from './ipc/notifications'
import { registerFilesIpc } from './ipc/files'
import { registerHomeworkIpc } from './ipc/homework'
import { registerDiscussionIpc } from './ipc/discussion'
import { registerSettingsIpc } from './ipc/settings'
import { registerAiIpc } from './ipc/ai'
import { registerAppIpc } from './ipc/app'
import { loadCreds } from './services/session-store'
import {
  login,
  probeSession,
  probeApiSession,
  initFromBrowserSession,
  restoreApiSessionFromDisk,
  setCachedCreds,
} from './services/learn'

const isDev = !app.isPackaged
const startHidden = process.argv.includes('--hidden') || process.argv.includes('--background')
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let hiddenAt: number | null = null

function getIcon(): Electron.NativeImage | undefined {
  try {
    const iconPath = isDev
      ? path.join(app.getAppPath(), 'resources', 'icon.png')
      : path.join(process.resourcesPath, 'icon.png')
    return nativeImage.createFromPath(iconPath)
  } catch {
    return undefined
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
  } else {
    ensureRendererReady(mainWindow)
  }

  mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  notifyRendererResume(mainWindow)
  hiddenAt = null
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

function createTray(): void {
  if (tray) return
  const icon = getIcon()
  if (!icon) return

  tray = new Tray(icon)
  tray.setToolTip('learn++')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 learn++', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: quitApp },
  ]))
  tray.on('click', showMainWindow)
}

function ensureRendererReady(win: BrowserWindow): void {
  const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0
  const url = win.webContents.getURL()
  const shouldReload =
    win.webContents.isCrashed() ||
    !url ||
    hiddenFor > 30 * 60 * 1000

  if (shouldReload) {
    log.info(`Reloading renderer before showing window, hiddenFor=${hiddenFor}`)
    win.webContents.reloadIgnoringCache()
  }
}

function notifyRendererResume(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:resume')
    }
  }

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: !startHidden,
    title: 'learn++',
    icon: getIcon(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.setMenu(null)

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hiddenAt = Date.now()
    win.hide()
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    log.warn(`Renderer process gone: ${details.reason}`)
    if (!isQuitting && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache()
    }
  })

  win.on('unresponsive', () => {
    log.warn('Renderer became unresponsive, reloading')
    if (!isQuitting && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
      win.loadURL(rendererUrl)
      win.webContents.openDevTools()
    }
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  return win
}

async function tryAutoLogin(): Promise<boolean> {
  const creds = loadCreds()
  if (creds) {
    setCachedCreds(creds.username, creds.password)
  }

  await restoreApiSessionFromDisk()

  try {
    const ok = await probeApiSession()
    if (ok) {
      log.info('Auto-login via API session cookies succeeded')
      return true
    }
  } catch { /* session invalid */ }

  try {
    const ok = await probeSession()
    if (ok) {
      await initFromBrowserSession()
      log.info('Auto-login via Chromium session cookies succeeded')
      return true
    }
  } catch { /* session invalid */ }

  if (creds) {
    try {
      await login(creds.username, creds.password)
      log.info('Auto-login via saved credentials succeeded')
      return true
    } catch { /* creds invalid */ }
  }

  return false
}

function startSessionKeepAlive(): void {
  const refresh = async () => {
    try {
      const ok = await probeApiSession()
      if (ok) return

      const creds = loadCreds()
      if (creds) {
        await login(creds.username, creds.password)
        log.info('Session keep-alive refreshed via saved credentials')
      }
    } catch (err) {
      log.warn('Session keep-alive failed:', err instanceof Error ? err.message : String(err))
    }
  }

  setInterval(refresh, 10 * 60 * 1000)
}

app.whenReady().then(async () => {
  registerAuthIpc()
  registerCoursesIpc()
  registerNotificationsIpc()
  registerFilesIpc()
  registerHomeworkIpc()
  registerDiscussionIpc()
  registerSettingsIpc()
  registerAiIpc()
  registerAppIpc()

  mainWindow = createWindow()
  createTray()

  startSessionKeepAlive()

  tryAutoLogin().then((loggedIn) => {
    mainWindow?.webContents.send('auto-login-result', loggedIn)
  })
})

app.on('window-all-closed', () => {
  if (isQuitting) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow()
  } else {
    showMainWindow()
  }
})
