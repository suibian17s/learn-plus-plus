import { ipcMain } from 'electron'
import { loginMail, getMailList, getMailDetail, setMailStarred, deleteMail, isMailLoggedIn } from '../services/mail-service'

export function registerMailIpc(): void {
  ipcMain.handle('mail:login', async () => {
    const ok = await loginMail()
    return { ok }
  })

  ipcMain.handle('mail:status', async () => {
    return { loggedIn: isMailLoggedIn() }
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
}
