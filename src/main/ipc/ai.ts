import { ipcMain } from 'electron'
import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { scan, analyze, generate, abortGeneration, buildHwAttachment } from '../services/homework-ai'
import { askTutor, summarizeCourseArea } from '../services/tutor'
import { formatError } from '../utils/errors'

export function registerAiIpc(): void {
  ipcMain.handle('hwai:scan', async (_e, courseId: string) => {
    try {
      return await scan(courseId)
    } catch (err) {
      return { error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:analyze', async (_e, courseId: string, hwId: string) => {
    try {
      return await analyze(courseId, hwId)
    } catch (err) {
      return { error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:generate', async (_e, params: any) => {
    try {
      return await generate(params)
    } catch (err) {
      const msg = formatError(err)
      if (msg.includes('abort') || msg.includes('AbortError')) {
        return { aborted: true }
      }
      return { error: msg }
    }
  })

  ipcMain.handle('hwai:build-attachment', async (_e, spec: any, markdown: string) => {
    try {
      return await buildHwAttachment(spec, markdown)
    } catch (err) {
      return { error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:tutor-summary', async (_e, courseId: string, kind: 'notifications' | 'files' | 'discussion') => {
    try {
      return { ok: true, content: await summarizeCourseArea(courseId, kind) }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:tutor-ask', async (_e, courseId: string, question: string) => {
    try {
      return { ok: true, content: await askTutor(courseId, question) }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:abort', (_e, sessionId: string) => {
    abortGeneration(sessionId)
  })

  ipcMain.handle('hwai:has-acknowledged-risk', () => {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf-8')
      const s = JSON.parse(raw)
      return !!s.aiAutoCompleteAcknowledged
    } catch {
      return false
    }
  })

  ipcMain.handle('hwai:acknowledge-risk', () => {
    try {
      let s: any = {}
      try {
        const raw = fs.readFileSync(settingsFile, 'utf-8')
        s = JSON.parse(raw)
      } catch { /* ignore */ }
      s.aiAutoCompleteAcknowledged = true
      fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })
}
