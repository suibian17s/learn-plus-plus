import Imap from 'node-imap'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
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
    imapClient.getBoxes((err, boxes) => {
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
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
    })

    client.once('ready', () => {
      imapClient = client
      activeConfig = config
      cachedMailboxNames = null
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

export function isMailConnected(): boolean {
  return imapClient !== null && imapClient.state === 'authenticated'
}

export function fetchMailList(folder: string): Promise<MailItem[]> {
  return new Promise(async (resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))

    try {
      const box = await openFolder(folder)
      const total = box.messages.total
      if (total === 0) return resolve([])

      const from = Math.max(1, total - MAIL_FETCH_LIMIT + 1)
      const fetcher = imapClient.seq.fetch(`${from}:${total}`, {
        bodies: 'HEADER',
        struct: false,
      })

      const items: MailItem[] = []
      const parsing: Promise<void>[] = []
      let settled = false

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
        resolve(sortByDateDesc(items))
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

export function deleteImapMail(uid: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!imapClient) return resolve({ ok: false })
    const client = imapClient as any
    client.addFlags(uid, '\\Deleted', (err?: Error) => {
      if (err) return resolve({ ok: false })
      client.expunge((expungeErr?: Error) => resolve({ ok: !expungeErr }))
    })
  })
}

export function fetchMailBody(uid: string): Promise<{ body: string; attachments: { name: string; url: string }[] }> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('邮箱未连接'))
    const fetcher = (imapClient as any).fetch(uid, { bodies: '', markSeen: true })
    let resolved = false

    fetcher.on('message', (msg: any) => {
      msg.on('body', (stream: any) => {
        simpleParser(stream, (err, parsed) => {
          if (resolved) return
          if (err) return reject(err)
          resolved = true
          resolve({
            body: parsed.html || parsed.textAsHtml || parsed.text || '',
            attachments: (parsed.attachments || []).map((attachment) => ({
              name: attachment.filename || 'attachment',
              url: '',
            })),
          })
        })
      })
    })

    fetcher.once('error', reject)
    fetcher.once('end', () => {
      if (!resolved) reject(new Error('邮件正文为空'))
    })
  })
}

export async function sendMail(params: { to: string; subject: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  if (!activeConfig) return { ok: false, error: '邮箱未配置' }

  try {
    if (!smtpTransport) {
      smtpTransport = nodemailer.createTransport({
        host: activeConfig.smtpHost,
        port: activeConfig.smtpPort,
        secure: activeConfig.smtpTls,
        auth: { user: activeConfig.username, pass: activeConfig.password },
        tls: { rejectUnauthorized: false },
      })
    }
    await smtpTransport.sendMail({
      from: activeConfig.username,
      to: params.to,
      subject: params.subject,
      html: params.body.replace(/\n/g, '<br>'),
    })
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
      tlsOptions: { rejectUnauthorized: false },
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
