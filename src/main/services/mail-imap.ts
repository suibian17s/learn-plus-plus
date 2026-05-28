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

let activeConfig: MailConfig | null = null
let imapClient: Imap | null = null
let smtpTransport: nodemailer.Transporter | null = null

// ── Connection ──

export function connectMail(config: MailConfig): Promise<boolean> {
  return new Promise((resolve) => {
    disconnectMail()

    activeConfig = config
    imapClient = new Imap({
      user: config.username,
      password: config.password,
      host: config.imapHost,
      port: config.imapPort,
      tls: config.imapTls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
    })

    imapClient.once('ready', () => {
      resolve(true)
    })

    imapClient.once('error', (err: Error) => {
      imapClient = null
      resolve(false)
    })

    imapClient.connect()
  })
}

export function disconnectMail(): void {
  try { imapClient?.end() } catch { /* ignore */ }
  imapClient = null
  smtpTransport = null
  activeConfig = null
}

export function isMailConnected(): boolean {
  return imapClient !== null && imapClient.state === 'authenticated'
}

// ── Fetch mail list ──

export function fetchMailList(folder: string): Promise<MailItem[]> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('未连接邮箱'))

    const boxName = folder === 'sent' ? '[Gmail]/Sent Mail' :
      folder === 'drafts' ? '[Gmail]/Drafts' :
      folder === 'trash' ? '[Gmail]/Trash' : 'INBOX'

    imapClient.openBox(boxName, false, (err, box) => {
      if (err) {
        // Try alternate names
        const alt = folder === 'sent' ? 'Sent' :
          folder === 'drafts' ? 'Drafts' :
          folder === 'trash' ? 'Trash' : 'INBOX'
        imapClient!.openBox(alt, false, (err2, box2) => {
          if (err2) return reject(err2)
          fetchMessages(box2, resolve, reject)
        })
        return
      }
      fetchMessages(box, resolve, reject)
    })
  })
}

function fetchMessages(box: any, resolve: (items: MailItem[]) => void, reject: (err: Error) => void): void {
  const total = box.messages.total
  if (total === 0) return resolve([])

  const from = Math.max(1, total - 99)
  const f = imapClient!.seq.fetch(`${from}:${total}`, {
    bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
    struct: true,
  })

  const items: MailItem[] = []
  f.on('message', (msg: any, seqno: number) => {
    let header = ''
    let flags: string[] = []
    msg.on('body', (stream: any) => {
      stream.on('data', (chunk: Buffer) => { header += chunk.toString('utf-8') })
    })
    msg.once('attributes', (attrs: any) => {
      flags = attrs.flags || []
    })
    msg.once('end', () => {
      const subject = (header.match(/^Subject:\s*(.+)$/im) || [])[1]?.trim() || '(无主题)'
      const fromAddr = (header.match(/^From:\s*(.+)$/im) || [])[1]?.trim() || ''
      const date = (header.match(/^Date:\s*(.+)$/im) || [])[1]?.trim() || ''
      const toAddr = (header.match(/^To:\s*(.+)$/im) || [])[1]?.trim() || ''

      // Decode RFC2047 encoded headers
      function decodeRfc2047(str: string): string {
        return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_match: string, _charset: string, encoding: string, text: string) => {
          try {
            if (encoding.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString()
            if (encoding.toUpperCase() === 'Q') {
              return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)))
            }
          } catch { /* ignore */ }
          return text
        }).replace(/\s+/g, ' ').trim()
      }

      items.push({
        id: `${seqno}`,
        subject: decodeRfc2047(subject),
        from: decodeRfc2047(fromAddr),
        to: decodeRfc2047(toAddr),
        date: date,
        preview: '',
        starred: flags.includes('\\Flagged'),
        read: flags.includes('\\Seen'),
      })
    })
  })

  f.once('error', reject)
  f.once('end', () => {
    items.reverse() // newest first
    resolve(items)
  })
}

export function setImapStarred(seqno: string, starred: boolean): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!imapClient) return resolve({ ok: false })
    const done = (err?: Error) => resolve({ ok: !err })
    const seq = imapClient.seq as any
    if (starred) seq.addFlags(seqno, '\\Flagged', done)
    else seq.delFlags(seqno, '\\Flagged', done)
  })
}

export function deleteImapMail(seqno: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!imapClient) return resolve({ ok: false })
    const seq = imapClient.seq as any
    seq.addFlags(seqno, '\\Deleted', (err?: Error) => {
      if (err) return resolve({ ok: false })
      ;(imapClient as any).expunge((expungeErr?: Error) => resolve({ ok: !expungeErr }))
    })
  })
}

// ── Fetch mail body ──

export function fetchMailBody(seqno: string): Promise<{ body: string; attachments: { name: string; url: string }[] }> {
  return new Promise((resolve, reject) => {
    if (!imapClient) return reject(new Error('未连接邮箱'))
    const f = imapClient.seq.fetch(seqno, { bodies: '' })
    f.on('message', (msg: any) => {
      msg.on('body', (stream: any) => {
        simpleParser(stream, (err, parsed) => {
          if (err) return reject(err)
          resolve({
            body: parsed.html || parsed.text || '',
            attachments: (parsed.attachments || []).map((a) => ({
              name: a.filename || 'attachment',
              url: '',
            })),
          })
        })
      })
    })
    f.once('error', reject)
  })
}

// ── Send mail ──

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

// ── Test connection ──

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
    const timer = setTimeout(() => { testClient.end(); resolve(false) }, 12000)
    testClient.once('ready', () => { clearTimeout(timer); testClient.end(); resolve(true) })
    testClient.once('error', () => { clearTimeout(timer); resolve(false) })
    testClient.connect()
  })
}
