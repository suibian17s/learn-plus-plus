# P3 Email Fixes V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-apply P3 email improvements on top of the B23-fixed baseline, without the mistakes of V1.

**Architecture:** Minimal changes to existing files. No new connection manager. Each improvement is self-contained.

**Tech Stack:** TypeScript, node-imap, mailparser, DOMPurify, React, Electron IPC

**Key constraints (from V1 failures):**
- Do NOT create `mail-connection.ts`
- Do NOT change `fetchMailBody`'s `sawMessage`/`end` promise settlement pattern (B23)
- Do NOT wrap `imapClient.fetch()` in extra callbacks — keep the original `(imapClient as any).fetch(uid, { bodies: '', markSeen: true })` pattern

---

### Task 1: B9+A3 — HTML body + cid images + downloadable attachments

**Files:** `src/main/services/mail-imap.ts:262-290`, `src/main/services/mail-service.ts:20-25,185-204`, `src/main/ipc/mail.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/src/env.d.ts`, `src/renderer/src/pages/Mailbox.tsx:667-686`

- [ ] **Step 1: Add imports to mail-imap.ts**

Add to the top of `src/main/services/mail-imap.ts` (after existing imports):
```typescript
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
```

- [ ] **Step 2: Add helper constants and functions to mail-imap.ts**

Add AFTER the `MAIL_FETCH_LIMIT` line and BEFORE `let activeConfig`:
```typescript
const MAIL_TEMP_DIR = path.join(app.getPath('temp'), 'learnpp-mail-attachments')

function sanitizeAttachmentName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

- [ ] **Step 3: Extend fetchMailBody return type and add htmlBody + attachment processing**

Replace the `resolve(...)` call inside `fetchMailBody` (currently lines 274-280) with:
```typescript
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
```

Also update the function return type on line 262:
```typescript
export function fetchMailBody(uid: string): Promise<{ body: string; htmlBody: string; attachments: { name: string; url: string }[] }> {
```

- [ ] **Step 4: Update MailDetail interface in mail-service.ts**

In `src/main/services/mail-service.ts`, update the `MailDetail` interface (around line 24):
```typescript
export interface MailDetail extends MailItem {
  body: string
  htmlBody?: string
  attachments: { name: string; url: string }[]
}
```

- [ ] **Step 5: Update getMailDetailUnified to pass htmlBody**

In `src/main/services/mail-service.ts`, update `getMailDetailUnified` to destructure `htmlBody`:
```typescript
const { body, htmlBody, attachments } = await fetchMailBody(mailId)
```
And add to the return object:
```typescript
body: cleanMailBodyHtml(body, cached?.preview || ''),
htmlBody: htmlBody || undefined,
attachments,
```

- [ ] **Step 6: Add mail:save-attachment IPC handler**

In `src/main/ipc/mail.ts`, add after the existing `mail:compose` handler:
```typescript
ipcMain.handle('mail:save-attachment', async (e, tempPath: string, fileName: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return { ok: false, error: '无窗口' }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: fileName,
    title: '保存附件',
  })
  if (canceled || !filePath) return { ok: false, error: '已取消' }
  try {
    fs.copyFileSync(tempPath, filePath)
    return { ok: true, destPath: filePath }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
```
Also add needed imports at the top of `ipc/mail.ts`:
```typescript
import { BrowserWindow, dialog } from 'electron'
import fs from 'fs'
```

- [ ] **Step 7: Expose saveAttachment in preload**

In `src/preload/index.ts`, add to the `mail:` object:
```typescript
saveAttachment: (tempPath: string, fileName: string) =>
  ipcRenderer.invoke('mail:save-attachment', tempPath, fileName),
```

- [ ] **Step 8: Update type files for htmlBody and saveAttachment**

In `src/preload/api.d.ts` and `src/renderer/src/env.d.ts`:
- Add `htmlBody?: string` to the `mail.get` return type
- Add `saveAttachment: (tempPath: string, fileName: string) => Promise<{ ok: boolean; error?: string }>` to the mail API

- [ ] **Step 9: Update Mailbox.tsx body rendering**

In `src/renderer/src/pages/Mailbox.tsx`, update the body section (~line 667-686). Replace the existing `dangerouslySetInnerHTML` block with:
```tsx
<section className="lp2-mail-read-body">
  {detailLoading ? (
    <div className="lp2-mail-body-loading"><Spin /></div>
  ) : detail?.htmlBody ? (
    <iframe
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<base target="_blank"><style>img{max-width:100%;height:auto}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;color:#333}</style>${DOMPurify.sanitize(detail.htmlBody)}`}
      className="lp2-mail-iframe"
    />
  ) : detail?.body ? (
    <div className="lp2-mail-html-body" dangerouslySetInnerHTML={{ __html: detail.body }} />
  ) : (
    <p>{detailMail.preview || '(无正文内容)'}</p>
  )}
  {!!detail?.attachments?.length && (
    <div className="lp2-mail-attachments">
      <div className="lp2-mail-attachments-header">
        附件 ({detail.attachments.length})
      </div>
      {detail.attachments.map((att) => (
        <button
          key={att.name}
          className="lp2-mail-attachment-item"
          onClick={() => window.learn.mail.saveAttachment(att.url, att.name)}
        >
          {att.name}
        </button>
      ))}
    </div>
  )}
</section>
```
Add DOMPurify import at top of Mailbox.tsx:
```typescript
import DOMPurify from 'dompurify'
```

- [ ] **Step 10: Typecheck, build, package**

```bash
npx tsc --noEmit && npm run package:dir
```

---

### Task 2: B8 — Delete moves to Trash

**Files:** `src/main/services/mail-imap.ts:254-263`

- [ ] **Step 1: Rewrite deleteImapMail to move to Trash**

Replace the entire `deleteImapMail` function:
```typescript
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
        if (err) resolve({ ok: false, error: err.message })
        else resolve({ ok: true })
      })
    } catch (err: any) {
      resolve({ ok: false, error: err.message || '移动到回收站失败' })
    }
  })
}
```

- [ ] **Step 2: Update mail-service.ts deleteMail to pass currentFolder**

In `src/main/services/mail-service.ts`, update `setMailStarred` return type usage and `deleteMail` to pass currentFolder. Find the existing `deleteMail` function and update:
```typescript
export async function deleteMail(mailId: string, currentFolder?: string): Promise<{ ok: boolean; error?: string }> {
  if (mailMode === 'imap') return deleteImapMail(mailId, currentFolder)
  return deleteMailWeb(mailId)
}
```

- [ ] **Step 3: Update IPC and preload for currentFolder**

In `ipc/mail.ts`, update the `mail:delete` handler:
```typescript
ipcMain.handle('mail:delete', async (_e, mailId: string, currentFolder?: string) => {
  return deleteMail(mailId, currentFolder)
})
```
In `preload/index.ts`, `api.d.ts`, `env.d.ts`: update `delete` signature to `(mailId: string, currentFolder?: string)`.

- [ ] **Step 4: Update Mailbox.tsx to pass currentFolder**

In the `handleDelete` function in `Mailbox.tsx`, pass the current `folder` state to `window.learn.mail.delete(mailId, folder)`.

- [ ] **Step 5: Typecheck, build, package**

---

### Task 3: B21 — Append sent mail to Sent folder

**Files:** `src/main/services/mail-imap.ts:332-355`

- [ ] **Step 1: Add MailComposer import**

Add to imports at top of `mail-imap.ts`:
```typescript
import MailComposer from 'nodemailer/lib/mail-composer'
```

- [ ] **Step 2: Add IMAP APPEND after SMTP send**

In `sendMail`, after `await smtpTransport.sendMail(mailOptions)` succeeds, add:
```typescript
// B21: Append copy to Sent folder
try {
  const rawMessage = await new Promise<Buffer>((resolve, reject) => {
    const composer = new MailComposer(mailOptions)
    composer.compile().build((err: Error | null, buf: Buffer) => {
      if (err) reject(err)
      else resolve(buf)
    })
  })
  const sentBoxName = await resolveMailboxName('sent')
  await new Promise<void>((resolveAppend, rejectAppend) => {
    ;(imapClient as any).append(rawMessage, {
      mailbox: sentBoxName,
      flags: ['\\Seen'],
    }, (err: Error) => {
      if (err) rejectAppend(err)
      else resolveAppend()
    })
  })
} catch (appendErr: any) {
  // Don't fail the send — email was already sent via SMTP
  return { ok: true, warning: '已发送但无法保存到已发送文件夹: ' + appendErr.message }
}
```

- [ ] **Step 3: Update sendMail return type to include warning**

Change return type to `Promise<{ ok: boolean; error?: string; warning?: string }>`. Update `mail-service.ts` `composeMail` return type. Update IPC/preload types.

- [ ] **Step 4: Typecheck, build, package**

---

### Task 4: B22+B10 — Search + incremental sync

**Files:** `src/main/services/mail-imap.ts`, `src/main/services/mail-service.ts`, `src/main/ipc/mail.ts`

- [ ] **Step 1: Add searchMailImap function to mail-imap.ts**

Add after `fetchMailBody`:
```typescript
export async function searchMailImap(query: string, folder: string = 'inbox'): Promise<MailItem[]> {
  if (!imapClient) return []
  try {
    await openFolder(folder)
    return new Promise((resolve) => {
      ;(imapClient as any).search([['TEXT', query]], async (_err: Error | null, uids: number[]) => {
        if (!uids?.length) return resolve([])
        const uidStr = uids.slice(0, 50).join(',')
        if (!uidStr) return resolve([])
        const fetcher = (imapClient as any).fetch(uidStr, { bodies: 'HEADER', struct: false })
        const items: MailItem[] = []
        let settled = false
        fetcher.on('message', (msg: any) => {
          let header = ''
          let uid = 0
          let flags: string[] = []
          msg.on('body', (stream: any) => { stream.on('data', (c: Buffer) => { header += c.toString('utf-8') }) })
          msg.once('attributes', (a: any) => { uid = a.uid; flags = a.flags || [] })
          msg.once('end', () => {
            parseHeaderMessage(header, flags, uid).then((item) => { if (item.id !== '0') items.push(item) }).catch(() => {})
          })
        })
        fetcher.once('error', () => { settled = true; resolve(items) })
        fetcher.once('end', async () => { if (!settled) resolve(sortByDateDesc(items)) })
      })
    })
  } catch { return [] }
}
```

- [ ] **Step 2: Add lightweight check function**

```typescript
export async function checkNewMailCount(folder: string = 'inbox'): Promise<number> {
  if (!imapClient) return 0
  try {
    await openFolder(folder)
    return new Promise((resolve) => {
      ;(imapClient as any).search([['UNSEEN']], (_err: Error | null, uids: number[]) => resolve(uids?.length || 0))
    })
  } catch { return 0 }
}
```

- [ ] **Step 3: Add searchMail to mail-service.ts**

Add a `searchMail` function that does local instant filter + server-side search on Enter. Add IPC handler `mail:search`. Add preload types.

- [ ] **Step 4: Incremental sync — add FolderCache to mail-service.ts**

Add a simple `Map<string, { messages: MailItem[]; uidvalidity: number; maxUid: number }>` cache. Modify `getMailList` to check cache and do incremental fetch. Add `getFolderUidInfo` export to mail-imap.ts.

- [ ] **Step 5: Typecheck, build, package**

---

**Execution order:** Task 1 → Task 2 → Task 3 → Task 4. Each task is independently testable.

**Typecheck gate:** Every task MUST pass `npx tsc --noEmit` before proceeding.
