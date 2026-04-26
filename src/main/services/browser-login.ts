import { BrowserWindow } from 'electron'
import log from 'electron-log'

export interface BrowserLoginOptions {
  loginUrl?: string
}

const DEFAULT_LOGIN_URL = 'https://learn.tsinghua.edu.cn/'

export async function browserLogin(opts: BrowserLoginOptions = {}): Promise<void> {
  const loginUrl = opts.loginUrl || DEFAULT_LOGIN_URL

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      title: '登录清华网络学堂 — 请在浏览器窗口中完成登录',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    win.setMenu(null)

    let resolved = false
    const cleanup = () => {
      if (resolved) return
      resolved = true
      if (!win.isDestroyed()) {
        try { win.close() } catch { /* ignore */ }
      }
    }

    let hasVisitedId = false

    const onNavigate = (_event: any, url: string) => {
      if (resolved) return

      if (url.includes('id.tsinghua.edu.cn')) {
        hasVisitedId = true
        return
      }

      if (url.includes('learn.tsinghua.edu.cn') && /\/[fb]\/wlxt\//.test(url)) {
        onSuccess()
        return
      }

      if (url.includes('webvpn.tsinghua.edu.cn') && /\/[fb]\/wlxt\//.test(url)) {
        onSuccess()
        return
      }

      if (hasVisitedId && url.includes('learn.tsinghua.edu.cn') && !url.includes('id.tsinghua.edu.cn')) {
        onSuccess()
      }
    }

    win.webContents.on('did-navigate', onNavigate)
    win.webContents.on('did-navigate-in-page', onNavigate)

    win.on('closed', () => {
      if (!resolved) {
        cleanup()
        reject(new Error('登录窗口已关闭'))
      }
    })

    win.loadURL(loginUrl)

    function onSuccess() {
      log.info('Browser login detected — cookies persisted in Electron session')
      // Small delay to ensure all cookies are fully written to session storage
      setTimeout(() => {
        cleanup()
        resolve()
      }, 1000)
    }
  })
}
