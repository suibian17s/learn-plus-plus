import { BrowserWindow } from 'electron'
import {
  connectMail, disconnectMail, fetchMailList, fetchMailBody, sendMail as imapSendMail,
  testMailConnection as _testMailConnection, isMailConnected, setImapStarred, deleteImapMail,
} from './mail-imap'
import type { MailConfig } from './mail-imap'
import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { loadApiKey } from './secret-store'

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

let mailWindow: BrowserWindow | null = null
let mailLoggedIn = false
let mailMode: 'web' | 'imap' = 'web'
let loginResolve: ((ok: boolean) => void) | null = null
let listCache: { folder: string; mails: MailItem[]; cachedAt: number } | null = null
const detailCache: Map<string, { mail: MailDetail; cachedAt: number }> = new Map()

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

// ── Unified interface (web or IMAP) ──

function withSavedPassword(config: MailConfig): MailConfig {
  const saved = loadApiKey('mail') || ''
  return { ...config, password: config.password || saved }
}

export async function loginMailImap(config: MailConfig): Promise<boolean> {
  const ok = await connectMail(withSavedPassword(config))
  if (ok) {
    mailMode = 'imap'
    mailLoggedIn = true
  }
  return ok
}

export async function testMailConnection(config: MailConfig): Promise<boolean> {
  return _testMailConnection(withSavedPassword(config))
}

export function isMailLoggedIn(): boolean {
  if (mailMode === 'imap') return isMailConnected()
  return mailLoggedIn
}

async function getMailListUnified(folder: string): Promise<{ mails: MailItem[]; total: number }> {
  if (mailMode === 'imap') {
    const mails = await fetchMailList(folder)
    listCache = { folder, mails, cachedAt: Date.now() }
    return { mails, total: mails.length }
  }
  return getMailListWeb(folder)
}

async function getMailDetailUnified(mailId: string): Promise<MailDetail | null> {
  if (mailMode === 'imap') {
    const { body, attachments } = await fetchMailBody(mailId)
    // Get subject/from from list cache
    const cached = listCache?.mails.find(m => m.id === mailId)
    return { id: mailId, subject: cached?.subject || '', from: cached?.from || '', to: cached?.to || '', date: cached?.date || '', preview: '', starred: false, read: true, body, attachments }
  }
  return getMailDetailWeb(mailId)
}

async function sendMailUnified(params: { to: string; subject: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  if (mailMode === 'imap') return imapSendMail(params)
  return composeMailWeb(params)
}

// ── Exported unified API (used by IPC handlers) ──
export async function getMailList(folder: string) { return getMailListUnified(folder) }
export async function getMailDetail(mailId: string) { return getMailDetailUnified(mailId) }
export async function composeMail(params: { to: string; subject: string; body: string }) { return sendMailUnified(params) }
const LIST_CACHE_MS = 5 * 60 * 1000
const DETAIL_CACHE_MS = 30 * 60 * 1000

// ── DOM scraping (Coremail selectors confirmed 2026-05-02) ──

const MAIL_LIST_SCRIPT = `
(function () {
  var items = [];
  var rows = document.querySelectorAll('tbody.j-mail-list tr.j-mail');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var mid = row.getAttribute('mid');
    if (!mid) continue;

    // Subject
    var subEl = row.querySelector('td.subject-item span.subject');
    var subject = subEl ? subEl.textContent.trim() : '(无主题)';

    // Sender — from td.fromto, prefer title attribute
    var fromEl = row.querySelector('td.fromto');
    var from = '';
    if (fromEl) {
      from = (fromEl.getAttribute('title') || fromEl.textContent || '').trim();
    }

    // Date — td with time/date class
    var dateEl = row.querySelector('td[class*="time"], td[class*="date"], td.time, td.date');
    var date = dateEl ? dateEl.textContent.trim() : '';

    // Read state
    var read = row.classList.contains('read');

    // Starred
    var html = row.innerHTML || '';
    var starred = /star|★|⭐|fav|flagged/i.test(html);

    // Preview — try adjacent cells or snippet
    var preview = '';
    var previewEl = row.querySelector('td[class*="preview"], td[class*="snippet"], td[class*="brief"]');
    if (previewEl) preview = previewEl.textContent.trim();

    items.push({
      id: mid, subject: subject, from: from, to: '',
      date: date, preview: preview,
      starred: starred, read: read
    });

    if (items.length >= 100) break;
  }

  // If no rows found with j-mail-list, try a broader search
  if (items.length === 0) {
    var fallback = document.querySelectorAll('tr[mid]');
    for (var f = 0; f < fallback.length && items.length < 100; f++) {
      var fr = fallback[f];
      var fmid = fr.getAttribute('mid');
      if (!fmid) continue;
      var fsub = fr.querySelector('td.subject-item span.subject, span.subject, a[href*="mid="], a[href*="readmail"]');
      var ffrom = fr.querySelector('td.fromto, td[class*="from"]');
      var fdate = fr.querySelector('td[class*="time"], td[class*="date"]');
      items.push({
        id: fmid,
        subject: fsub ? fsub.textContent.trim() : '(无主题)',
        from: ffrom ? (ffrom.getAttribute('title') || ffrom.textContent).trim() : '',
        to: '',
        date: fdate ? fdate.textContent.trim() : '',
        preview: '',
        starred: false,
        read: fr.classList.contains('read')
      });
    }
  }

  return JSON.stringify(items);
})()
`

const MAILBOX_CHECK_SCRIPT = `
(function () {
  var rows = document.querySelectorAll('tbody.j-mail-list tr.j-mail, tr[mid]');
  var hasMailItems = rows.length > 0;
  var title = document.title || '';
  var isLogin = /login|登录|Log In|Sign In|passport|auth/i.test(title);
  return JSON.stringify({
    ok: !isLogin && (hasMailItems || document.querySelectorAll('a[href]').length > 15),
    mailCount: rows.length, title: title, isLogin: isLogin
  });
})()
`

const MAIL_DETAIL_SCRIPT = `
(function () {
  var bodyHtml = '';

  // Strategy 1: Coremail typically loads mail content inside an iframe
  var iframes = document.querySelectorAll('iframe');
  for (var i = 0; i < iframes.length; i++) {
    try {
      var doc = iframes[i].contentDocument || iframes[i].contentWindow.document;
      if (!doc) continue;
      // Remove scripts/styles inside iframe
      var bad = doc.querySelectorAll('script, style, noscript, link[rel="stylesheet"]');
      for (var b = 0; b < bad.length; b++) bad[b].remove();
      // Remove headers/nav inside iframe
      var noise = doc.querySelectorAll('header, nav, .header, .nav, .topbar, .menu');
      for (var n = 0; n < noise.length; n++) noise[n].remove();
      var iframeBody = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
      if (iframeBody && iframeBody.replace(/\\s/g, '').length > 50) {
        bodyHtml = iframeBody;
        break;
      }
    } catch(e) { /* cross-origin iframe blocked */ }
  }

  // Strategy 2: If no iframe content, look for main content areas in the page
  if (!bodyHtml) {
    var selectors = [
      '#content_div', '.mail_content', '.mail_body', '.msg_body',
      '#message_body', '.readmail_body', '[class*="mail_body"]',
      '.coremail_content', '#content', '.content'
    ];
    for (var s = 0; s < selectors.length; s++) {
      var el = document.querySelector(selectors[s]);
      if (el) {
        // Strip nav/header/footer within the content area
        var copy = el.cloneNode(true);
        var remove = copy.querySelectorAll(
          'header, nav, .header, .nav, .topbar, .sidebar, footer, .footer, ' +
          '.mail_header, .mail_toolbar, .action_bar, .toolbar, ' +
          'script, style, noscript, [class*="header"], [class*="toolbar"]'
        );
        for (var r = 0; r < remove.length; r++) remove[r].remove();
        var html = copy.innerHTML;
        if (html && html.replace(/\\s/g, '').length > 50) {
          bodyHtml = html;
          break;
        }
      }
    }
  }

  // Strategy 3: Full-page fallback — strip everything except main content
  if (!bodyHtml) {
    var clone = document.body.cloneNode(true);
    var remove = clone.querySelectorAll(
      'script, style, noscript, header, nav, footer, ' +
      '.header, .nav, .topbar, .sidebar, .menu, .footer, ' +
      '.mail_list, .mail-toolbar, [class*="header"], [class*="nav"], ' +
      '[class*="toolbar"], [class*="sidebar"], [class*="menu"]'
    );
    for (var r = 0; r < remove.length; r++) remove[r].remove();
    bodyHtml = clone.innerHTML;
  }

  // Attachments
  var atts = [];
  var attEls = document.querySelectorAll(
    'a[href*="attach"], a[href*="download"], a[href*="fj"], ' +
    '.attach a, .attachment a, [class*="fj"] a, [class*="fj_"] a'
  );
  for (var a = 0; a < attEls.length; a++) {
    var name = (attEls[a].textContent || attEls[a].getAttribute('title') || '').trim();
    var url = attEls[a].getAttribute('href') || '';
    if (name && url) atts.push({ name: name, url: url });
  }

  return JSON.stringify({ bodyHtml: bodyHtml, attachments: atts });
})()
`

// ── Login ──

export async function loginMail(): Promise<boolean> {
  if (mailLoggedIn) return true

  const imapConfig = getMailConfigFromSettings()
  if (imapConfig) {
    const ok = await loginMailImap(imapConfig)
    if (ok) return true
  }

  return new Promise((resolve) => {
    loginResolve = resolve

    mailWindow = new BrowserWindow({
      width: 960,
      height: 700,
      title: '登录清华邮箱 — 登录成功后窗口将自动隐藏',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    mailWindow.loadURL(MAIL_BASE)
    mailWindow.setMenu(null)

    // Poll every 2 seconds to detect when user reaches inbox
    const pollInterval = setInterval(async () => {
      if (!mailWindow || mailWindow.isDestroyed()) {
        clearInterval(pollInterval)
        return
      }
      try {
        const raw = await mailWindow.webContents.executeJavaScript(MAILBOX_CHECK_SCRIPT)
        const status = JSON.parse(raw)
        if (status.ok && !status.isLogin) {
          clearInterval(pollInterval)
          mailLoggedIn = true
          mailWindow.hide()
          if (loginResolve) { loginResolve(true); loginResolve = null }
        }
      } catch {
        // Page might be loading or navigating, keep polling
      }
    }, 2000)

    mailWindow.on('closed', () => {
      clearInterval(pollInterval)
      mailWindow = null
      if (!mailLoggedIn) {
        mailLoggedIn = false
        if (loginResolve) { loginResolve(false); loginResolve = null }
      }
    })

    // 15-minute timeout
    setTimeout(() => {
      clearInterval(pollInterval)
      if (!mailLoggedIn && mailWindow && !mailWindow.isDestroyed()) {
        mailWindow.close()
      }
    }, 15 * 60 * 1000)
  })
}

// ── Ensure window is available for scraping ──

async function ensureMailWindow(): Promise<BrowserWindow> {
  if (!mailWindow || mailWindow.isDestroyed()) {
    throw new Error('邮箱未登录，请先登录清华邮箱')
  }
  // If the window is hidden, show it briefly can cause issues; just use it hidden
  return mailWindow
}

function waitForLoad(win: BrowserWindow, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    win.webContents.once('did-finish-load', () => setTimeout(done, ms))
    win.webContents.once('did-fail-load', () => setTimeout(done, ms))
    setTimeout(done, ms + 5000) // safety timeout
  })
}

// ── Mail list ──

async function scrollToLoadAll(win: BrowserWindow): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const scrolled = await win.webContents.executeJavaScript(`
      (function () {
        var list = document.querySelector('tbody.j-mail-list');
        var container = list ? list.parentElement : document.scrollingElement || document.body;
        var oldScroll = container.scrollTop || 0;
        container.scrollTop = container.scrollHeight;
        return container.scrollTop > oldScroll;
      })()
    `)
    if (!scrolled) break
    await new Promise(r => setTimeout(r, 600))
  }
}

async function getMailListWeb(folder: string): Promise<{ mails: MailItem[]; total: number }> {
  if (!mailLoggedIn) throw new Error('邮箱未登录，请先登录清华邮箱')
  if (listCache && listCache.folder === folder && Date.now() - listCache.cachedAt < LIST_CACHE_MS) {
    return { mails: listCache.mails, total: listCache.mails.length }
  }

  const win = await ensureMailWindow()

  if (folder === 'inbox') {
    // Don't reload — already on inbox after login. Scroll to load all.
    await scrollToLoadAll(win)
  } else {
    // Navigate to folder: first ensure we're on inbox, then click folder link
    const folderKeywords: Record<string, string[]> = {
      sent: ['已发送', '已发邮件', '发件箱'],
      drafts: ['草稿', '草稿箱'],
      trash: ['已删除', '删除', '废纸篓'],
    }
    const keywords = folderKeywords[folder] || [folder]
    const clicked = await win.webContents.executeJavaScript(`
      (function () {
        var kws = ${JSON.stringify(keywords)};
        // Try specific folder nav selectors first
        var navLinks = document.querySelectorAll(
          'a[href*="folder"], a[href*="sent"], a[href*="draft"], a[href*="trash"], ' +
          '.folder-item, .nav-folder, [class*="folder"], [class*="nav_item"], ' +
          '.left_menu a, .sidebar a, .menu a, .tree a'
        );
        var allLinks = navLinks.length > 0 ? navLinks : document.querySelectorAll('a, span[onclick], li[onclick]');
        for (var i = 0; i < allLinks.length; i++) {
          var t = (allLinks[i].textContent || '').trim();
          for (var k = 0; k < kws.length; k++) {
            if (t.indexOf(kws[k]) >= 0) {
              allLinks[i].click();
              return t;
            }
          }
        }
        return false;
      })()
    `)
    // Wait for folder to load, then scroll
    await new Promise(r => setTimeout(r, clicked ? 2500 : 500))
    await scrollToLoadAll(win)
  }

  const raw = await win.webContents.executeJavaScript(MAIL_LIST_SCRIPT)
  const items: MailItem[] = JSON.parse(raw)
  listCache = { folder, mails: items, cachedAt: Date.now() }
  return { mails: items, total: items.length }
}

// ── Mail detail ──

async function getMailDetailWeb(mailId: string): Promise<MailDetail | null> {
  if (!mailLoggedIn) return null

  const cached = detailCache.get(mailId)
  if (cached && Date.now() - cached.cachedAt < DETAIL_CACHE_MS) return cached.mail

  const win = await ensureMailWindow()

  // Try to open the mail: click the row first, then try URL patterns
  let bodyFound = false

  // Step 1: click the mail row to open preview/detail
  const alreadyOnList = await win.webContents.executeJavaScript(`
    (function () {
      var row = document.querySelector('tr[mid="${mailId}"]');
      if (!row) return false;
      var link = row.querySelector('a[href]');
      if (link) { link.click(); return true; }
      var sub = row.querySelector('td.subject-item');
      if (sub) { sub.click(); return true; }
      row.click();
      return true;
    })()
  `)
  await new Promise(r => setTimeout(r, 2000))

  // Step 2: try to extract body (may be in preview pane or same page)
  let raw = await win.webContents.executeJavaScript(MAIL_DETAIL_SCRIPT)
  let detail = JSON.parse(raw)
  if (detail.bodyHtml && detail.bodyHtml.replace(/\\s/g, '').length > 50) {
    bodyFound = true
  }

  // Step 3: if no body found, try URL-based navigation
  if (!bodyFound) {
    const urlPatterns = [
      `${MAIL_BASE}/coremail/readmail.jsp?mid=${encodeURIComponent(mailId)}`,
      `${MAIL_BASE}/coremail/viewmail?mid=${encodeURIComponent(mailId)}`,
      `${MAIL_BASE}/coremail/mail?mid=${encodeURIComponent(mailId)}`,
    ]
    for (const url of urlPatterns) {
      try {
        win.loadURL(url)
        await waitForLoad(win, 2500)
        raw = await win.webContents.executeJavaScript(MAIL_DETAIL_SCRIPT)
        detail = JSON.parse(raw)
        if (detail.bodyHtml && detail.bodyHtml.replace(/\\s/g, '').length > 50) {
          bodyFound = true
          break
        }
      } catch { continue }
    }
  }

  // Extract meta from page
  const metaRaw = await win.webContents.executeJavaScript(`
    JSON.stringify({
      subject: (document.querySelector('h1, h2, .subject, .mail_title, [class*="subject"], [class*="title"]') || {}).textContent || document.title || '',
      from: (document.querySelector('.sender, .from, [class*="sender"], [class*="from"], [class*="author"]') || {}).textContent || '',
      date: (document.querySelector('.time, .date, [class*="time"], [class*="date"]') || {}).textContent || '',
    })
  `)
  const meta = JSON.parse(metaRaw)

  const mail: MailDetail = {
    id: mailId,
    subject: (meta.subject || '').trim() || '(无主题)',
    from: (meta.from || '').trim(),
    to: '',
    date: (meta.date || '').trim(),
    preview: '',
    starred: false,
    read: true,
    body: bodyFound ? (detail.bodyHtml || '') : '',
    attachments: detail.attachments || [],
  }

  detailCache.set(mailId, { mail, cachedAt: Date.now() })
  return mail
}

// ── Star / Delete (lightweight fetch-based) ──

export async function setMailStarred(mailId: string, starred: boolean): Promise<{ ok: boolean }> {
  if (mailMode === 'imap') {
    listCache = null
    return setImapStarred(mailId, starred)
  }
  if (!mailLoggedIn || !mailWindow) return { ok: false }
  listCache = null
  // Use the mail window to toggle star via DOM click
  try {
    await mailWindow.webContents.executeJavaScript(`
      (function () {
        var el = document.querySelector('[mid="${mailId}"] .star, [mid="${mailId}"] [class*="star"], [mid="${mailId}"] [class*="flag"]');
        if (!el) el = document.querySelector('tr[id="${mailId}"] .star, tr[uid="${mailId}"] .star');
        if (el) el.click();
      })()
    `)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function deleteMail(mailId: string): Promise<{ ok: boolean }> {
  if (mailMode === 'imap') {
    listCache = null
    detailCache.delete(mailId)
    return deleteImapMail(mailId)
  }
  if (!mailLoggedIn || !mailWindow) return { ok: false }
  listCache = null
  detailCache.delete(mailId)
  try {
    await mailWindow.webContents.executeJavaScript(`
      (function () {
        var el = document.querySelector('[mid="${mailId}"] .delete, [mid="${mailId}"] [class*="delete"], [mid="${mailId}"] [class*="del"]');
        if (!el) el = document.querySelector('tr[id="${mailId}"] .delete, tr[uid="${mailId}"] .delete');
        if (el) el.click();
      })()
    `)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// ── Compose (reply / forward) ──

async function composeMailWeb(params: {
  to: string; subject: string; body: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailLoggedIn || !mailWindow) return { ok: false, error: '未登录邮箱' }

  try {
    // Navigate to compose page
    mailWindow.loadURL(`${MAIL_BASE}/coremail/compose.jsp`)
    await new Promise(r => setTimeout(r, 3000))

    // Fill compose form
    const result = await mailWindow.webContents.executeJavaScript(`
      (function () {
        var p = ${JSON.stringify(params)};
        // Find To field
        var toEl = document.querySelector('input[name="to"], input[id*="to"], input[class*="to"], #to, [name="to"]');
        if (!toEl) {
          var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
          if (inputs.length >= 1) toEl = inputs[0];
        }
        // Find Subject field
        var subEl = document.querySelector('input[name="subject"], input[id*="subject"], #subject, [name="subject"]');
        if (!subEl) {
          var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
          if (inputs.length >= 2) subEl = inputs[1];
        }
        // Find body — try contenteditable, textarea, or iframe
        var bodyEl = document.querySelector('[contenteditable="true"], textarea, .mail_editor, #editor, [class*="editor"]');
        // Find send button
        var sendEl = document.querySelector(
          'button[type="submit"], input[type="submit"], ' +
          'a.send, .send_btn, [class*="send"]'
        );
        if (!sendEl) {
          var btns = document.querySelectorAll('button, a.btn, .btn');
          for (var i = 0; i < btns.length; i++) {
            if (/发送|Send|send/.test(btns[i].textContent)) { sendEl = btns[i]; break; }
          }
        }

        // Fill in values
        var filled = 0;
        try {
          if (toEl && p.to) { toEl.value = p.to; toEl.dispatchEvent(new Event('input', {bubbles:true})); filled++; }
          if (subEl && p.subject) { subEl.value = p.subject; subEl.dispatchEvent(new Event('input', {bubbles:true})); filled++; }
          if (bodyEl && p.body) {
            if (bodyEl.tagName === 'IFRAME') {
              try { bodyEl.contentDocument.body.innerHTML = p.body.replace(/\\n/g, '<br>'); filled++; } catch(e) {}
            } else if (bodyEl.getAttribute('contenteditable') === 'true') {
              bodyEl.innerHTML = p.body.replace(/\\n/g, '<br>'); filled++;
            } else {
              bodyEl.value = p.body; bodyEl.dispatchEvent(new Event('input', {bubbles:true})); filled++;
            }
          }
        } catch(e) { /* ignore */ }

        return JSON.stringify({ sendFound: !!sendEl, filled: filled });
      })()
    `)
    const status = JSON.parse(result)

    if (status.filled < 2) {
      return { ok: false, error: '无法填写邮件表单，请使用"打开原站"手动发送' }
    }

    // Click send if found
    if (status.sendFound) {
      await mailWindow.webContents.executeJavaScript(`
        (function () {
          var sendEl = document.querySelector('button[type="submit"], input[type="submit"], a.send, .send_btn, [class*="send"]');
          if (!sendEl) {
            var btns = document.querySelectorAll('button, a.btn, .btn');
            for (var i = 0; i < btns.length; i++) {
              if (/发送|Send|send/.test(btns[i].textContent)) { sendEl = btns[i]; break; }
            }
          }
          if (sendEl) sendEl.click();
        })()
      `)
      return { ok: true }
    }

    return { ok: true } // Form filled but send button not found — user can send manually
  } catch (err: any) {
    return { ok: false, error: err.message || '发送失败' }
  }
}

// ── Logout ──

export function showMailWindow(): void {
  if (mailWindow && !mailWindow.isDestroyed()) {
    mailWindow.show()
    mailWindow.focus()
  }
}

export function logoutMail(): void {
  mailLoggedIn = false
  listCache = null
  detailCache.clear()
  if (mailWindow && !mailWindow.isDestroyed()) {
    mailWindow.close()
  }
  mailWindow = null
}
