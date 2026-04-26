import { ipcMain, BrowserWindow, dialog } from 'electron'
import { withAuth, getStoredCSRFToken, getCookieString } from '../services/learn'
import { downloadFile } from '../services/downloader'
import { sanitizeFilename } from '../utils/sanitize'
import { defaultDownloadDir } from '../utils/paths'
import { AuthError } from '../utils/errors'
import fs from 'fs'
import https from 'https'
import os from 'os'
import path from 'path'

let downloadDirCache = defaultDownloadDir

export function setHwDownloadDir(dir: string): void {
  downloadDirCache = dir
}

function escapeMultipartQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '_')
}

function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return types[ext] || 'application/octet-stream'
}

function buildHomeworkMultipart(
  studentHomeworkId: string,
  content: string,
  attachmentPath: string | undefined,
  removeOld: boolean | undefined,
): { boundary: string; body: Buffer } {
  const boundary = `----LearnPP${Date.now()}${Math.random().toString(16).slice(2)}`
  const parts: Buffer[] = []

  function addField(name: string, value: string): void {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf-8',
    ))
  }

  function addFile(name: string, filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`附件不存在: ${filePath}`)
    }
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      throw new Error(`附件不是文件: ${filePath}`)
    }
    const fileBuffer = fs.readFileSync(filePath)
    if (fileBuffer.length === 0) {
      throw new Error('附件为空，请重新选择文件')
    }

    const filename = sanitizeFilename(path.basename(filePath)) || 'attachment'
    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"; filename="${escapeMultipartQuoted(filename)}"`,
      `Content-Type: ${contentTypeForFile(filePath)}`,
      '',
      '',
    ].join('\r\n')

    parts.push(Buffer.from(header, 'utf-8'))
    parts.push(fileBuffer)
    parts.push(Buffer.from('\r\n', 'utf-8'))
  }

  // Keep the same field order as thu-learn-lib / the browser form.
  addField('xszyid', studentHomeworkId)
  addField('zynr', content || '')
  if (attachmentPath) {
    addFile('fileupload', attachmentPath)
  } else {
    addField('fileupload', 'undefined')
  }
  addField('isDeleted', removeOld ? '1' : '0')

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'))
  return { boundary, body: Buffer.concat(parts) }
}

function copyAttachmentToSubmitTemp(filePath: string): { path: string; name: string; size: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error('文件不存在，请重新选择')
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw new Error('请选择一个文件')
  }

  const buffer = fs.readFileSync(filePath)
  if (buffer.length === 0) {
    throw new Error('附件为空，请重新选择文件')
  }

  const originalName = sanitizeFilename(path.basename(filePath)) || 'attachment'
  const tempDir = path.join(os.tmpdir(), 'learnpp-submit-attachments', `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  fs.mkdirSync(tempDir, { recursive: true })
  const tempPath = path.join(tempDir, originalName)
  fs.writeFileSync(tempPath, buffer)

  return { path: tempPath, name: originalName, size: buffer.length }
}

function cleanOptionalText(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text ? text : undefined
}

function normalizeScore(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric < 0) return undefined
  if (!Number.isFinite(numeric) && !/^\d+(\.\d+)?$/.test(String(value).trim())) return undefined
  return String(value)
}

function pickTeacherMessage(hw: any): string | undefined {
  return cleanOptionalText(
    hw.teacherMessage ??
    hw.teacherComment ??
    hw.message ??
    hw.remark ??
    hw.note ??
    hw.memo ??
    hw.comment ??
    hw.requirement,
  )
}

async function postHomeworkMultipart(boundary: string, body: Buffer): Promise<any> {
  const csrf = getStoredCSRFToken()
  const submitUrl = `https://learn.tsinghua.edu.cn/b/wlxt/kczy/zy/student/tjzy${csrf ? `?_csrf=${encodeURIComponent(csrf)}` : ''}`
  const cookie = await getCookieString(submitUrl)
  const parsed = new URL(submitUrl)

  return new Promise((resolve, reject) => {
    const req = https.request(parsed, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
        'User-Agent': 'learn++',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        const status = res.statusCode || 0
        const location = res.headers.location || ''

        if (status >= 300 && status < 400 && String(location).includes('login')) {
          reject(new AuthError('Cookie expired, re-authenticating'))
          return
        }
        if (text.toLowerCase().includes('login timeout') || text.toLowerCase().includes('not logged in')) {
          reject(new AuthError('Cookie expired, re-authenticating'))
          return
        }
        if (status >= 400) {
          reject(new Error(`提交失败: HTTP ${status}`))
          return
        }

        try {
          resolve(JSON.parse(text))
        } catch {
          reject(new Error(text.slice(0, 200) || '提交失败：服务器返回空响应'))
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export function registerHomeworkIpc(): void {
  ipcMain.handle('hw:list', async (_e, courseId: string) => {
    return withAuth(async (h) => {
      const list = await h.getHomeworkList(courseId)
      return list.map((hw: any) => ({
        id: hw.id,
        studentHomeworkId: hw.studentHomeworkId,
        title: hw.title,
        deadline: hw.deadline instanceof Date ? hw.deadline.toISOString() : String(hw.deadline || ''),
        status: hw.submitted ? (hw.graded ? '已批阅' : '已提交') : '未提交',
        score: normalizeScore(hw.grade),
        gradeLevel: hw.gradeLevel || undefined,
        gradeContent: hw.gradeContent || undefined,
        graderName: hw.graderName || undefined,
        gradeTime: hw.gradeTime instanceof Date ? hw.gradeTime.toISOString() : undefined,
        submitTime: hw.submitTime instanceof Date ? hw.submitTime.toISOString() : undefined,
        courseId,
        // Detail fields
        description: hw.description || '',
        teacherMessage: pickTeacherMessage(hw),
        attachments: hw.attachment ? [{ name: hw.attachment.name, url: hw.attachment.downloadUrl }] : [],
        answerContent: hw.answerContent || undefined,
        answerAttachment: hw.answerAttachment ? { name: hw.answerAttachment.name, url: hw.answerAttachment.downloadUrl } : null,
        submittedContent: hw.submittedContent || undefined,
        submittedAttachment: hw.submittedAttachment ? { name: hw.submittedAttachment.name, url: hw.submittedAttachment.downloadUrl } : null,
        gradeAttachment: hw.gradeAttachment ? { name: hw.gradeAttachment.name, url: hw.gradeAttachment.downloadUrl } : null,
      }))
    })
  })

  ipcMain.handle('hw:submit', async (_e, studentHomeworkId: string, content: string, attachmentPath?: string, removeOld?: boolean) => {
    try {
      const result: any = await withAuth(async () => {
        const { boundary, body } = buildHomeworkMultipart(studentHomeworkId, content, attachmentPath, removeOld)
        return postHomeworkMultipart(boundary, body)
      })
      if (result.result === 'error') {
        return { ok: false, error: result.msg || '提交失败' }
      }
      return { ok: true }
    } catch (err: any) {
      const msg = err?.message || err?.reason || String(err)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('hw:selectFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    })
    if (canceled || !filePaths.length) return null
    try {
      return copyAttachmentToSubmitTemp(filePaths[0])
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('hw:downloadAttachment', async (e, url: string, fileName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window')
    const safeName = sanitizeFilename(fileName)
    const downloadId = `att-${Date.now()}`
    return withAuth(async () => {
      const destPath = await downloadFile(url, downloadDirCache, safeName, win, downloadId)
      return { downloadId, destPath }
    })
  })
}
