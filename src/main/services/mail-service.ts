import { BrowserWindow, session } from 'electron'

const MAIL_BASE = 'https://mails.tsinghua.edu.cn'

export interface MailItem {
  id: string
  subject: string
  from: string
  to: string
  date: string
  preview: string
  starred: boolean
  read: boolean
}

export interface MailDetail extends MailItem {
  body: string
  attachments: { name: string; url: string }[]
}

let mailCookies: string | null = null
let listCache: { folder: string; mails: MailItem[]; cachedAt: number } | null = null
const detailCache: Map<string, { mail: MailDetail; cachedAt: number }> = new Map()
const LIST_CACHE_MS = 5 * 60 * 1000
const DETAIL_CACHE_MS = 30 * 60 * 1000

export async function loginMail(): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      title: '登录清华邮箱',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    win.loadURL(MAIL_BASE)

    let resolved = false
    const checkInterval = setInterval(async () => {
      if (resolved) return
      try {
        const cookies = await session.defaultSession.cookies.get({ url: MAIL_BASE })
        if (cookies.length > 0) {
          resolved = true
          clearInterval(checkInterval)
          mailCookies = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
          win.close()
          resolve(true)
        }
      } catch {
        /* keep polling */
      }
    }, 2000)

    win.on('closed', () => {
      clearInterval(checkInterval)
      if (!resolved) {
        resolved = true
        resolve(mailCookies != null)
      }
    })

    setTimeout(() => {
      clearInterval(checkInterval)
      if (!resolved) {
        resolved = true
        win.close()
        resolve(false)
      }
    }, 5 * 60 * 1000)
  })
}

export function isMailLoggedIn(): boolean {
  return mailCookies != null
}

export async function getMailList(folder: string): Promise<{ mails: MailItem[]; total: number }> {
  if (!mailCookies) throw new Error('邮箱未登录，请先登录清华邮箱')
  if (listCache && listCache.folder === folder && Date.now() - listCache.cachedAt < LIST_CACHE_MS) {
    return { mails: listCache.mails, total: listCache.mails.length }
  }
  // Fetch mail list page from webmail
  const url = `${MAIL_BASE}/?folder=${encodeURIComponent(folder)}`
  const html = await fetchWithCookies(url)
  const mails = parseMailListHtml(html)
  listCache = { folder, mails, cachedAt: Date.now() }
  return { mails, total: mails.length }
}

export async function getMailDetail(mailId: string): Promise<MailDetail | null> {
  if (!mailCookies) return null
  const cached = detailCache.get(mailId)
  if (cached && Date.now() - cached.cachedAt < DETAIL_CACHE_MS) return cached.mail
  const url = `${MAIL_BASE}/?read=${encodeURIComponent(mailId)}`
  const html = await fetchWithCookies(url)
  const mail = parseMailDetailHtml(html, mailId)
  if (mail) detailCache.set(mailId, { mail, cachedAt: Date.now() })
  return mail
}

export async function setMailStarred(mailId: string, starred: boolean): Promise<{ ok: boolean }> {
  if (!mailCookies) return { ok: false }
  await postWithCookies(`${MAIL_BASE}/?star=${encodeURIComponent(mailId)}`, { starred: String(starred) })
  listCache = null
  return { ok: true }
}

export async function deleteMail(mailId: string): Promise<{ ok: boolean }> {
  if (!mailCookies) return { ok: false }
  await postWithCookies(`${MAIL_BASE}/?delete=${encodeURIComponent(mailId)}`, {})
  listCache = null
  detailCache.delete(mailId)
  return { ok: true }
}

async function fetchWithCookies(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { Cookie: mailCookies! } })
  return resp.text()
}

async function postWithCookies(url: string, body: Record<string, string>): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Cookie: mailCookies!, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  return resp.text()
}

// HTML parsing stubs — actual selectors depend on mails.tsinghua.edu.cn DOM structure
function parseMailListHtml(html: string): MailItem[] {
  // Extract mail items from webmail HTML. Try common patterns:
  // Look for table rows with mail data, or div.mail-item, or li.mail-row
  const items: MailItem[] = []
  // Basic regex-based extraction for common webmail patterns
  const rowPattern = /<tr[^>]*class="[^"]*mail[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi
  let match
  let id = 0
  while ((match = rowPattern.exec(html)) !== null) {
    const row = match[1]
    const subjectMatch = row.match(/<a[^>]*>([^<]+)<\/a>/)
    const fromMatch = row.match(/<td[^>]*>\s*([^<\s][^<]*?)\s*<\/td>/)
    const dateMatch = row.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}:\d{2})/)
    items.push({
      id: `mail-${id++}`,
      subject: subjectMatch?.[1]?.trim() || '(无主题)',
      from: fromMatch?.[1]?.trim() || '',
      to: '',
      date: dateMatch?.[1] || '',
      preview: '',
      starred: row.includes('star') || row.includes('★'),
      read: !row.includes('unread') && !row.includes('bold'),
    })
  }
  return items
}

function parseMailDetailHtml(html: string, id: string): MailDetail | null {
  const bodyMatch = html.match(/<div[^>]*class="[^"]*body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  return {
    id,
    subject: extractMeta(html, 'subject') || '',
    from: extractMeta(html, 'from') || '',
    to: extractMeta(html, 'to') || '',
    date: extractMeta(html, 'date') || '',
    preview: '',
    starred: false,
    read: true,
    body: bodyMatch?.[1] || html,
    attachments: [],
  }
}

function extractMeta(html: string, field: string): string {
  const pattern = new RegExp(`<span[^>]*class="[^"]*${field}[^"]*"[^>]*>([^<]+)<\/span>`, 'i')
  return html.match(pattern)?.[1]?.trim() || ''
}
