import { Learn2018Helper } from 'thu-learn-lib'
import { safeStorage, session } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import { AuthError } from '../utils/errors'
import { sessionFile } from '../utils/paths'

let helper: Learn2018Helper | null = null
let reloginPromise: Promise<void> | null = null
let cachedCreds: { username: string; password: string } | null = null
let storedCSRFToken = ''
let _apiSession: Electron.Session | null = null
let _sanitizePromise: Promise<void> | null = null

function getApiSession(): Electron.Session {
  if (!_apiSession) {
    _apiSession = session.fromPartition('persist:learnpp-api')
  }
  return _apiSession
}

function isLatin1(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 255) return false
  }
  return true
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function cookieUrl(c: Electron.Cookie): string | null {
  const domain = (c.domain || '').replace(/^\./, '')
  if (!domain) return null
  return `${c.secure === false ? 'http' : 'https'}://${domain}${c.path || '/'}`
}

function serializeCookie(c: Electron.Cookie): Electron.CookiesSetDetails | null {
  if (!isLatin1(c.name) || !isLatin1(c.value)) return null
  const url = cookieUrl(c)
  if (!url) return null

  return {
    url,
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: c.secure,
    httpOnly: c.httpOnly,
    expirationDate: c.expirationDate,
    sameSite: c.sameSite as 'unspecified' | 'no_restriction' | 'lax' | 'strict',
  }
}

export async function saveApiSessionToDisk(): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return

  try {
    const cookies = await getApiSessionCookiesSnapshot()

    ensureParentDir(sessionFile)
    const encrypted = safeStorage.encryptString(JSON.stringify({ cookies, savedAt: Date.now() }))
    fs.writeFileSync(sessionFile, encrypted)
    log.info(`Saved ${cookies.length} API session cookies`)
  } catch (err) {
    log.warn('Failed to save API session:', err instanceof Error ? err.message : String(err))
  }
}

export async function getApiSessionCookiesSnapshot(): Promise<Electron.CookiesSetDetails[]> {
  const cookies = await getApiSession().cookies.get({})
  return cookies
    .map(serializeCookie)
    .filter((c): c is Electron.CookiesSetDetails => !!c)
}

export async function restoreApiSessionCookies(cookies: Electron.CookiesSetDetails[]): Promise<boolean> {
  try {
    const apiSession = getApiSession()
    await apiSession.clearStorageData({ storages: ['cookies'] })
    for (const c of cookies) {
      try {
        await apiSession.cookies.set(c)
      } catch {
        // skip invalid legacy cookie entries
      }
    }
    await saveApiSessionToDisk()
    return true
  } catch (err) {
    log.warn('Failed to restore API session cookies:', err instanceof Error ? err.message : String(err))
    return false
  }
}

export async function restoreApiSessionFromDisk(): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false

  try {
    const encrypted = fs.readFileSync(sessionFile)
    const raw = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(raw)
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : []
    if (!cookies.length) return false

    await restoreApiSessionCookies(cookies)
    log.info(`Restored ${cookies.length} API session cookies`)
    return true
  } catch {
    return false
  }
}

/**
 * Strip non-ASCII cookies from a session.
 * Returns number of cookies removed.
 */
async function sanitizeSession(s: Electron.Session): Promise<number> {
  const cookies = await s.cookies.get({})
  let removed = 0
  for (const c of cookies) {
    if (!isLatin1(c.name) || !isLatin1(c.value)) {
      try {
        const domain = (c.domain || '').replace(/^\./, '')
        if (!domain) continue // can't build a valid URL without domain
        await s.cookies.remove(`https://${domain}${c.path || '/'}`, c.name)
        removed++
      } catch { /* skip */ }
    }
  }
  return removed
}

/**
 * Sanitize the API session before each fetch.
 * Uses a deduplication promise so concurrent calls share one sanitize pass.
 */
async function sanitizeApiSession(): Promise<void> {
  if (_sanitizePromise) {
    await _sanitizePromise
    return
  }
  _sanitizePromise = (async () => {
    try {
      const apiSession = getApiSession()
      const removed = await sanitizeSession(apiSession)
      if (removed > 0) {
        log.info(`Sanitized ${removed} non-ASCII cookies from API session`)
      }

      const remainingUnsafe = (await apiSession.cookies.get({}))
        .filter((c) => !isLatin1(c.name) || !isLatin1(c.value))
      if (remainingUnsafe.length > 0) {
        await apiSession.clearStorageData({ storages: ['cookies'] })
        await syncCookiesToApiSession()
        log.warn(`Cleared API session after ${remainingUnsafe.length} unsafe cookies could not be removed individually`)
      }
    } catch { /* best-effort */ }
    finally {
      _sanitizePromise = null
    }
  })()
  await _sanitizePromise
}

async function syncCookiesToApiSession(): Promise<void> {
  try {
    const s = getApiSession()
    const cookies = await session.defaultSession.cookies.get({})
    const safeCookies = cookies.filter(
      (c) => isLatin1(c.name) && isLatin1(c.value),
    )

    await s.clearStorageData({ storages: ['cookies'] })

    for (const c of safeCookies) {
      try {
        await s.cookies.set({
          url: `https://${(c.domain || '').replace(/^\./, '')}${c.path}`,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
          sameSite: c.sameSite as 'unspecified' | 'no_restriction' | 'lax' | 'strict',
        })
      } catch { /* skip */ }
    }
    log.info(`Synced ${safeCookies.length} ASCII-safe cookies to API session`)
    await saveApiSessionToDisk()
  } catch (err) {
    log.warn('Failed to sync cookies:', err instanceof Error ? err.message : String(err))
  }
}

export async function syncApiCookiesToDefaultSession(): Promise<void> {
  try {
    const cookies = await getApiSession().cookies.get({})
    const safeCookies = cookies
      .filter((c) => isLatin1(c.name) && isLatin1(c.value))
      .map(serializeCookie)
      .filter((c): c is Electron.CookiesSetDetails => !!c)

    for (const c of safeCookies) {
      try {
        await session.defaultSession.cookies.set(c)
      } catch {
        // skip invalid cookie entries
      }
    }
    log.info(`Synced ${safeCookies.length} API cookies to default session`)
  } catch (err) {
    log.warn('Failed to sync API cookies to default session:', err instanceof Error ? err.message : String(err))
  }
}

export async function apiFetch(url: string, init?: RequestInit): ReturnType<typeof session.prototype.fetch> {
  await sanitizeApiSession()
  return getApiSession().fetch(url, init as any)
}

export async function clearApiSession(): Promise<void> {
  try {
    if (_apiSession) {
      await _apiSession.clearStorageData({ storages: ['cookies'] })
    }
  } catch { /* ignore */ }
  try { fs.unlinkSync(sessionFile) } catch { /* ignore */ }
}

function makeElectronFetch() {
  return async (input: string | URL | Request, init?: RequestInit) => {
    await sanitizeApiSession()

    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input.url

    const resp = await getApiSession().fetch(url, {
      method: init?.method || 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body as BodyInit | null,
      redirect: 'manual',
    })

    return {
      ok: resp.ok,
      status: resp.status,
      url: resp.url,
      headers: resp.headers,
      text: () => resp.text(),
      json: () => resp.json(),
      arrayBuffer: () => resp.arrayBuffer(),
    } as unknown as Response
  }
}

export function getHelper(): Learn2018Helper {
  if (!helper) {
    helper = new Learn2018Helper({ fetch: makeElectronFetch() })
  }
  return helper
}

/**
 * Initialize helper right after browser login.
 * Extracts CSRF token from course page so API calls work.
 */
export async function initFromBrowserSession(): Promise<void> {
  // Sync cookies first so the API session has the auth cookies
  await syncCookiesToApiSession()

  const initialized = await initFromApiSession()
  if (!initialized) {
    throw new AuthError('Browser session is not logged in')
  }
}

function looksLikeLoggedOutPage(body: string, url = ''): boolean {
  const lower = body.toLowerCase()
  return (
    url.includes('login') ||
    url.includes('id.tsinghua') ||
    lower.includes('not logged in') ||
    lower.includes('login timeout') ||
    lower.includes('id.tsinghua') ||
    lower.includes('/login') ||
    body.includes('统一身份认证') ||
    body.includes('用户登录')
  )
}

/**
 * Initialize helper from the persisted API session.
 * Returns false when the session is present but no longer authenticated.
 */
export async function initFromApiSession(): Promise<boolean> {
  helper = new Learn2018Helper({ fetch: makeElectronFetch() })

  // Extract CSRF token from course page
  try {
    await sanitizeApiSession()
    const resp = await getApiSession().fetch(
      'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
      { redirect: 'manual' },
    )

    if (resp.status === 200) {
      const body = await resp.text()
      if (looksLikeLoggedOutPage(body, resp.url)) {
        return false
      }

      const m = body.match(/_csrf=([^"&\s]+)/)
      if (m) {
        helper.setCSRFToken(m[1])
        storedCSRFToken = m[1]
        log.info('CSRF token extracted via API session')
        await saveApiSessionToDisk()
        return true
      }

      helper.setCSRFToken('placeholder-api-session')
      log.info('API session looks authenticated; using placeholder CSRF token')
      await saveApiSessionToDisk()
      return true
    }
    log.warn(`Course page returned ${resp.status}, CSRF not extracted`)
  } catch (err) {
    log.warn('Failed to fetch course page for CSRF:', err instanceof Error ? err.message : String(err))
  }

  return false
}

export async function probeApiSession(): Promise<boolean> {
  try {
    const initialized = await initFromApiSession()
    if (!initialized) return false
    await getHelper().getCurrentSemester()
    return true
  } catch {
    return false
  }
}

export async function probeSession(): Promise<boolean> {
  try {
    // Sanitize default session — browser login may set non-ASCII cookies
    await sanitizeSession(session.defaultSession)
    const resp = await session.defaultSession.fetch(
      'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
      { redirect: 'manual' },
    )
    if (resp.status !== 200) return false
    const body = await resp.text()
    return !looksLikeLoggedOutPage(body, resp.url)
  } catch {
    return false
  }
}

export function setCachedCreds(u: string, p: string): void {
  cachedCreds = { username: u, password: p }
}

export function getCachedCreds(): { username: string; password: string } | null {
  return cachedCreds
}

export function getStoredCSRFToken(): string {
  return storedCSRFToken
}

/**
 * Extract cookies from the API session for use with external HTTP clients.
 */
export async function getCookieString(url: string): Promise<string> {
  try {
    const cookies = await getApiSession().cookies.get({})
    return cookies
      .filter((c: Electron.Cookie) => {
        const hostname = new URL(url).hostname
        const cd = (c.domain || '')
        const matchesDomain = hostname.endsWith(cd.replace(/^\./, '')) || cd === hostname
        return matchesDomain && isLatin1(c.name) && isLatin1(c.value)
      })
      .map((c: Electron.Cookie) => `${c.name}=${c.value}`)
      .join('; ')
  } catch {
    return ''
  }
}

export async function login(username: string, password: string): Promise<void> {
  const h = getHelper()
  await h.login(username, password)
  setCachedCreds(username, password)
  const initialized = await initFromApiSession()
  if (!initialized) throw new AuthError('Login succeeded but authenticated session could not be initialized')
}

export async function withAuth<T>(fn: (h: Learn2018Helper) => Promise<T>): Promise<T> {
  try {
    return await fn(getHelper())
  } catch (e) {
    if (isAuthError(e)) {
      reloginPromise ??= reloginOnce()
      await reloginPromise
      reloginPromise = null
      return await fn(getHelper())
    }
    throw e
  }
}

function isAuthError(e: unknown): boolean {
  if (e instanceof Error) {
    const msg = e.message.toLowerCase()
    return msg.includes('unauthorized') || msg.includes('login') || msg.includes('auth') || msg.includes('401') || msg.includes('302') || msg.includes('not logged in') || msg.includes('credential')
  }
  return false
}

async function reloginOnce(): Promise<void> {
  const creds = cachedCreds
  if (!creds) throw new AuthError('No cached credentials for re-login')
  const h = getHelper()
  await h.login(creds.username, creds.password)
  const initialized = await initFromApiSession()
  if (!initialized) throw new AuthError('Re-login succeeded but authenticated session could not be initialized')
}
