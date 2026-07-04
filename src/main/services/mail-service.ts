import {
  connectMail, disconnectMail, fetchMailList, fetchMailBody, sendMail as imapSendMail,
  testMailConnection as _testMailConnection, isMailConnected, setImapStarred, deleteImapMail,
  searchMailImap, checkNewMailCount,
} from './mail-imap'
import type { MailConfig } from './mail-imap'
import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { loadApiKey, clearApiKey } from './secret-store'
import { indexEmails } from './search-index'

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
  htmlBody?: string
  attachments: { name: string; url: string }[]
}

// B10: 邮件按 username 隔离缓存 —— 多账号切换时不串扰
const folderListCache: Map<string, Map<string, { mails: MailItem[]; cachedAt: number }>> = new Map()
const detailCache: Map<string, Map<string, { mail: MailDetail; cachedAt: number }>> = new Map()
let cacheOwner: string | null = null

function ensureCacheOwner(username: string): void {
  if (cacheOwner === username) return
  // 切换账号：丢弃旧账号缓存，重建空 Map
  folderListCache.clear()
  detailCache.clear()
  cacheOwner = username
}

function getFolderCache(folder: string): { mails: MailItem[]; cachedAt: number } | undefined {
  return cacheOwner ? folderListCache.get(cacheOwner)?.get(folder) : undefined
}

function setFolderCache(folder: string, value: { mails: MailItem[]; cachedAt: number }): void {
  if (!cacheOwner) return
  let inner = folderListCache.get(cacheOwner)
  if (!inner) { inner = new Map(); folderListCache.set(cacheOwner, inner) }
  inner.set(folder, value)
}

function getDetailCacheEntry(mailId: string): { mail: MailDetail; cachedAt: number } | undefined {
  return cacheOwner ? detailCache.get(cacheOwner)?.get(mailId) : undefined
}

function setDetailCache(mailId: string, value: { mail: MailDetail; cachedAt: number }): void {
  if (!cacheOwner) return
  let inner = detailCache.get(cacheOwner)
  if (!inner) { inner = new Map(); detailCache.set(cacheOwner, inner) }
  inner.set(mailId, value)
}

function findCachedMail(mailId: string): MailItem | undefined {
  if (!cacheOwner) return undefined
  const inner = folderListCache.get(cacheOwner)
  if (!inner) return undefined
  for (const entry of inner.values()) {
    const hit = entry.mails.find((m) => m.id === mailId)
    if (hit) return hit
  }
  return undefined
}

// ── Read mail config from settings ──

function getMailConfigFromSettings(): MailConfig | null {
  try {
    const raw = fs.readFileSync(settingsFile, 'utf-8')
    const s = JSON.parse(raw)
    if (s.mailMode === 'imap' && s.mailUsername && s.mailImapHost) {
      return {
        imapHost: s.mailImapHost,
        imapPort: s.mailImapPort || 993,
        imapTls: s.mailImapTls !== false,
        smtpHost: s.mailSmtpHost || s.mailImapHost,
        smtpPort: s.mailSmtpPort || 465,
        smtpTls: s.mailSmtpTls !== false,
        username: s.mailUsername,
        password: loadApiKey('mail') || '',
      }
    }
  } catch { /* ignore */ }
  return null
}

function withSavedPassword(config: MailConfig): MailConfig {
  const saved = loadApiKey('mail') || ''
  return { ...config, password: config.password || saved }
}

export async function loginMailImap(config: MailConfig): Promise<boolean> {
  const ok = await connectMail(withSavedPassword(config))
  if (ok) ensureCacheOwner(config.username)
  return ok
}

// ── B20: 连接管理 —— 断线/重启后用已保存配置自动重连（in-flight 去重）──

let connectingPromise: Promise<boolean> | null = null

export async function ensureMailConnection(): Promise<boolean> {
  if (isMailConnected()) return true
  if (!connectingPromise) {
    connectingPromise = (async () => {
      const config = getMailConfigFromSettings()
      if (!config || !config.password) return false
      return loginMailImap(config)
    })().finally(() => { connectingPromise = null })
  }
  return connectingPromise
}

export async function testMailConnection(config: MailConfig): Promise<boolean> {
  return _testMailConnection(withSavedPassword(config))
}

export function isMailLoggedIn(): boolean {
  return isMailConnected()
}

function normalizePlain(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function decodeEntitiesLight(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlToPlainLines(html: string): string[] {
  const text = decodeEntitiesLight(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')

  return text
    .split('\n')
    .map((line) => normalizePlain(line))
    .filter(Boolean)
}

function cleanMailBodyHtml(rawHtml: string, fallback = ''): string {
  const noisePatterns = [
    /^(收件箱|草稿箱|已发送|已删除|写信|通讯录|刷新|退出|打开原站)$/i,
    /^(发件人|收件人|主题|日期|时间|回复|转发|删除|星标|全部设为已读)$/i,
    /^https?:\/\//i,
    /^(Inbox|Sent|Draft|Trash|Compose|Reply|Forward|Delete)$/i,
  ]
  const lines = htmlToPlainLines(rawHtml)
    .filter((line) => line.length > 1)
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))
    .filter((line, index, arr) => arr.indexOf(line) === index)

  const usableLines = lines.length ? lines : htmlToPlainLines(fallback)
  if (!usableLines.length) return ''
  return usableLines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

function parseMailTimestamp(raw: string): number {
  const value = normalizePlain(raw)
  if (!value) return 0

  const now = new Date()
  const time = value.match(/(\d{1,2}):(\d{2})/)
  if (/今天/.test(value)) {
    const d = new Date(now)
    if (time) d.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return d.getTime()
  }
  if (/昨天/.test(value)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    if (time) d.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return d.getTime()
  }
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const d = new Date(now)
    d.setHours(Number(time?.[1] || 0), Number(time?.[2] || 0), 0, 0)
    return d.getTime()
  }

  let normalized = value
    .replace(/[年月.]/g, '-')
    .replace(/日/g, ' ')
    .replace(/\//g, '-')
  if (/^\d{1,2}-\d{1,2}/.test(normalized)) normalized = `${now.getFullYear()}-${normalized}`
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function sortMailItems(mails: MailItem[]): MailItem[] {
  return [...mails].sort((a, b) => parseMailTimestamp(b.date) - parseMailTimestamp(a.date))
}

const LIST_CACHE_TTL = 60 * 1000
const DETAIL_CACHE_TTL = 30 * 60 * 1000

// A1: 把已缓存的各文件夹邮件合并建一次倒排索引（全局搜索 / Tutor search_emails 命中邮件）
function reindexAllMail(): void {
  if (!cacheOwner) return
  const inner = folderListCache.get(cacheOwner)
  if (!inner) return
  const all: { id: string; subject: string; from: string; preview?: string }[] = []
  const seen = new Set<string>()
  for (const entry of inner.values()) {
    for (const m of entry.mails) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      all.push({ id: m.id, subject: m.subject, from: m.from, preview: m.preview })
    }
  }
  if (all.length) indexEmails(all)
}

async function getMailListUnified(folder: string, force = false): Promise<{ mails: MailItem[]; total: number }> {
  // 命中新鲜缓存直接返回（切换文件夹 / 重进页面秒开）；刷新按钮传 force 绕过
  const cached = getFolderCache(folder)
  if (!force && cached && Date.now() - cached.cachedAt < LIST_CACHE_TTL) {
    return { mails: cached.mails, total: cached.mails.length }
  }
  await ensureMailConnection()
  const { mails: fetched, incremental } = await fetchMailList(folder)
  let mails: MailItem[]
  if (incremental && cached) {
    // B10: 增量同步 —— 把新邮件并入旧缓存（按 id 去重），不丢历史邮件
    const seenIds = new Set(cached.mails.map((m) => m.id))
    const merged = [...cached.mails]
    for (const m of fetched) {
      if (!seenIds.has(m.id)) { seenIds.add(m.id); merged.push(m) }
    }
    mails = sortMailItems(merged)
  } else {
    mails = sortMailItems(fetched)
  }
  setFolderCache(folder, { mails, cachedAt: Date.now() })
  reindexAllMail()
  return { mails, total: mails.length }
}

async function getMailDetailUnified(mailId: string): Promise<MailDetail | null> {
  const cachedDetail = getDetailCacheEntry(mailId)
  if (cachedDetail && Date.now() - cachedDetail.cachedAt < DETAIL_CACHE_TTL) {
    return cachedDetail.mail
  }
  await ensureMailConnection()
  const { body, htmlBody, attachments } = await fetchMailBody(mailId)
  const cached = findCachedMail(mailId)
  const detail: MailDetail = {
    id: mailId,
    subject: cached?.subject || '',
    from: cached?.from || '',
    to: cached?.to || '',
    date: cached?.date || '',
    preview: '',
    starred: cached?.starred || false,
    read: true,
    body: cleanMailBodyHtml(body, cached?.preview || ''),
    htmlBody: htmlBody || undefined,
    attachments,
  }
  setDetailCache(mailId, { mail: detail, cachedAt: Date.now() })
  return detail
}

// ── Exported unified API (used by IPC handlers) ──
export async function getMailList(folder: string, force = false) {
  await ensureMailConnection()
  return getMailListUnified(folder, force)
}
export async function getMailDetail(mailId: string) { return getMailDetailUnified(mailId) }
export async function composeMail(params: { to: string; subject: string; body: string }) {
  await ensureMailConnection()
  return imapSendMail(params)
}
export async function searchMail(query: string, folder: string = 'inbox'): Promise<MailItem[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  await ensureMailConnection()
  // Level 1: local instant filter
  const local = (getFolderCache(folder)?.mails || []).filter(m =>
    [m.subject, m.from, m.to, m.preview].some(f => (f || '').toLowerCase().includes(q))
  ).slice(0, 50)
  // Level 2: server-side search
  const server = await searchMailImap(query, folder)
  // Merge, deduplicate by id
  const seen = new Set(local.map(m => m.id))
  const merged = [...local]
  for (const m of server) {
    if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
  }
  return merged
}
export async function checkMailStatus(): Promise<{ loggedIn: boolean; unreadCount: number; latestId: string; total: number }> {
  // B20: 状态检查即触发自动连接 —— 已存配置+密码时，重启/断线后无需手动重新登录
  const loggedIn = await ensureMailConnection()
  if (!loggedIn) return { loggedIn: false, unreadCount: 0, latestId: '', total: 0 }
  try {
    // B10: lightweight poll — use IMAP UNSEEN search for unread count,
    // use cache for latestId/total (avoids fetching all 300 headers every 2 min)
    const unreadCount = await checkNewMailCount('inbox')
    const mails = getFolderCache('inbox')?.mails || []
    return {
      loggedIn: true,
      unreadCount,
      latestId: mails[0]?.id || '',
      total: mails.length,
    }
  } catch {
    return { loggedIn, unreadCount: 0, latestId: '', total: 0 }
  }
}

export async function setMailStarred(mailId: string, starred: boolean): Promise<{ ok: boolean }> {
  await ensureMailConnection()
  const result = await setImapStarred(mailId, starred)
  if (result.ok) {
    // 就地更新缓存而不是作废（保持切页秒开）
    if (cacheOwner) {
      const inner = folderListCache.get(cacheOwner)
      if (inner) {
        for (const entry of inner.values()) {
          const hit = entry.mails.find((m) => m.id === mailId)
          if (hit) hit.starred = starred
        }
      }
      const detailMap = detailCache.get(cacheOwner)
      const cachedDetail = detailMap?.get(mailId)
      if (cachedDetail) cachedDetail.mail.starred = starred
    }
  }
  return result
}

export async function deleteMail(mailId: string, currentFolder?: string): Promise<{ ok: boolean; error?: string }> {
  await ensureMailConnection()
  if (cacheOwner) detailCache.get(cacheOwner)?.delete(mailId)
  const result = await deleteImapMail(mailId, currentFolder)
  if (result.ok && cacheOwner) {
    // 从来源文件夹缓存移除；回收站缓存作废（有新邮件进入）
    const inner = folderListCache.get(cacheOwner)
    if (inner) {
      if (currentFolder) {
        const entry = inner.get(currentFolder)
        if (entry) entry.mails = entry.mails.filter((m) => m.id !== mailId)
      }
      inner.delete('trash')
    }
    reindexAllMail()
  }
  return result
}

export function logoutMail(): void {
  folderListCache.clear()
  detailCache.clear()
  cacheOwner = null
  // 断开 IMAP 并清除已保存的邮箱密码 —— 否则 ensureMailConnection 会在下次状态检查时自动重连，"退出"失效
  disconnectMail()
  try { clearApiKey('mail') } catch { /* ignore */ }
}