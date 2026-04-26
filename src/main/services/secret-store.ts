import { safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { aiKeyFile, settingsFile } from '../utils/paths'

interface ApiKeyStore {
  default?: string
  providers: Record<string, string>
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readSettingsJson(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
  } catch {
    return null
  }
}

export function stripLegacyApiKeyFromSettings(): void {
  const settings = readSettingsJson()
  if (!settings || !('apiKey' in settings)) return

  delete settings.apiKey
  ensureParentDir(settingsFile)
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
}

function loadLegacyPlaintextApiKey(): string {
  const settings = readSettingsJson()
  const key = settings?.apiKey
  return typeof key === 'string' ? key : ''
}

function emptyStore(): ApiKeyStore {
  return { providers: {} }
}

function readApiKeyStore(): ApiKeyStore {
  if (!safeStorage.isEncryptionAvailable()) return emptyStore()

  try {
    const encrypted = fs.readFileSync(aiKeyFile)
    const decrypted = safeStorage.decryptString(encrypted).trim()
    if (!decrypted) return emptyStore()

    try {
      const parsed = JSON.parse(decrypted)
      if (parsed && typeof parsed === 'object') {
        return {
          default: typeof parsed.default === 'string' ? parsed.default : undefined,
          providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
        }
      }
    } catch {
      // Older versions stored a single encrypted API key.
    }

    return { default: decrypted, providers: {} }
  } catch {
    const legacyKey = loadLegacyPlaintextApiKey()
    return legacyKey ? { default: legacyKey, providers: {} } : emptyStore()
  }
}

function writeApiKeyStore(store: ApiKeyStore): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不可用安全存储，无法保存 API Key')
  }

  ensureParentDir(aiKeyFile)
  fs.writeFileSync(aiKeyFile, safeStorage.encryptString(JSON.stringify(store)))
  stripLegacyApiKeyFromSettings()
}

export function saveApiKey(apiKey: string, provider = 'default'): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    clearApiKey(provider)
    stripLegacyApiKeyFromSettings()
    return
  }

  const store = readApiKeyStore()
  const key = provider || 'default'
  if (key === 'default') {
    store.default = trimmed
  } else {
    store.providers[key] = trimmed
  }
  writeApiKeyStore(store)
}

export function loadApiKey(provider = 'default'): string {
  if (!safeStorage.isEncryptionAvailable()) return ''

  const store = readApiKeyStore()
  const key = provider || 'default'
  const providerKey = key === 'default' ? '' : store.providers[key]
  if (providerKey) return providerKey
  if (store.default) {
    writeApiKeyStore(store)
    return store.default
  }
  return ''
}

export function hasApiKey(provider = 'default'): boolean {
  return loadApiKey(provider).length > 0
}

export function clearApiKey(provider?: string): void {
  if (!provider) {
    try {
      fs.unlinkSync(aiKeyFile)
    } catch {
      // ignore
    }
    return
  }

  const store = readApiKeyStore()
  if (provider === 'default') {
    delete store.default
  } else {
    delete store.providers[provider]
  }

  if (!store.default && Object.keys(store.providers).length === 0) {
    clearApiKey()
    return
  }
  writeApiKeyStore(store)
}
