import { ipcMain } from 'electron'
import { addFocusItem, removeFocusItem, getFocusItems } from '../services/focus-store'

export function registerFocusIpc(): void {
  ipcMain.handle('focus:add', async (_e, item: {
    id: string
    type: 'email' | 'custom'
    title: string
    description: string
    createdAt: string
    mailId?: string
  }) => {
    addFocusItem(item)
    return { ok: true }
  })

  ipcMain.handle('focus:remove', async (_e, id: string) => {
    removeFocusItem(id)
    return { ok: true }
  })

  ipcMain.handle('focus:list', async () => {
    return getFocusItems()
  })
}
