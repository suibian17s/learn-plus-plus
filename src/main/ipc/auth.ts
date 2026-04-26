import { ipcMain, session } from 'electron'
import { login, probeSession, probeApiSession, initFromBrowserSession, getHelper, syncApiCookiesToDefaultSession } from '../services/learn'
import { saveCreds, loadCreds, clearAll, listAccounts, saveCurrentAccount, switchAccount } from '../services/session-store'
import { browserLogin } from '../services/browser-login'
import { formatError } from '../utils/errors'
import type { AuthStatus } from '../types'

export function registerAuthIpc(): void {
  ipcMain.handle('auth:login', async (_e, username: string, password: string, _remember: boolean) => {
    try {
      await login(username, password)
      saveCreds(username, password)
      try {
        const user = await getHelper().getUserInfo()
        await saveCurrentAccount(user)
      } catch { /* account snapshot is best-effort */ }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('auth:login-browser', async (_e, loginUrl?: string) => {
    try {
      await browserLogin({ loginUrl })
      await initFromBrowserSession()
      const user = await getHelper().getUserInfo()
      await saveCurrentAccount(user)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('auth:add-account-browser', async (_e, loginUrl?: string) => {
    try {
      try {
        const user = await getHelper().getUserInfo()
        await saveCurrentAccount(user)
      } catch { /* current session may be missing */ }

      await session.defaultSession.clearStorageData({ storages: ['cookies'] })
      await browserLogin({ loginUrl })
      await initFromBrowserSession()
      const user = await getHelper().getUserInfo()
      const account = await saveCurrentAccount(user)
      return { ok: true, account }
    } catch (err) {
      await syncApiCookiesToDefaultSession()
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('auth:accounts', async () => {
    try {
      const ok = await probeApiSession()
      if (ok) {
        const user = await getHelper().getUserInfo()
        await saveCurrentAccount(user)
      }
    } catch { /* best-effort migration for existing sessions */ }
    return listAccounts()
  })

  ipcMain.handle('auth:switch-account', async (_e, id: string) => {
    try {
      const account = await switchAccount(id)
      if (!account) return { ok: false, error: '账号档案不存在或已损坏' }
      const ok = await probeApiSession()
      if (!ok) return { ok: false, error: '该账号登录已失效，请重新添加账号' }
      return { ok: true, account }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('auth:logout', async () => {
    await clearAll()
    return { ok: true }
  })

  ipcMain.handle('auth:status', async (): Promise<AuthStatus> => {
    const creds = loadCreds()
    try {
      const ok = await probeApiSession()
      if (ok) {
        return { loggedIn: true, hasStoredCredentials: !!creds }
      }
    } catch { /* fall through */ }

    try {
      const ok = await probeSession()
      if (ok) {
        await initFromBrowserSession()
        return { loggedIn: true, hasStoredCredentials: !!creds }
      }
    } catch { /* fall through */ }

    return { loggedIn: false, hasStoredCredentials: !!creds }
  })

  ipcMain.handle('auth:hasStoredCredentials', () => {
    const creds = loadCreds()
    return !!creds
  })
}
