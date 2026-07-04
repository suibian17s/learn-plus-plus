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
      // 连接建立 / 头部响应超时（DNS+TCP+TLS+服务端响应头）
      timeout: 30000,
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

      // 已收到响应头：清除 request 超时，改在 socket 上设闲置超时
      // —— 防止连接建立后数据流 hang（服务器静默不发包）时永不失败
      req.setTimeout(0)
      const socket = res.socket
      if (socket) {
        socket.setKeepAlive(true)
        socket.setTimeout(120000, () => {
          req.destroy(new Error('下载连接闲置超时（120s 无数据）'))
        })
        socket.once('data', () => socket.setTimeout(0))
      }

      resolve({ res, finalUrl: url })
    })

    req.on('error', reject)
    // 连接/响应头阶段超时（request timeout 触发 'timeout' 事件，需手动 destroy）
    req.on('timeout', () => {
      req.destroy(new Error('下载请求超时（30s 无响应）'))
    })
    req.end()
  })
}

export async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const { res, finalUrl } = await openDownloadResponse(url)
  if (isLoginUrl(finalUrl)) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  const total = getHeaderNumber(res.headers['content-length'])
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let loaded = 0
    res.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); loaded += chunk.byteLength })
    res.on('end', () => {
      // 完整性校验：Content-Length 存在但收到字节偏少 = 传输被截断
      if (total > 0 && loaded < total) {
        reject(new Error(`下载不完整（${loaded}/${total} 字节），可能网络中断，请重试`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    res.on('error', reject)
  })
}

export async function downloadUrlToBufferWithMeta(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const { res, finalUrl } = await openDownloadResponse(url)
  if (isLoginUrl(finalUrl)) {
    throw new AuthError('Cookie expired, re-authenticating')
  }

  const total = getHeaderNumber(res.headers['content-length'])
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let loaded = 0
    res.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); loaded += chunk.byteLength })
    res.on('end', () => {
      if (total > 0 && loaded < total) {
        reject(new Error(`下载不完整（${loaded}/${total} 字节），可能网络中断，请重试`))
        return
      }
      resolve({
        buffer: Buffer.concat(chunks),
        contentType: getHeaderString(res.headers['content-type']),
      })
    })
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
      // 完整性校验：Content-Length 存在但写入字节偏少 = 传输被截断，删除坏文件并报错
      if (total > 0 && loaded < total) {
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        if (win && !win.isDestroyed()) {
          win.webContents.send('files:progress', {
            id: downloadId, fileName: finalFileName,
            loaded, total, status: 'error' as const,
          })
        }
        reject(new Error(`下载不完整（${loaded}/${total} 字节），可能网络中断，请重试`))
        return
      }
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
