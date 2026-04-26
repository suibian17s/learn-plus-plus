import { ipcMain } from 'electron'
import { withAuth } from '../services/learn'
import { downloadUrlToBufferWithMeta } from '../services/downloader'
import * as cheerio from 'cheerio'

const LEARN_BASE_URL = 'https://learn.tsinghua.edu.cn'

function toAbsoluteLearnUrl(raw: string): string {
  return new URL(raw, LEARN_BASE_URL).href
}

function mimeFromUrl(url: string, contentType: string): string {
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  if (normalized.startsWith('image/')) return normalized

  const ext = new URL(url).pathname.split('.').pop()?.toLowerCase()
  const byExt: Record<string, string> = {
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }
  return ext ? byExt[ext] || 'image/png' : 'image/png'
}

async function inlineNoticeImages(html: string): Promise<string> {
  if (!html || !/<img[\s>]/i.test(html)) return html

  const $ = cheerio.load(html, { decodeEntities: false })
  const images = $('img[src]').toArray()

  await Promise.all(images.map(async (el) => {
    const src = ($(el).attr('src') || '').trim()
    if (!src || src.startsWith('data:')) return

    try {
      const absoluteUrl = toAbsoluteLearnUrl(src)
      const { buffer, contentType } = await downloadUrlToBufferWithMeta(absoluteUrl)
      const mime = mimeFromUrl(absoluteUrl, contentType)
      $(el).attr('src', `data:${mime};base64,${buffer.toString('base64')}`)
      $(el).attr('data-original-src', absoluteUrl)
    } catch {
      $(el).attr('data-load-failed', 'true')
    }
  }))

  return $('body').html() || $.root().html() || html
}

function mapAttachment(attachment: any): any {
  if (!attachment) return null
  return {
    id: attachment.id || '',
    name: attachment.name || '',
    downloadUrl: attachment.downloadUrl || '',
    previewUrl: attachment.previewUrl || '',
    size: attachment.size || '',
  }
}

export function registerNotificationsIpc(): void {
  ipcMain.handle('notice:list', async (_e, courseId: string) => {
    return withAuth(async (h) => {
      const list = await h.getNotificationList(courseId)
      return Promise.all(list.map(async (n: any) => {
        const htmlContent = await inlineNoticeImages(n.content || '')
        return {
          id: n.id,
          title: n.title || '',
          content: n.content || '',
          htmlContent,
          attachment: mapAttachment(n.attachment),
          publishTime: typeof n.publishTime === 'object' ? (n.publishTime as Date).toISOString() : String(n.publishTime),
          publisher: n.publisher || '',
          courseId,
        }
      }))
    })
  })
}
