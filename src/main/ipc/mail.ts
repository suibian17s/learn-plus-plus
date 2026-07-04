import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import { loginMailImap, getMailList, getMailDetail, setMailStarred, deleteMail, isMailLoggedIn, logoutMail, composeMail, testMailConnection, checkMailStatus, searchMail, ensureMailConnection } from '../services/mail-service'
import type { MailConfig } from '../services/mail-imap'

export function registerMailIpc(): void {
  ipcMain.handle('mail:login-imap', async (_e, config: MailConfig) => {
    const ok = await loginMailImap(config)
    return { ok }
  })

  ipcMain.handle('mail:test-connection', async (_e, config: MailConfig) => {
    const ok = await testMailConnection(config)
    return { ok }
  })

  ipcMain.handle('mail:status', async () => {
    // B20: 状态查询即触发自动连接 —— 已存配置+密码时重启后无需手动登录
    const loggedIn = await ensureMailConnection()
    return { loggedIn: loggedIn || isMailLoggedIn() }
  })

  ipcMain.handle('mail:check', async () => {
    return checkMailStatus()
  })

  ipcMain.handle('mail:list', async (_e, folder: string, force?: boolean) => {
    return getMailList(folder || 'inbox', !!force)
  })

  ipcMain.handle('mail:get', async (_e, mailId: string) => {
    return getMailDetail(mailId)
  })

  ipcMain.handle('mail:star', async (_e, mailId: string, starred: boolean) => {
    return setMailStarred(mailId, starred)
  })

  ipcMain.handle('mail:delete', async (_e, mailId: string, currentFolder?: string) => {
    return deleteMail(mailId, currentFolder)
  })

  ipcMain.handle('mail:logout', async () => {
    logoutMail()
    return { ok: true }
  })

  ipcMain.handle('mail:search', async (_e, query: string, folder?: string) => {
    return searchMail(query, folder || 'inbox')
  })

  ipcMain.handle('mail:compose', async (_e, params: { to: string; subject: string; body: string }) => {
    return composeMail(params)
  })

  ipcMain.handle('mail:save-attachment', async (e, tempPath: string, fileName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false, error: '无窗口' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: fileName, title: '保存附件',
    })
    if (canceled || !filePath) return { ok: false, error: '已取消' }
    try {
      fs.copyFileSync(tempPath, filePath)
      return { ok: true, destPath: filePath }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })
}
