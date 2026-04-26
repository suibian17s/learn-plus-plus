import { app, ipcMain } from 'electron'

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
}
