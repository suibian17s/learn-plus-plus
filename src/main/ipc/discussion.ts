import { BrowserWindow, ipcMain, shell } from 'electron'
import { withAuth, apiFetch, syncApiCookiesToDefaultSession } from '../services/learn'
import * as cheerio from 'cheerio'

const LEARN_BASE_URL = 'https://learn.tsinghua.edu.cn'

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function isLayoutText(text: string): boolean {
  const compact = cleanText(text)
  if (!compact) return true

  const navWords = ['课程首页', '本学期课程仪表板', '课程公告', '课程信息', '课程文件', '课程作业', '课程讨论', '课程答疑', '课程问卷']
  const navHits = navWords.filter((word) => compact.includes(word)).length
  return navHits >= 4
}

function extractContentHtml($: cheerio.CheerioAPI): string {
  const selectors = [
    '.bbs_tltb_kk_content',
    '.bbs_tltb_kk_neirong',
    '.tl_content',
    '.topic-content',
    '.discussion-content',
    '.post-content',
    '.article-content',
    '.view-content',
    '#topicContent',
    '#contentText',
    '[id*="content"]',
    '[class*="content"]',
    '[id*="nr"]',
    '[class*="nr"]',
  ]

  for (const selector of selectors) {
    const candidates = $(selector).toArray()
    for (const el of candidates) {
      const $el = $(el).clone()
      $el.find('script, style, nav, header, footer, form, select, option').remove()
      const text = $el.text()
      if (cleanText(text).length > 0 && !isLayoutText(text)) {
        return $el.html()?.trim() || ''
      }
    }
  }

  let best = ''
  let bestScore = 0
  $('div, td, article, section').each((_, el) => {
    const attribs = (el as any).attribs || {}
    const marker = `${attribs.id || ''} ${attribs.class || ''}`
    if (!/(content|nr|body|detail|message|article|bbs|reply|post|tl)/i.test(marker)) return

    const $el = $(el).clone()
    $el.find('script, style, nav, header, footer, form, select, option').remove()
    const text = $el.text()
    const score = cleanText(text).length
    if (score > bestScore && score < 20000 && !isLayoutText(text)) {
      bestScore = score
      best = $el.html()?.trim() || ''
    }
  })

  return best
}

function toAbsoluteLearnUrl(raw: string): string {
  return new URL(raw, LEARN_BASE_URL).href
}

export function registerDiscussionIpc(): void {
  ipcMain.handle('disc:list', async (_e, courseId: string) => {
    return withAuth(async (h) => {
      const list = await h.getDiscussionList(courseId)
      return list.map((d: any) => ({
        id: d.id,
        title: d.title || '',
        url: d.url || '',
        boardId: d.boardId || '',
        author: d.publisherName || '',
        publishTime: d.publishTime instanceof Date ? d.publishTime.toISOString() : String(d.publishTime),
        lastReplierName: d.lastReplierName || '',
        lastReplyTime: d.lastReplyTime instanceof Date ? d.lastReplyTime.toISOString() : String(d.lastReplyTime),
        replyCount: d.replyCount || 0,
        visitCount: d.visitCount || 0,
        courseId,
      }))
    })
  })

  ipcMain.handle('disc:detail', async (_e, url: string) => {
    try {
      return await withAuth(async () => {
        const resp = await apiFetch(url, { redirect: 'manual' } as any)
        if (!resp.ok) return { error: `HTTP ${resp.status}` }
        const html = await resp.text()
        const $ = cheerio.load(html)

        // Extract original post
        const title = $('.bbs_tltb_kk_title h4').text().trim() || $('h4').first().text().trim()
        const author = $('.bbs_tltb_kk_title .author span').first().text().trim()
          || $('.author').first().text().trim()
        const time = $('.bbs_tltb_kk_title .time').first().text().trim()
          || $('.time').first().text().trim()
        const content = extractContentHtml($)

        // Extract replies
        const replies: { author: string; time: string; content: string }[] = []
        $('.bbs_tltb_kk_reply_item, .reply-item, tr').each((_, el) => {
          const $el = $(el)
          const replyAuthor = $el.find('.reply-author, .author, td:nth-child(1)').first().text().trim()
          const replyTime = $el.find('.reply-time, .time, td:nth-child(2)').first().text().trim()
          const replyContent = $el.find('.reply-content, .content, td:nth-child(3)').html()?.trim()
          if (replyAuthor && !replyAuthor.includes('发言人')) {
            replies.push({
              author: replyAuthor,
              time: replyTime || '',
              content: replyContent || '',
            })
          }
        })

        return { title, author, time, content, replies }
      })
    } catch (err: any) {
      return { error: err?.message || String(err) }
    }
  })

  ipcMain.handle('disc:openWindow', async (_e, url: string) => {
    return withAuth(async () => {
      const targetUrl = toAbsoluteLearnUrl(url)
      await syncApiCookiesToDefaultSession()

      const win = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 960,
        minHeight: 640,
        title: 'learn++ - 讨论区',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      win.setMenu(null)
      win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
        try {
          const next = new URL(nextUrl)
          if (next.hostname.endsWith('tsinghua.edu.cn')) {
            win.loadURL(nextUrl)
          } else {
            shell.openExternal(nextUrl)
          }
        } catch {
          shell.openExternal(nextUrl)
        }
        return { action: 'deny' }
      })

      await win.loadURL(targetUrl)
      return { ok: true }
    })
  })

  ipcMain.handle('answering:list', async (_e, courseId: string) => {
    return withAuth(async (h) => {
      const list = await h.getAnsweredQuestionList(courseId)
      return list.map((q: any) => ({
        id: q.id,
        question: q.title || q.question || '',
        url: (q as any).url || '',
        author: q.publisherName || '',
        askTime: q.publishTime instanceof Date ? q.publishTime.toISOString() : String(q.publishTime),
        answerTime: q.lastReplyTime instanceof Date ? q.lastReplyTime.toISOString() : String(q.lastReplyTime),
        replyCount: q.replyCount || 0,
        courseId,
      }))
    })
  })

  ipcMain.handle('answering:detail', async (_e, url: string) => {
    try {
      return await withAuth(async () => {
        const resp = await apiFetch(url, { redirect: 'manual' } as any)
        if (!resp.ok) return { error: `HTTP ${resp.status}` }
        const html = await resp.text()
        const $ = cheerio.load(html)

        const title = $('h4').first().text().trim()
        const author = $('.author span').first().text().trim()
        const time = $('.time').first().text().trim()
        const content = $('.dy_content, .content, .question-content').first().html()?.trim() || ''

        // Answer (teacher's reply)
        let answer = ''
        let answerAuthor = ''
        let answerTime = ''
        $('.dy_answer, .answer-item').first().find('.content, .answer-content').each((_, el) => {
          answer = $(el).html()?.trim() || $(el).text().trim()
        })
        answerAuthor = $('.dy_answer .author, .answer-item .author').first().text().trim()
        answerTime = $('.dy_answer .time, .answer-item .time').first().text().trim()

        return { title, author, time, content, answer, answerAuthor, answerTime }
      })
    } catch (err: any) {
      return { error: err?.message || String(err) }
    }
  })

  ipcMain.handle('questionnaire:list', async (_e, _courseId: string) => {
    return []
  })

  ipcMain.handle('open:external', (_e, url: string) => {
    shell.openExternal(url)
  })
}
