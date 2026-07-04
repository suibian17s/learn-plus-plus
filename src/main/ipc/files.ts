import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { withAuth } from '../services/learn'
import { downloadFile, downloadUrlToBuffer } from '../services/downloader'
import { sanitizeFilename } from '../utils/sanitize'
import { defaultDownloadDir } from '../utils/paths'
import fs from 'fs'
import os from 'os'
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

function getDownloadTarget(courseId: string, fileName: string): string {
  return path.join(downloadDirCache, courseId, sanitizeFilename(fileName))
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
        chapter: (f as any).chapter || '未分类',
        courseId,
      }))
    })
  })

  ipcMain.handle('files:download', async (e, courseId: string, fileId: string, fileName: string, url: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window')
    const safeName = sanitizeFilename(fileName)
    const downloadId = `${fileId}-${Date.now()}`
    const destPath = await withAuth(async () => {
      return downloadFile(url, path.join(downloadDirCache, courseId), safeName, win, downloadId)
    })
    return { downloadId, destPath }
  })

  ipcMain.handle('files:downloadState', async (_e, arg1: string, arg2?: string, arg3?: string) => {
    // New signature: (courseId, fileId, fileName)
    // Old backward-compat signature: (fileName)
    if (arg2 === undefined) {
      // Old signature: just fileName — check root download dir
      const destPath = path.join(downloadDirCache, sanitizeFilename(arg1))
      return {
        key: arg1,
        downloaded: fs.existsSync(destPath),
        destPath,
      }
    }
    // New signature: courseId, fileId, fileName
    const key = `${arg1}_${arg2}`
    const destPath = getDownloadTarget(arg1, arg3!)
    return {
      key,
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

  ipcMain.handle('files:preview', async (_e, fileId: string, fileName: string, url: string) => {
    const tempDir = path.join(os.tmpdir(), 'learnpp-preview')
    fs.mkdirSync(tempDir, { recursive: true })
    const tempPath = path.join(tempDir, sanitizeFilename(fileName))
    if (fs.existsSync(tempPath)) {
      return { tempPath, fileType: path.extname(fileName).toLowerCase() }
    }
    const buffer = await withAuth(async () => {
      return downloadUrlToBuffer(url)
    })
    fs.writeFileSync(tempPath, buffer)
    return { tempPath, fileType: path.extname(fileName).toLowerCase() }
  })

  ipcMain.handle('files:previewOpen', async (_e, fileId: string, fileName: string, url: string) => {
    const tempDir = path.join(os.tmpdir(), 'learnpp-preview')
    fs.mkdirSync(tempDir, { recursive: true })
    const tempPath = path.join(tempDir, sanitizeFilename(fileName))
    if (!fs.existsSync(tempPath)) {
      const buffer = await withAuth(async () => downloadUrlToBuffer(url))
      fs.writeFileSync(tempPath, buffer)
    }
    const { method, content } = await (await import('../services/office-converter')).previewFile(tempPath)
    return { method, content, fileName }
  })

  ipcMain.handle('files:batchDownload', async (e, items: { courseId: string; fileId: string; fileName: string; url: string }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window')
    const CONCURRENCY = 3
    const results: { fileId: string; success: boolean; destPath?: string; error?: string }[] = []
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(async (item) => {
        try {
          const safeName = sanitizeFilename(item.fileName)
          const downloadId = `${item.fileId}-batch-${Date.now()}`
          const destPath = await withAuth(async () => downloadFile(item.url, path.join(downloadDirCache, item.courseId), safeName, win!, downloadId))
          results.push({ fileId: item.fileId, success: true, destPath })
        } catch (err: any) {
          results.push({ fileId: item.fileId, success: false, error: err.message })
        }
      }))
    }
    return results
  })

  ipcMain.handle('files:openFile', async (_e, filePath: string) => {
    shell.openPath(filePath)
  })

  ipcMain.handle('files:previewWindow', async (_e, filePath: string, fileName: string) => {
    const ext = path.extname(filePath).toLowerCase()
    const parent = BrowserWindow.getFocusedWindow()

    if (ext === '.pdf') {
      const win = new BrowserWindow({
        width: 960,
        height: 720,
        title: fileName,
        parent: parent || undefined,
        modal: false,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      win.setMenu(null)
      win.loadURL(`file://${filePath.replace(/\\/g, '/')}`)
      win.once('ready-to-show', () => win.show())
      return
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      const encoded = filePath.replace(/\\/g, '/')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        *{margin:0;padding:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a}
        img{max-width:100%;max-height:100vh;object-fit:contain;-webkit-user-drag:none;user-select:none}
      </style></head><body><img src="file://${encoded}" /></body></html>`
      const win = new BrowserWindow({
        width: 960,
        height: 720,
        title: fileName,
        parent: parent || undefined,
        modal: false,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      win.setMenu(null)
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      win.once('ready-to-show', () => win.show())
      return
    }

    // For other text-based fallbacks, just open externally
    shell.openPath(filePath)
  })
}
