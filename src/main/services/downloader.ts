import { getCookieString } from './learn'
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { AuthError } from '../utils/errors'
import { sanitizeFilename } from '../utils/sanitize'
import type { BrowserWindow } from 'electron'

const MAX_REDIRECTS = 5

function isLoginUrl(url: string): boolean {
  return url.includes('login') || url.includes('id.tsinghua')
}

function getHeaderNumber(value: string | string[] | number | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = parseInt(String(raw || '0'), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function getHeaderString(value: string | string[] | number | undefined): string {
  if (Array.isArray(value)) return value[0] || ''
  return value == null ? '' : String(value)
}

function decodeHeaderFilename(value: string): string {
  try {
    return Buffer.from(value, 'latin1').toString('utf8')
  } catch {
    return value
  }
}

function filenameFromContentDisposition(value: string): string | null {
  if (!value) return null

  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''))
    } catch {
      return encoded[1].trim().replace(/^"|"$/g, '')
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i)
  if (!plain) return null
  return decodeHeaderFilename(plain[1].trim())
}

function withResponseExtension(requestedName: string, contentDisposition: string): string {
  if (path.extname(requestedName)) return requestedName

  const headerName = filenameFromContentDisposition(contentDisposition)
  if (!headerName) return requestedName

  const ext = path.extname(headerName)
  return ext ? `${requestedName}${ext}` : requestedName
}

async function openDownloadResponse(
  url: string,
  redirectCount = 0,
): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  if (isLoginUrl(url)) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  const cookie = await getCookieString(url)
  const parsed = new URL(url)
  const client = parsed.protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': 'learn++',
      },
    }, (res) => {
      const status = res.statusCode || 0
      const location = res.headers.location

      if ([301, 302, 303, 307, 308].includes(status) && location) {
        res.resume()
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects while downloading'))
          return
        }

        const nextUrl = new URL(location, url).href
        openDownloadResponse(nextUrl, redirectCount + 1).then(resolve, reject)
        return
      }

      if (status >= 400) {
        res.resume()
        reject(new Error(`Download failed: HTTP ${status}`))
        return
      }

      resolve({ res, finalUrl: url })
    })

    req.on('error', reject)
    req.end()
  })
}

export async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const { res, finalUrl } = await openDownloadResponse(url)
  if (isLoginUrl(finalUrl)) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  })
}

export async function downloadUrlToBufferWithMeta(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const { res, finalUrl } = await openDownloadResponse(url)
  if (isLoginUrl(finalUrl)) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    res.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      contentType: getHeaderString(res.headers['content-type']),
    }))
    res.on('error', reject)
  })
}

export async function downloadFile(
  url: string,
  destDir: string,
  fileName: string,
  win: BrowserWindow,
  downloadId: string,
): Promise<string> {
  const { res, finalUrl } = await openDownloadResponse(url)
  if (finalUrl.includes('login') || finalUrl.includes('id.tsinghua')) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  const total = getHeaderNumber(res.headers['content-length'])
  const finalFileName = sanitizeFilename(
    withResponseExtension(fileName, getHeaderString(res.headers['content-disposition'])),
  )

  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, finalFileName)
  const writer = fs.createWriteStream(destPath)

  let loaded = 0

  return new Promise((resolve, reject) => {
    function fail(err: unknown): void {
      writer.close()
      try { fs.unlinkSync(destPath) } catch { /* ignore */ }
      if (win && !win.isDestroyed()) {
        win.webContents.send('files:progress', {
          id: downloadId, fileName: finalFileName,
          loaded, total, status: 'error' as const,
        })
      }
      reject(err)
    }

    res.on('data', (chunk: Buffer) => {
      loaded += chunk.byteLength
      if (win && !win.isDestroyed()) {
        win.webContents.send('files:progress', {
          fileName: finalFileName,
          id: downloadId,
          loaded,
          total: total || loaded,
          status: 'downloading' as const,
        })
      }
    })
    res.on('error', fail)
    writer.on('error', fail)
    writer.on('finish', () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('files:progress', {
          fileName: finalFileName,
          id: downloadId,
          loaded: total || loaded,
          total: total || loaded,
          status: 'completed' as const,
          destPath,
        })
      }
      resolve(destPath)
    })

    res.pipe(writer)
  })
}
