import { app, ipcMain } from 'electron'
import fs from 'fs'
import { settingsFile, defaultDownloadDir } from '../utils/paths'
import { setDownloadDir } from './files'
import { setHwDownloadDir } from './homework'
import { hasApiKey, saveApiKey } from '../services/secret-store'
import type { AppSettings } from '../types'
import { getAiProviderPreset } from '../../shared/aiProviders'

const defaults: AppSettings = {
  downloadDir: defaultDownloadDir,
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-6',
  aiBaseUrl: '',
  aiApiFormat: 'openai',
  apiKey: '',
  launchAtStartup: false,
  aiAutoCompleteAcknowledged: false,
}

function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsFile, 'utf-8')
    const parsed = JSON.parse(raw)
    delete parsed.apiKey
    delete parsed.loginUrl
    delete parsed.rememberPassword
    const merged = { ...defaults, ...parsed, apiKey: '' }
    return normalizeAiSettings(merged)
  } catch {
    return normalizeAiSettings({ ...defaults })
  }
}

function normalizeAiSettings(settings: AppSettings): AppSettings {
  const preset = getAiProviderPreset(settings.aiProvider)
  const knownModel = preset.models.some((model) => model.value === settings.aiModel)
  if (settings.aiProvider !== 'custom' && !knownModel) {
    return {
      ...settings,
      aiModel: preset.defaultModel,
      aiApiFormat: preset.apiFormat,
      aiBaseUrl: '',
    }
  }
  return settings
}

function saveSettings(s: AppSettings): void {
  const { apiKey: _apiKey, hasApiKey: _hasApiKey, ...safeSettings } = s
  fs.writeFileSync(settingsFile, JSON.stringify(safeSettings, null, 2))
}

function syncDownloadDir(settings: AppSettings): void {
  if (!settings.downloadDir) return
  setDownloadDir(settings.downloadDir)
  setHwDownloadDir(settings.downloadDir)
}

export function registerSettingsIpc(): void {
  syncDownloadDir(loadSettings())

  ipcMain.handle('settings:get', () => {
    const settings = loadSettings()
    syncDownloadDir(settings)
    const configured = hasApiKey(settings.aiProvider)
    return {
      ...settings,
      apiKey: '',
      hasApiKey: configured,
      launchAtStartup: app.getLoginItemSettings().openAtLogin,
    }
  })

  ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => {
    const current = loadSettings()
    const { apiKey: _apiKey, hasApiKey: _hasApiKey, ...safePartial } = partial
    const updated = { ...current, ...safePartial, apiKey: '' }
    saveSettings(updated)
    if (partial.downloadDir) {
      setDownloadDir(partial.downloadDir)
      setHwDownloadDir(partial.downloadDir)
    }
    if (typeof partial.launchAtStartup === 'boolean') {
      app.setLoginItemSettings({
        openAtLogin: partial.launchAtStartup,
        path: process.execPath,
        args: partial.launchAtStartup ? ['--hidden'] : [],
      })
    }
    return updated
  })

  ipcMain.handle('settings:setApiKey', (_e, key: string, provider?: string) => {
    const current = loadSettings()
    saveApiKey(key, provider || current.aiProvider || 'default')
    return { ok: true }
  })

  ipcMain.handle('settings:hasApiKey', (_e, provider?: string) => {
    const current = loadSettings()
    return hasApiKey(provider || current.aiProvider)
  })
}
