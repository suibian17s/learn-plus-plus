import Imap from 'node-imap'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { mailSyncFile } from '../utils/paths'
import type { MailItem } from './mail-service'

export interface MailConfig {
  imapHost: string
  imapPort: number
  imapTls: boolean
  smtpHost: string
  smtpPort: number
  smtpTls: boolean
  username: string
  password: string
}

const MAIL_FETCH_LIMIT = 300

// ── B10: 邮件按 UID 增量同步 —— 持久化每账号每文件夹的 uidvalidity + maxUid ──
// 结构: { [username]: { [folder]: { uidvalidity: number, maxUid: number } } }
interface SyncState {
  [username: string]: {
    [folder: string]: { uidvalidity: number; maxUid: number }
  }
}

function loadSyncState(): SyncState {
  try {
    const raw = fs.readFileSync(mailSyncFile, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function saveSyncState(state: SyncState): void {
  try { fs.writeFileSync(mailSyncFile, JSON.stringify(state, null, 2), 'utf-8') } catch { /* ignore */ }
}

function readFolderSync(username: string, folder: string): { uidvalidity: number; maxUid: number } | null {
  const state = loadSyncState()
  return state[username]?.[folder] || null
}

function writeFolderSync(username: string, folder: string, uidvalidity: number, maxUid: number): void {
  const state = loadSyncState()
  if (!state[username]) state[username] = {}
  state[username][folder] = { uidvalidity, maxUid }
  saveSyncState(state)
}

function clearFolderSync(username: string, folder?: string): void {
  const state = loadSyncState()
  if (!state[username]) return
  if (folder) delete state[username][folder]
  else delete state[username]
  saveSyncState(state)
}

export function clearAllMailSync(): void {
  try { fs.rmSync(mailSyncFile, { force: true }) } catch { /* ignore */ }
}

const MAIL_TEMP_DIR = path.join(app.getPath('temp'), 'learnpp-mail-attachments')

function sanitizeAttachmentName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let activeConfig: MailConfig | null = null
let imapClient: Imap | null = null
let smtpTransport: nodemailer.Transporter | null = null
let cachedMailboxNames: string[] | null = null

const FOLDER_CANDIDATES: Record<string, string[]> = {
  inbox: ['INBOX', 'Inbox', '收件箱'],
  sent: ['Sent', 'Sent Messages', 'Sent Mail', '已发送', '已发送邮件', '发件箱', '发件箱邮件'],
  drafts: ['Drafts', 'Draft', '草稿箱', '草稿'],
  trash: ['Trash', 'Deleted Messages', 'Deleted Items', 'Deleted', '已删除', '已删除邮件', '废纸篓', '垃圾箱'],
}

function normalizeMailboxName(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function flattenBoxes(boxes: any, prefix = ''): string[] {
  const names: string[] = []
  for (const [name, box] of Object.entries(boxes || {})) {
    const data = box as any
    const delimiter = data.delimiter || '/'
    const fullName = prefix ? `${prefix}${delimiter}${name}` : name
    names.push(fullName)
    names.push(...flattenBoxes(data.children, fullName))
  }
  return names
}

function listMailboxes(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))
    if (cachedMailboxNames) return resolve(cachedMailboxNames)
    ;(imapClient as any).getBoxes((err: Error, boxes: any) => {
      if (err) return reject(err)
      cachedMailboxNames = flattenBoxes(boxes)
      resolve(cachedMailboxNames)
    })
  })
}

async function resolveMailboxName(folder: string): Promise<string> {
  if (folder === 'inbox') return 'INBOX'
  const candidates = FOLDER_CANDIDATES[folder] || [folder]
  const mailboxes = await listMailboxes()
  const normalizedCandidates = candidates.map(normalizeMailboxName)

  const exact = mailboxes.find((name) => normalizedCandidates.includes(normalizeMailboxName(name)))
  if (exact) return exact

  const byLastSegment = mailboxes.find((name) => {
    const last = name.split(/[\\/]/).pop() || name
    return normalizedCandidates.includes(normalizeMailboxName(last))
  })
  if (byLastSegment) return byLastSegment

  const byContains = mailboxes.find((name) => {
    const normalized = normalizeMailboxName(name)
    return normalizedCandidates.some((candidate) => normalized.includes(candidate))
  })
  return byContains || candidates[0]
}

function openFolder(folder: string): Promise<any> {
  return new Promise(async (resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))
    try {
      const boxName = await resolveMailboxName(folder)
      imapClient.openBox(boxName, false, (err, box) => {
        if (err) return reject(err)
        resolve(box)
      })
    } catch (err: any) {
      reject(err)
    }
  })
}

function formatMailDate(value?: Date, fallback = ''): string {
  if (!value || Number.isNaN(value.getTime())) return fallback
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function addressText(value: any): string {
  if (!value) return ''
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(', ')
  if (value.text) return String(value.text)
  if (Array.isArray(value.value)) {
    return value.value
      .map((item: any) => item.name ? `${item.name} <${item.address || ''}>` : item.address)
      .filter(Boolean)
      .join(', ')
  }
  return String(value)
}

function parseHeaderMessage(header: string, flags: string[], uid: number): Promise<MailItem> {
  return simpleParser(Buffer.from(header)).then((parsed) => ({
    id: String(uid),
    subject: parsed.subject || '(无主题)',
    from: addressText(parsed.from),
    to: addressText(parsed.to),
    date: formatMailDate(parsed.date, ''),
    preview: '',
    starred: flags.includes('\\Flagged'),
    read: flags.includes('\\Seen'),
  }))
}

function sortByDateDesc(items: MailItem[]): MailItem[] {
  return [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

export function connectMail(config: MailConfig): Promise<boolean> {
  return new Promise((resolve) => {
    disconnectMail()

    const client = new Imap({
      user: config.username,
      password: config.password,
      host: config.imapHost,
      port: config.imapPort,
      tls: config.imapTls,
      // TLS cert verification enabled — mails.tsinghua.edu.cn uses valid Let's Encrypt
      connTimeout: 15000,
      authTimeout: 15000,
      // Coremail 对 IDLE 支持不可靠，用 NOOP 心跳保活，降低被服务器踢掉的概率
      keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true },
    } as any)

    client.once('ready', () => {
      imapClient = client
      activeConfig = config
      cachedMailboxNames = null
      // 断线感知：连接死亡后清空引用，后续操作由 ensureMailConnection 自动重连
      const markDead = () => {
        if (imapClient === client) {
          imapClient = null
          smtpTransport = null
          cachedMailboxNames = null
        }
      }
      ;(client as any).on('close', markDead)
      ;(client as any).on('end', markDead)
      ;(client as any).on('error', markDead)
      resolve(true)
    })

    client.once('error', () => {
      try { client.end() } catch { /* ignore */ }
      if (imapClient === client) imapClient = null
      resolve(false)
    })

    client.connect()
  })
}

export function disconnectMail(): void {
  try { imapClient?.end() } catch { /* ignore */ }
  imapClient = null
  smtpTransport = null
  activeConfig = null
  cachedMailboxNames = null
}

/** B25: 启动时清空读信落盘的附件临时目录（附件语义为"读信期间可另存"，跨会话无须保留） */
export function cleanupMailTemp(): void {
  try { fs.rmSync(MAIL_TEMP_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
}

export function isMailConnected(): boolean {
  return imapClient !== null && imapClient.state === 'authenticated'
}

export interface MailListResult {
  mails: MailItem[]
  incremental: boolean
}

export function fetchMailList(folder: string): Promise<MailListResult> {
  return new Promise(async (resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))

    try {
      const box = await openFolder(folder)
      const total = box.messages.total
      if (total === 0) return resolve({ mails: [], incremental: false })

      const uidvalidity: number = (box as any).uidvalidity || 0
      const uidnext: number = (box as any).uidnext || 0
      const username = activeConfig?.username || ''
      const prev = username ? readFolderSync(username, folder) : null

      // B10: 若有上次同步状态且 uidvalidity 未变，只拉 uid > maxUid 的新邮件（增量）
      // 否则回退到按序号拉最后 MAIL_FETCH_LIMIT 封（全量初次拉取 / 邮箱被重排）
      let fetcher: any
      let isIncremental = false
      if (prev && prev.uidvalidity === uidvalidity && prev.maxUid > 0 && uidnext > prev.maxUid + 1) {
        // 有新邮件：按 UID 拉 (prev.maxUid+1):(uidnext-1)
        fetcher = (imapClient as any).uid.fetch(`${prev.maxUid + 1}:${uidnext - 1}`, {
          bodies: 'HEADER', struct: false,
        })
        isIncremental = true
      } else if (prev && prev.uidvalidity === uidvalidity && prev.maxUid > 0 && uidnext <= prev.maxUid + 1) {
        // 无新邮件：直接 resolve，service 层用缓存
        return resolve({ mails: [], incremental: true })
      } else {
        const from = Math.max(1, total - MAIL_FETCH_LIMIT + 1)
        fetcher = imapClient.seq.fetch(`${from}:${total}`, { bodies: 'HEADER', struct: false })
      }

      const items: MailItem[] = []
      const parsing: Promise<void>[] = []
      let settled = false
      let maxUidSeen = 0

      fetcher.on('message', (msg: any) => {
        let header = ''
        let uid = 0
        let flags: string[] = []

        msg.on('body', (stream: any) => {
          stream.on('data', (chunk: Buffer) => { header += chunk.toString('utf-8') })
        })

        msg.once('attributes', (attrs: any) => {
          uid = attrs.uid
          flags = attrs.flags || []
        })

        msg.once('end', () => {
          // B24: Coremail 无 MOVE 扩展，删除走 COPY+\Deleted 回退，源邮件带删除标记 —— 列表过滤掉
          if (flags.includes('\\Deleted')) return
          if (uid > maxUidSeen) maxUidSeen = uid
          parsing.push(
            parseHeaderMessage(header, flags, uid)
              .then((item) => { if (item.id !== '0') items.push(item) })
              .catch(() => { /* skip one malformed message */ }),
          )
        })
      })

      fetcher.once('error', (err: Error) => {
        settled = true
        reject(err)
      })

      fetcher.once('end', async () => {
        if (settled) return
        await Promise.all(parsing)
        // B10: 更新 sync state —— 只在 uidvalidity 稳定时记 maxUid
        if (username && uidvalidity) {
          const newMax = Math.max(maxUidSeen, prev?.maxUid || 0)
          if (newMax > 0) writeFolderSync(username, folder, uidvalidity, newMax)
        }
        resolve({ mails: sortByDateDesc(items), incremental: isIncremental })
      })
    } catch (err: any) {
      reject(err)
    }
  })
}

export function setImapStarred(uid: string, starred: boolean): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!imapClient) return resolve({ ok: false })
    const done = (err?: Error) => resolve({ ok: !err })
    const client = imapClient as any
    if (starred) client.addFlags(uid, '\\Flagged', done)
    else client.delFlags(uid, '\\Flagged', done)
  })
}

export function deleteImapMail(uid: string, currentFolder?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(async (resolve) => {
    if (!imapClient) return resolve({ ok: false, error: '邮箱未连接' })
    // If already in trash folder, permanently delete
    if (currentFolder === 'trash') {
      ;(imapClient as any).addFlags(uid, '\\Deleted', (err?: Error) => {
        if (err) return resolve({ ok: false, error: err.message })
        ;(imapClient as any).expunge((expErr?: Error) =>
          resolve({ ok: !expErr, error: expErr?.message }),
        )
      })
      return
    }
    // Otherwise move to Trash folder
    try {
      const trashBoxName = await resolveMailboxName('trash')
      ;(imapClient as any).move(uid, trashBoxName, (err?: Error) => {
        if (err) return resolve({ ok: false, error: err.message })
        // B24: Coremail 无 MOVE 扩展时 node-imap 回退为 COPY+\Deleted 但不清除源，
        // 这里 expunge 掉源文件夹中带 \Deleted 标记的邮件（真 MOVE 时无标记，无副作用）
        ;(imapClient as any).expunge(() => resolve({ ok: true }))
      })
    } catch (err: any) {
      resolve({ ok: false, error: err.message || '移动到回收站失败' })
    }
  })
}

export function fetchMailBody(uid: string): Promise<{ body: string; htmlBody: string; attachments: { name: string; url: string }[] }> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))
    const fetcher = (imapClient as any).fetch(uid, { bodies: '', markSeen: true })
    let resolved = false
    let sawMessage = false

    fetcher.on('message', (msg: any) => {
      sawMessage = true
      msg.on('body', (stream: any) => {
        simpleParser(stream, (err, parsed) => {
          if (resolved) return
          resolved = true
          if (err) return reject(err)
          const rawHtml = parsed.html || parsed.textAsHtml || ''
          const plainText = parsed.text || ''

          // Separate inline (cid/related) from regular attachments
          const inlineAtts: any[] = []
          const regularAtts: any[] = []
          for (const att of parsed.attachments || []) {
            if (att.contentId && att.related) inlineAtts.push(att)
            else regularAtts.push(att)
          }

          // Replace cid: refs with base64 data URIs
          let htmlBody = rawHtml
          for (const att of inlineAtts) {
            const cid = String(att.contentId).replace(/^<|>$/g, '')
            const ct = att.contentType || 'image/png'
            const dataUri = `data:${ct};base64,${(att.content as Buffer).toString('base64')}`
            htmlBody = htmlBody
              .replace(new RegExp(`cid:${escapeRegex(cid)}`, 'gi'), dataUri)
              .replace(new RegExp(`cid:<${escapeRegex(cid)}>`, 'gi'), dataUri)
          }

          // Write regular attachments to temp files
          fs.mkdirSync(MAIL_TEMP_DIR, { recursive: true })
          const attachments = regularAtts.map((att) => {
            const safeName = sanitizeAttachmentName(att.filename || 'attachment')
            const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
            const tempPath = path.join(MAIL_TEMP_DIR, uniqueName)
            fs.writeFileSync(tempPath, att.content as Buffer)
            return { name: safeName, url: tempPath }
          })

          resolve({ body: plainText, htmlBody, attachments })
        })
      })
    })

    fetcher.once('error', reject)
    fetcher.once('end', () => {
      // B23: end fires before simpleParser callback (race condition).
      // Only reject if the server returned no matching message at all.
      if (!sawMessage) reject(new Error('邮件不存在或已被删除'))
    })
  })
}

export async function searchMailImap(query: string, folder: string = 'inbox'): Promise<MailItem[]> {
  if (!imapClient) return []
  try {
    await openFolder(folder)
    return new Promise((resolve) => {
      ;(imapClient as any).search([['TEXT', query]], (_err: Error | null, uids: number[]) => {
        if (!uids?.length) return resolve([])
        const uidStr = uids.slice(0, 50).join(',')
        if (!uidStr) return resolve([])
        const fetcher = (imapClient as any).fetch(uidStr, { bodies: 'HEADER', struct: false })
        const items: MailItem[] = []
        let settled = false
        fetcher.on('message', (msg: any) => {
          let header = ''; let uid = 0; let flags: string[] = []
          msg.on('body', (stream: any) => { stream.on('data', (c: Buffer) => { header += c.toString('utf-8') }) })
          msg.once('attributes', (a: any) => { uid = a.uid; flags = a.flags || [] })
          msg.once('end', () => {
            parseHeaderMessage(header, flags, uid).then((item) => { if (item.id !== '0') items.push(item) }).catch(() => {})
          })
        })
        fetcher.once('error', () => { settled = true; resolve(items) })
        fetcher.once('end', () => { if (!settled) resolve(sortByDateDesc(items)) })
      })
    })
  } catch { return [] }
}

export async function checkNewMailCount(folder: string = 'inbox'): Promise<number> {
  if (!imapClient) return 0
  try {
    await openFolder(folder)
    return new Promise((resolve) => {
      ;(imapClient as any).search([['UNSEEN']], (_err: Error | null, uids: number[]) => resolve(uids?.length || 0))
    })
  } catch { return 0 }
}

export async function sendMail(params: { to: string; subject: string; body: string }): Promise<{ ok: boolean; error?: string; warning?: string }> {
  if (!activeConfig) return { ok: false, error: '邮箱未配置' }

  try {
    if (!smtpTransport) {
      smtpTransport = nodemailer.createTransport({
        host: activeConfig.smtpHost,
        port: activeConfig.smtpPort,
        secure: activeConfig.smtpTls,
        auth: { user: activeConfig.username, pass: activeConfig.password },
        // TLS verification enabled
      })
    }
    const mailOptions = {
      from: activeConfig.username,
      to: params.to,
      subject: params.subject,
      html: params.body.replace(/\n/g, '<br>'),
    }
    await smtpTransport.sendMail(mailOptions)

    // B21: Append copy to Sent folder
    try {
      const rawMessage = await new Promise<Buffer>((res, rej) => {
        const composer = new MailComposer(mailOptions)
        composer.compile().build((err: Error | null, buf: Buffer) => {
          if (err) rej(err)
          else res(buf)
        })
      })
      const sentBoxName = await resolveMailboxName('sent')
      await new Promise<void>((res, rej) => {
        ;(imapClient as any).append(rawMessage, {
          mailbox: sentBoxName, flags: ['\\Seen'],
        }, (err: Error) => { if (err) rej(err); else res() })
      })
    } catch (appendErr: any) {
      return { ok: true, warning: '已发送但无法保存到已发送文件夹' }
    }

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || '发送失败' }
  }
}

export function testMailConnection(config: MailConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const testClient = new Imap({
      user: config.username,
      password: config.password,
      host: config.imapHost,
      port: config.imapPort,
      tls: config.imapTls,
      // TLS cert verification enabled — mails.tsinghua.edu.cn uses valid Let's Encrypt
      connTimeout: 10000,
      authTimeout: 10000,
    })
    const timer = setTimeout(() => {
      try { testClient.end() } catch { /* ignore */ }
      resolve(false)
    }, 12000)
    testClient.once('ready', () => {
      clearTimeout(timer)
      testClient.end()
      resolve(true)
    })
    testClient.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    testClient.connect()
  })
}
