import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { withAuth } from '../services/learn'
import { downloadFile } from '../services/downloader'
import { sanitizeFilename } from '../utils/sanitize'
import { defaultDownloadDir } from '../utils/paths'
import fs from 'fs'
import path from 'path'

let downloadDirCache = defaultDownloadDir

function normalizeFileType(fileType: unknown): string {
  const ext = String(fileType || '').trim().toLowerCase().replace(/^\./, '')
  if (!/^[a-z0-9]{1,10}$/.test(ext)) return ''
  return ext
}

function withFileTypeExtension(name: string, fileType: unknown): string {
  if (path.extname(name)) return name
  const ext = normalizeFileType(fileType)
  return ext ? `${name}.${ext}` : name
}

export function setDownloadDir(dir: string): void {
  downloadDirCache = dir
}

export function getDownloadDir(): string {
  return downloadDirCache
}

function getDownloadTarget(fileName: string): string {
  return path.join(downloadDirCache, sanitizeFilename(fileName))
}

export function registerFilesIpc(): void {
  ipcMain.handle('files:list', async (_e, courseId: string) => {
    return withAuth(async (h) => {
      const list = await h.getFileList(courseId)
      return list.map((f) => ({
        id: f.id,
        fileId: f.fileId,
        name: f.title,
        downloadName: withFileTypeExtension(f.title, f.fileType),
        size: f.rawSize,
        downloadUrl: f.downloadUrl,
        uploadTime: typeof f.uploadTime === 'object' ? (f.uploadTime as Date).toISOString() : String(f.uploadTime),
        fileType: f.fileType,
        courseId,
      }))
    })
  })

  ipcMain.handle('files:download', async (e, fileId: string, fileName: string, url: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window')
    const safeName = sanitizeFilename(fileName)
    const downloadId = `${fileId}-${Date.now()}`
    const destPath = await withAuth(async () => {
      return downloadFile(url, downloadDirCache, safeName, win, downloadId)
    })
    return { downloadId, destPath }
  })

  ipcMain.handle('files:downloadState', async (_e, fileName: string) => {
    const destPath = getDownloadTarget(fileName)
    return {
      downloaded: fs.existsSync(destPath),
      destPath,
    }
  })

  ipcMain.handle('files:openFolder', async (_e, filePath: string) => {
    const dir = path.dirname(filePath)
    shell.openPath(dir)
  })

  ipcMain.handle('files:selectDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (canceled || !filePaths.length) return null
    return filePaths[0]
  })

  ipcMain.handle('files:exists', async (_e, filePath: string) => {
    return fs.existsSync(filePath)
  })
}
