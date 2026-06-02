import { ipcMain } from 'electron'
import { loginMail, loginMailImap, getMailList, getMailDetail, setMailStarred, deleteMail, isMailLoggedIn, logoutMail, showMailWindow, composeMail, testMailConnection, checkMailStatus } from '../services/mail-service'
import type { MailConfig } from '../services/mail-imap'

export function registerMailIpc(): void {
  ipcMain.handle('mail:login', async () => {
    const ok = await loginMail()
    return { ok }
  })

  ipcMain.handle('mail:login-imap', async (_e, config: MailConfig) => {
    const ok = await loginMailImap(config)
    return { ok }
  })

  ipcMain.handle('mail:test-connection', async (_e, config: MailConfig) => {
    const ok = await testMailConnection(config)
    return { ok }
  })

  ipcMain.handle('mail:status', async () => {
    return { loggedIn: isMailLoggedIn() }
  })

  ipcMain.handle('mail:check', async () => {
    return checkMailStatus()
  })

  ipcMain.handle('mail:list', async (_e, folder: string) => {
    return getMailList(folder || 'inbox')
  })

  ipcMain.handle('mail:get', async (_e, mailId: string) => {
    return getMailDetail(mailId)
  })

  ipcMain.handle('mail:star', async (_e, mailId: string, starred: boolean) => {
    return setMailStarred(mailId, starred)
  })

  ipcMain.handle('mail:delete', async (_e, mailId: string) => {
    return deleteMail(mailId)
  })

  ipcMain.handle('mail:logout', async () => {
    logoutMail()
    return { ok: true }
  })

  ipcMain.handle('mail:show', async () => {
    showMailWindow()
  })

  ipcMain.handle('mail:compose', async (_e, params: { to: string; subject: string; body: string }) => {
    return composeMail(params)
  })
}
