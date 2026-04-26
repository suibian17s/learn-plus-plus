import { app } from 'electron'
import path from 'path'
import os from 'os'

export const userDataPath = app.getPath('userData')
export const sessionFile = path.join(userDataPath, 'session.enc')
export const credsFile = path.join(userDataPath, 'credentials.enc')
export const accountsFile = path.join(userDataPath, 'accounts.enc')
export const aiKeyFile = path.join(userDataPath, 'ai-key.enc')
export const settingsFile = path.join(userDataPath, 'settings.json')
export const defaultDownloadDir = path.join(os.homedir(), 'Downloads', 'learn++')
export const fontsDir = path.join(__dirname, '..', '..', 'resources', 'fonts')
