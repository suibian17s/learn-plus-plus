import { app, BrowserWindow, ipcMain, session } from 'electron'

const REPO_OWNER = 'suibian17s'
const REPO_NAME = 'learn-plus-plus'
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const normalBounds = new WeakMap<BrowserWindow, Electron.Rectangle>()
const customMaximized = new WeakMap<BrowserWindow, boolean>()

function getTargetWindow(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
    || BrowserWindow.getFocusedWindow()
    || BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
    || null
}

function runWindowCommand(sender: Electron.WebContents, command: string): { ok: boolean } {
  const win = getTargetWindow(sender)
  if (!win) return { ok: false }

  if (command === 'minimize') {
    if (win.isDestroyed()) return { ok: false }
    win.setSkipTaskbar(false)
    win.minimize()
    return { ok: true }
  }

  if (command === 'toggle-maximize') {
    const shouldRestore = win.isMaximized() || customMaximized.get(win)
    if (shouldRestore) {
      win.unmaximize()
      win.restore()
      const bounds = normalBounds.get(win)
      if (bounds) {
        setTimeout(() => {
          if (!win.isDestroyed()) win.setBounds(bounds, true)
        }, 0)
      }
      customMaximized.set(win, false)
    } else {
      if (!win.isMaximized()) normalBounds.set(win, win.getBounds())
      win.maximize()
      customMaximized.set(win, true)
    }
    return { ok: true }
  }

  if (command === 'close') {
    win.close()
    return { ok: true }
  }

  if (command === 'quit') {
    setTimeout(() => app.exit(0), 0)
    return { ok: true }
  }

  return { ok: false }
}

function normalizeVersion(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '').split(/[+-]/)[0]
  return cleaned.split('.').map((part) => {
    const n = Number.parseInt(part.replace(/\D.*$/, ''), 10)
    return Number.isFinite(n) ? n : 0
  })
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a)
  const right = normalizeVersion(b)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  return 0
}

async function checkLatestRelease() {
  const currentVersion = app.getVersion()

  try {
    const resp = await session.defaultSession.fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `learn++/${currentVersion}`,
      },
    })

    if (!resp.ok) {
      return {
        ok: false,
        currentVersion,
        error: `GitHub 返回 ${resp.status}`,
      }
    }

    const release = await resp.json() as {
      tag_name?: string
      name?: string
      html_url?: string
      draft?: boolean
      prerelease?: boolean
    }
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '')
    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        error: '未找到最新版本号',
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      releaseName: release.name || release.tag_name || `v${latestVersion}`,
      releaseUrl: release.html_url || RELEASES_URL,
      releasesUrl: RELEASES_URL,
    }
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function registerAppIpc(): void {
  ipcMain.handle('app:info', () => ({
    name: 'learn++',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))

  ipcMain.handle('app:check-updates', checkLatestRelease)

  ipcMain.on('window:command', (event, command: string) => {
    runWindowCommand(event.sender, command)
  })

  ipcMain.handle('window:minimize', (event) => {
    return runWindowCommand(event.sender, 'minimize')
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    return runWindowCommand(event.sender, 'toggle-maximize')
  })

  ipcMain.handle('window:close', (event) => {
    return runWindowCommand(event.sender, 'close')
  })

  ipcMain.handle('window:quit', (event) => {
    return runWindowCommand(event.sender, 'quit')
  })
}
