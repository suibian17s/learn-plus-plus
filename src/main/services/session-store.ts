import { safeStorage, session } from 'electron'
import fs from 'fs'
import path from 'path'
import { accountsFile, credsFile, sessionFile } from '../utils/paths'
import { clearApiSession, getApiSessionCookiesSnapshot, restoreApiSessionCookies, syncApiCookiesToDefaultSession } from './learn'

export interface StoredAccount {
  id: string
  name: string
  department?: string
  cookies: Electron.CookiesSetDetails[]
  savedAt: number
  lastUsedAt: number
}

interface AccountsStore {
  activeId?: string
  accounts: StoredAccount[]
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function saveCreds(username: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(JSON.stringify({ username, password }))
  fs.writeFileSync(credsFile, encrypted)
}

export function loadCreds(): { username: string; password: string } | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = fs.readFileSync(credsFile)
    const decrypted = safeStorage.decryptString(encrypted)
    return JSON.parse(decrypted)
  } catch {
    return null
  }
}

function emptyAccountsStore(): AccountsStore {
  return { accounts: [] }
}

function readAccountsStore(): AccountsStore {
  if (!safeStorage.isEncryptionAvailable()) return emptyAccountsStore()
  try {
    const encrypted = fs.readFileSync(accountsFile)
    const decrypted = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(decrypted)
    return {
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : undefined,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    }
  } catch {
    return emptyAccountsStore()
  }
}

function writeAccountsStore(store: AccountsStore): void {
  if (!safeStorage.isEncryptionAvailable()) return
  ensureParentDir(accountsFile)
  fs.writeFileSync(accountsFile, safeStorage.encryptString(JSON.stringify(store)))
}

function accountIdFor(name: string, department?: string): string {
  return `${name || 'unknown'}::${department || ''}`
}

export function listAccounts(): { activeId?: string; accounts: Omit<StoredAccount, 'cookies'>[] } {
  const store = readAccountsStore()
  return {
    activeId: store.activeId,
    accounts: store.accounts.map(({ cookies: _cookies, ...account }) => account),
  }
}

export async function saveCurrentAccount(user: { name: string; department?: string }): Promise<StoredAccount | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  const cookies = await getApiSessionCookiesSnapshot()
  if (!cookies.length) return null

  const store = readAccountsStore()
  const id = accountIdFor(user.name, user.department)
  const existingIndex = store.accounts.findIndex((account) => account.id === id)
  const now = Date.now()
  const account: StoredAccount = {
    id,
    name: user.name || '未知账号',
    department: user.department || '',
    cookies,
    savedAt: existingIndex >= 0 ? store.accounts[existingIndex].savedAt : now,
    lastUsedAt: now,
  }

  if (existingIndex >= 0) {
    store.accounts[existingIndex] = account
  } else {
    store.accounts.push(account)
  }
  store.activeId = id
  writeAccountsStore(store)
  return account
}

export async function switchAccount(id: string): Promise<StoredAccount | null> {
  const store = readAccountsStore()
  const account = store.accounts.find((item) => item.id === id)
  if (!account) return null

  const restored = await restoreApiSessionCookies(account.cookies)
  if (!restored) return null
  await syncApiCookiesToDefaultSession()

  account.lastUsedAt = Date.now()
  store.activeId = account.id
  writeAccountsStore(store)
  return account
}

export async function clearAll(): Promise<void> {
  try { fs.unlinkSync(credsFile) } catch { /* ignore */ }
  try { fs.unlinkSync(sessionFile) } catch { /* ignore */ }
  // Clear Chromium session cookies so probeSession won't report as logged in
  try {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  } catch { /* ignore */ }
  // Also clear the API session partition
  await clearApiSession()
}
