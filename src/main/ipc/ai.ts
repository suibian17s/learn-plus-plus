import { ipcMain, BrowserWindow, app } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { settingsFile } from '../utils/paths'
import { scan, analyze, generate, abortGeneration, buildHwAttachment } from '../services/homework-ai'
import { parseAttachment } from '../services/attachment-parser'
import { downloadUrlToBuffer } from '../services/downloader'
import { addFocusItem } from '../services/focus-store'
import { orchestrate } from '../services/homework-orchestrator'
import { askTutor, summarizeCourseArea, summarizeSingleFile, askAboutFile } from '../services/tutor'
import { complete } from '../services/ai'
import { withAuth } from '../services/learn'
import { query as searchQuery } from '../services/search-index'
import { getMailList, getMailDetail, isMailLoggedIn } from '../services/mail-service'
import { getStatsForAI } from '../services/stats'
import { formatError } from '../utils/errors'
import { aiCall, loadAiSettings, buildAiHeaders, type AiMessage } from '../services/ai-client'
import {
  runAgentLoop,
  type ToolCall,
  type AgentChunkCallback,
  type ToolExecutor,
} from '../services/tutor-agent'
import { CourseType } from 'thu-learn-lib'

// ── Abort controller store ──

const abortControllers = new Map<string, AbortController>()

// ── Tool executor: maps tool names to actual data-fetching calls ──

async function executeTutorTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'list_courses': {
      return withAuth(async (h) => {
        const sem = await h.getCurrentSemester()
        const courses = await h.getCourseList(String(sem.id), CourseType.STUDENT)
        return JSON.stringify(courses.map((c: any) => ({
          id: c.id || c.courseId,
          name: c.chineseName || c.name || '',
          teacher: c.teacherName || c.teacher || '',
        })))
      })
    }

    case 'list_homeworks': {
      return withAuth(async (h) => {
        const list = await h.getHomeworkList(args.courseId)
        return JSON.stringify(list.map((hw: any) => {
          // 得分过滤异常负值（维护铁律）
          const validGrade = typeof hw.grade === 'number' && hw.grade >= 0 ? hw.grade : undefined
          return {
            id: hw.id,
            title: hw.title || '',
            status: hw.submitted ? (hw.graded ? '已批阅' : '已提交') : '未提交',
            deadline: hw.deadline || '',
            submitTime: hw.submitTime || '',
            graded: !!hw.graded,
            grade: validGrade,
            gradeLevel: hw.gradeLevel || undefined,
            graderName: hw.graderName || undefined,
            gradeComment: hw.gradeContent
              ? String(hw.gradeContent).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
              : undefined,
            description: (hw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
          }
        }))
      })
    }

    case 'list_emails': {
      try {
        const folder = args.folder || 'inbox'
        const result = await getMailList(folder)
        if (!result) return JSON.stringify({ message: '邮箱未登录，请先在邮件页面登录清华邮箱。' })
        const mails = (result as any).mails || result || []
        const list = Array.isArray(mails) ? mails : []
        return JSON.stringify(list.slice(0, 20).map((m: any) => ({
          id: m.id,
          subject: m.subject || '',
          from: m.from || '',
          date: m.date || '',
          preview: m.preview || '',
          read: m.read,
          starred: m.starred,
        })))
      } catch (err: any) {
        return JSON.stringify({ error: `获取邮件失败: ${err.message}` })
      }
    }

    case 'search_emails': {
      try {
        const results = searchQuery(args.query, 'email')
        if (!results.length) return JSON.stringify({ message: '未找到匹配的邮件，请尝试其他关键词。', results: [] })
        return JSON.stringify({
          results: results.map((r: any) => ({
            id: r.targetId,
            title: r.title,
            subtitle: r.subtitle,
            courseName: r.courseName,
          })),
        })
      } catch (err: any) {
        return JSON.stringify({ error: `搜索邮件失败: ${err.message}` })
      }
    }

    case 'get_email': {
      try {
        const detail = await getMailDetail(args.mailId)
        if (!detail) return JSON.stringify({ error: '未找到该邮件' })
        return JSON.stringify({
          id: (detail as any).id,
          subject: (detail as any).subject || '',
          from: (detail as any).from || '',
          date: (detail as any).date || '',
          body: ((detail as any).body || '').replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000),
          attachments: ((detail as any).attachments || []).map((a: any) => ({ name: a.name, url: a.url })),
        })
      } catch (err: any) {
        return JSON.stringify({ error: `获取邮件详情失败: ${err.message}` })
      }
    }

    case 'list_files': {
      return withAuth(async (h) => {
        const files = await h.getFileList(args.courseId)
        return JSON.stringify(files.slice(0, 30).map((f: any) => ({
          id: f.id,
          name: f.title || f.name || '',
          fileType: f.fileType || '',
          uploadTime: f.uploadTime || '',
          size: f.size || f.rawSize || '',
        })))
      })
    }

    case 'list_notices': {
      return withAuth(async (h) => {
        const notices = await h.getNotificationList(args.courseId)
        return JSON.stringify(notices.slice(0, 15).map((n: any) => ({
          id: n.id,
          title: n.title || '',
          publisher: n.publisher || '',
          publishTime: n.publishTime || '',
          summary: (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        })))
      })
    }

    case 'list_discussions': {
      return withAuth(async (h) => {
        const discussions = await h.getDiscussionList(args.courseId)
        return JSON.stringify(discussions.slice(0, 20).map((d: any) => ({
          id: d.id,
          title: d.title || '',
          author: d.publisherName || d.author || '',
          replyCount: d.replyCount || 0,
          publishTime: d.publishTime || '',
        })))
      })
    }

    case 'summarize_content': {
      try {
        const kind = args.kind || '内容'
        const summary = await complete({
          system: '你是 learn++ 的甘蔗 tutor。请用中文总结以下内容，输出简洁有条理的摘要，突出关键信息。',
          messages: [{
            role: 'user',
            content: `请总结以下${kind}：\n\n${args.content}`,
          }],
          maxTokens: 1500,
        })
        return summary
      } catch (err: any) {
        return JSON.stringify({ error: `总结失败: ${err.message}` })
      }
    }

    case 'complete_homework': {
      try {
        return withAuth(async (h) => {
          const list = await h.getHomeworkList(args.courseId)
          const homeworks = list.map((hw: any) => ({
            id: hw.id,
            title: hw.title || '',
            submitted: !!hw.submitted,
            deadline: hw.deadline || '',
          }))

          if (args.homeworkId) {
            const target = homeworks.find((hw: any) => hw.id === args.homeworkId)
            if (target) {
              return JSON.stringify({
                message: `作业「${target.title}」可通过 learn++ 作业页面的一键完成功能生成参考草稿。请在作业页面选择该作业后使用"甘蔗 AI 自动完成"功能。`,
                homework: target,
                allHomeworks: homeworks,
              })
            }
          }

          return JSON.stringify({
            message: `课程共有 ${homeworks.length} 个作业。请告诉学生选择具体作业，然后在作业页面使用"甘蔗 AI 自动完成"功能生成参考草稿。`,
            homeworks,
          })
        })
      } catch (err: any) {
        return JSON.stringify({ error: `获取作业列表失败: ${err.message}` })
      }
    }

    case 'search_global': {
      try {
        const results = searchQuery(args.q)
        if (!results.length) return JSON.stringify({ message: '未找到匹配的内容，请尝试其他关键词。', results: [] })
        return JSON.stringify({
          results: results.map((r: any) => ({
            type: r.type,
            title: r.title,
            subtitle: r.subtitle,
            courseId: r.courseId,
            courseName: r.courseName,
            targetTab: r.targetTab,
            targetId: r.targetId,
          })),
        })
      } catch (err: any) {
        return JSON.stringify({ error: `全局搜索失败: ${err.message}` })
      }
    }

    case 'get_stats': {
      try {
        // B12 fix: use the canonical stats.ts implementation instead of duplicating
        const stats = getStatsForAI()

        // Course count is a separate concern — fetch it here
        let courseCount = 0
        try {
          const courses = await withAuth(async (h) => {
            const sem = await h.getCurrentSemester()
            return h.getCourseList(String(sem.id), CourseType.STUDENT)
          })
          courseCount = courses.length
        } catch { /* ignore */ }

        return JSON.stringify({ ...stats, courseCount })
      } catch (err: any) {
        return JSON.stringify({ error: `获取统计数据失败: ${err.message}` })
      }
    }

    case 'get_file_content': {
      try {
        const text = await withAuth(async (h) => {
          const files = await h.getFileList(args.courseId)
          const file: any = (files as any[]).find((f: any) => f.id === args.fileId || f.fileId === args.fileId)
          if (!file) return null
          const url = file.downloadUrl || file.url
          if (!url) return null
          const buffer = await downloadUrlToBuffer(url)
          const tempDir = path.join(os.tmpdir(), 'learnpp-tutor-tool')
          fs.mkdirSync(tempDir, { recursive: true })
          const ext = file.fileType ? `.${String(file.fileType).replace(/^\./, '')}` : path.extname(file.title || '')
          const tempPath = path.join(tempDir, `${Date.now()}${ext || '.pdf'}`)
          fs.writeFileSync(tempPath, buffer)
          try {
            const parsed = await parseAttachment(tempPath)
            return { name: file.title || file.name || '', text: parsed.text }
          } finally {
            try { fs.unlinkSync(tempPath) } catch { /* ignore */ }
          }
        })
        if (!text) return JSON.stringify({ error: '未找到该课件或无下载地址，请先用 list_files 确认 fileId' })
        if (!text.text?.trim()) return JSON.stringify({ error: `课件「${text.name}」无法提取文本（可能是扫描版或纯图片）` })
        return JSON.stringify({ name: text.name, content: text.text.slice(0, 12000) })
      } catch (err: any) {
        return JSON.stringify({ error: `读取课件失败: ${err.message}` })
      }
    }

    case 'get_homework_detail': {
      try {
        const analyzed = await analyze(args.courseId, args.homeworkId)
        // 补充得分/批阅信息（analyze 不含）
        let gradeInfo: Record<string, any> = {}
        try {
          const list = await withAuth(async (h) => h.getHomeworkList(args.courseId))
          const raw: any = (list as any[]).find((x: any) => x.id === args.homeworkId)
          if (raw) {
            const vg = typeof raw.grade === 'number' && raw.grade >= 0 ? raw.grade : undefined
            gradeInfo = {
              status: raw.submitted ? (raw.graded ? '已批阅' : '已提交') : '未提交',
              grade: vg,
              gradeLevel: raw.gradeLevel || undefined,
              graderName: raw.graderName || undefined,
              gradeComment: raw.gradeContent
                ? String(raw.gradeContent).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)
                : undefined,
            }
          }
        } catch { /* best-effort */ }
        return JSON.stringify({
          title: analyzed.hw.title,
          deadline: analyzed.hw.deadline,
          ...gradeInfo,
          description: (analyzed.hw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
          attachments: analyzed.parsedAttachments.map((a) => ({ name: a.name, content: a.text.slice(0, 4000) })),
          type: analyzed.type,
          warnings: analyzed.warnings,
        })
      } catch (err: any) {
        return JSON.stringify({ error: `获取作业详情失败: ${err.message}` })
      }
    }

    case 'get_notice_detail': {
      return withAuth(async (h) => {
        const notices = await h.getNotificationList(args.courseId)
        const notice: any = (notices as any[]).find((n: any) => n.id === args.noticeId)
        if (!notice) return JSON.stringify({ error: '未找到该公告，请先用 list_notices 确认 noticeId' })
        return JSON.stringify({
          title: notice.title || '',
          publisher: notice.publisher || '',
          publishTime: notice.publishTime || '',
          content: String(notice.content || '').replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000),
        })
      })
    }

    case 'list_deadlines': {
      try {
        // 直接读 dashboard 磁盘缓存（SWR 常驻），毫秒级返回
        const cacheFile = path.join(app.getPath('userData'), 'dashboard-cache.json')
        const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
        const data = raw?.data
        if (!data) return JSON.stringify({ message: '暂无待办快照，请让用户先打开一次首页。' })
        return JSON.stringify({
          snapshotAgeMinutes: raw.ts ? Math.round((Date.now() - raw.ts) / 60000) : null,
          todayFocus: (data.todayFocus || []).map((t: any) => ({
            title: t.title, courseName: t.courseName, courseId: t.courseId,
            deadline: t.deadline || '', priority: t.priority, tag: t.tag,
          })),
          courseProgress: (data.courseProgress || []).filter((c: any) => c.total > 0).map((c: any) => ({
            courseName: c.courseName, done: c.done, total: c.total,
          })),
        })
      } catch {
        return JSON.stringify({ message: '暂无待办快照，请让用户先打开一次首页生成数据。' })
      }
    }

    case 'add_focus_item': {
      try {
        if (!args.title) return JSON.stringify({ error: '缺少任务标题' })
        addFocusItem({
          id: `tutor-${Date.now()}`,
          type: 'custom',
          title: String(args.title).slice(0, 120),
          description: String(args.description || '甘蔗 Tutor 添加'),
          createdAt: new Date().toISOString(),
        })
        return JSON.stringify({ ok: true, message: `已将「${args.title}」加入今日重点，用户可在首页看到。` })
      } catch (err: any) {
        return JSON.stringify({ error: `添加失败: ${err.message}` })
      }
    }

    case 'draft_mail': {
      try {
        const draft = await complete({
          system: '你是邮件写作助手。根据用户目的起草一封结构完整、得体的中文邮件正文（含称呼与署名占位"[你的姓名]"）。只输出正文，不要解释。',
          messages: [{ role: 'user', content: `目的与要点：${args.purpose}\n语气：${args.tone || '正式客气'}` }],
          maxTokens: 1200,
        })
        return JSON.stringify({ draft, note: '这是草稿，未发送。请把草稿展示给用户，提示可复制到写邮件页面。' })
      } catch (err: any) {
        return JSON.stringify({ error: `起草失败: ${err.message}` })
      }
    }

    case 'navigate_to': {
      // 实际跳转由 renderer 拦截 tool_call 渲染为可点击卡片，这里只需确认
      return JSON.stringify({ ok: true, message: '跳转卡片已展示给用户。' })
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` })
  }
}

// ── AI call for agent loop (thin adapter over unified ai-client) ──

async function runAiCallWithTools(opts: {
  system: string
  messages: AiMessage[]
  tools?: any[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
}): Promise<{ content: string; toolCalls?: ToolCall[] }> {
  // Prepend system message and delegate to the unified client
  const allMessages: AiMessage[] = [
    { role: 'system', content: opts.system },
    ...opts.messages,
  ]

  return aiCall(allMessages, {
    tools: opts.tools,
    signal: opts.signal,
    onChunk: opts.onChunk,
    stream: true,
  })
}

// ── IPC registration ──

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

  ipcMain.handle('hwai:generate', async (event, params: any) => {
    try {
      return await generate(params, event.sender)
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

  ipcMain.handle('hwai:tutor-summary', async (event, courseId: string, kind: 'notifications' | 'files' | 'discussion', sessionId?: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const content = await summarizeCourseArea(courseId, kind, sessionId ? (delta) => {
        if (win && !win.isDestroyed()) win.webContents.send('hwai:generate-chunk', { sessionId, type: 'text', delta })
      } : undefined)
      if (sessionId && win && !win.isDestroyed()) win.webContents.send('hwai:generate-end', { sessionId })
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:tutor-ask', async (event, courseId: string, question: string, sessionId?: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const content = await askTutor(courseId, question, sessionId ? (delta) => {
        if (win && !win.isDestroyed()) win.webContents.send('hwai:generate-chunk', { sessionId, type: 'text', delta })
      } : undefined)
      if (sessionId && win && !win.isDestroyed()) win.webContents.send('hwai:generate-end', { sessionId })
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:abort', (_e, sessionId: string) => {
    abortGeneration(sessionId)
    const ctrl = abortControllers.get(sessionId)
    if (ctrl) {
      ctrl.abort()
      abortControllers.delete(sessionId)
    }
  })

  // ── Tutor agent chat (new in v2.0) ──

  ipcMain.handle('tutor:chat', async (event, params: {
    messages: { role: string; content: string; images?: string[] }[]
    courseId?: string
    style?: 'cute' | 'serious'
    sessionId: string
    pageContext?: { label?: string; courseId?: string; courseName?: string; itemTitle?: string; itemExcerpt?: string }
  }) => {
    const { messages: rawMessages, courseId, style = 'cute', sessionId, pageContext } = params
    // 历史裁剪：只带最近 12 条进上下文，更早的对话截断（控制 token）
    const messages = rawMessages.length > 12 ? rawMessages.slice(-12) : rawMessages
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)

    const ctrl = new AbortController()
    abortControllers.set(sessionId, ctrl)

    try {
      let courseContext: { name: string; teacher: string } | undefined
      if (courseId) {
        try {
          const courses: any[] = await withAuth(async (h) => {
            const sem = await h.getCurrentSemester()
            return h.getCourseList(String(sem.id), CourseType.STUDENT)
          })
          const course = courses.find((c: any) => (c.id || c.courseId) === courseId)
          if (course) {
            courseContext = {
              name: course.chineseName || course.name || '',
              teacher: course.teacherName || course.teacher || '',
            }
          }
        } catch { /* best-effort */ }
      }

      const onChunk: AgentChunkCallback = (chunk) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('hwai:generate-chunk', {
            sessionId,
            ...chunk,
          })
        }
      }

      const result = await runAgentLoop({
        messages: messages.map((m: any) => {
          // 带图片的 user 消息 → 中性多模态 content（ai-client 再按服务商转 image block）
          if (m.role === 'user' && Array.isArray(m.images) && m.images.length) {
            const parts: any[] = []
            if (m.content) parts.push({ type: 'text', text: m.content })
            for (const url of m.images) parts.push({ type: 'image', dataUrl: url })
            return { role: 'user' as const, content: parts }
          }
          return { role: m.role as 'user' | 'assistant', content: m.content }
        }),
        style,
        courseContext,
        pageContext,
        sessionId,
        signal: ctrl.signal,
        onChunk,
        executeTool: executeTutorTool,
        runAiCall: runAiCallWithTools,
      })

      // 错误必须可见：任何一轮 API/工具失败都直接写进聊天流，绝不静默吞掉
      if (result.finishReason === 'error' && result.error) {
        log.error('[tutor:chat] agent loop error:', result.error)
        onChunk({ type: 'text', delta: `\n\n⚠️ 对话出错：${result.error}` })
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send('hwai:generate-end', { sessionId, error: result.error })
      }

      return {
        finishReason: result.finishReason,
        error: result.error,
        messageCount: result.messages.length,
      }
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('hwai:generate-end', { sessionId, error: formatError(err) })
      }
      return { finishReason: 'error', error: formatError(err) }
    } finally {
      abortControllers.delete(sessionId)
    }
  })

  ipcMain.handle('tutor:abort', (_e, sessionId: string) => {
    const ctrl = abortControllers.get(sessionId)
    if (ctrl) {
      ctrl.abort()
      abortControllers.delete(sessionId)
    }
  })

  // ── 写邮件页"甘蔗代笔"：根据要点生成正文草稿（只生成，不发送）──
  ipcMain.handle('hwai:draft-mail', async (_e, params: { purpose: string; subject?: string }) => {
    try {
      const draft = await complete({
        system: '你是邮件写作助手。根据用户提供的主题与要点，起草一封结构完整、语气得体的中文邮件正文（含称呼与署名占位"[你的姓名]"）。只输出正文，不要任何解释。',
        messages: [{
          role: 'user',
          content: `邮件主题：${params.subject || '（未填写）'}\n目的与要点：${params.purpose}`,
        }],
        maxTokens: 1200,
      })
      return { ok: true, draft }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
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

  ipcMain.handle('hwai:health-check', async () => {
    try {
      const settings = loadAiSettings()
      if (!settings.apiKey) return { ok: false, error: 'API Key 未配置' }
      if (!settings.endpoint) return { ok: false, error: 'API Endpoint 未配置' }

      const headers = buildAiHeaders(settings.apiKey, settings.provider, settings.apiFormat)
      const body = JSON.stringify({ model: settings.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)

      const resp = await fetch(settings.endpoint, {
        method: 'POST', headers, body, signal: ctrl.signal,
      })
      clearTimeout(timer)

      if (!resp.ok) {
        const text = await resp.text()
        return { ok: false, error: `API 返回 ${resp.status}: ${text.slice(0, 200)}` }
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message || '连接失败' }
    }
  })

  ipcMain.handle('hwai:file-chat', async (event, req: {
    file: { name: string; url: string; fileType?: string }
    question: string
    history: { role: 'user' | 'assistant'; content: string }[]
    sessionId?: string
  }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const content = await askAboutFile(req.file, req.question, req.history || [], req.sessionId ? (delta) => {
        if (win && !win.isDestroyed()) win.webContents.send('hwai:generate-chunk', { sessionId: req.sessionId, type: 'text', delta })
      } : undefined)
      if (req.sessionId && win && !win.isDestroyed()) win.webContents.send('hwai:generate-end', { sessionId: req.sessionId })
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:summarize-file', async (event, file: { name: string; url: string; fileType?: string; sessionId?: string }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const content = await summarizeSingleFile(file, file.sessionId ? (delta) => {
        if (win && !win.isDestroyed()) win.webContents.send('hwai:generate-chunk', { sessionId: file.sessionId, type: 'text', delta })
      } : undefined)
      if (file.sessionId && win && !win.isDestroyed()) win.webContents.send('hwai:generate-end', { sessionId: file.sessionId })
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: formatError(err) }
    }
  })

  ipcMain.handle('hwai:orchestrate', async (event, req: any) => {
    const { analyzed, sessionId, outputFormat } = req
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)

    const ctrl = new AbortController()
    abortControllers.set(sessionId, ctrl)

    try {
      const result = await orchestrate({
        analyzed,
        sessionId,
        outputFormat,
        signal: ctrl.signal,
        onProgress: (chunk) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('hwai:orchestrate-chunk', { sessionId, ...chunk })
          }
        },
      })

      if (win && !win.isDestroyed()) {
        win.webContents.send('hwai:orchestrate-end', { sessionId, result })
      }

      return { ok: true, result }
    } catch (err: any) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('hwai:orchestrate-end', { sessionId, error: formatError(err) })
      }
      return { ok: false, error: formatError(err) }
    } finally {
      abortControllers.delete(sessionId)
    }
  })
}
