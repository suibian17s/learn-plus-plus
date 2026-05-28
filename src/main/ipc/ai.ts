import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { scan, analyze, generate, abortGeneration, buildHwAttachment } from '../services/homework-ai'
import { orchestrate } from '../services/homework-orchestrator'
import { askTutor, summarizeCourseArea, summarizeSingleFile } from '../services/tutor'
import { complete } from '../services/ai'
import { withAuth } from '../services/learn'
import { query as searchQuery } from '../services/search-index'
import { getMailList, getMailDetail, isMailLoggedIn } from '../services/mail-service'
import { formatError } from '../utils/errors'
import { getAiProviderPreset, normalizeCustomEndpoint, type AiApiFormat } from '../../shared/aiProviders'
import { loadApiKey } from '../services/secret-store'
import {
  runAgentLoop,
  type ToolCall,
  type AgentChunkCallback,
  type ToolExecutor,
} from '../services/tutor-agent'
import { CourseType } from 'thu-learn-lib'

// ── Abort controller store ──

const abortControllers = new Map<string, AbortController>()

// ── AI settings helpers (duplicated from services/ai.ts to keep it self-contained) ──

function loadAiSettings(): { provider: string; model: string; apiKey: string; endpoint: string; apiFormat: AiApiFormat } {
  try {
    const raw = fs.readFileSync(settingsFile, 'utf-8')
    const s = JSON.parse(raw)
    const provider = s.aiProvider || 'anthropic'
    const preset = getAiProviderPreset(provider)
    const apiFormat = (provider === 'custom' ? s.aiApiFormat : preset.apiFormat) || 'openai'
    const endpoint = provider === 'custom'
      ? normalizeCustomEndpoint(s.aiBaseUrl || '', apiFormat)
      : preset.endpoint
    return {
      provider,
      model: s.aiModel || preset.defaultModel || 'claude-sonnet-4-6',
      apiKey: loadApiKey(provider),
      endpoint,
      apiFormat,
    }
  } catch {
    const preset = getAiProviderPreset('anthropic')
    return {
      provider: 'anthropic',
      model: preset.defaultModel,
      apiKey: loadApiKey('anthropic'),
      endpoint: preset.endpoint,
      apiFormat: preset.apiFormat,
    }
  }
}

function buildAiHeaders(apiKey: string, provider: string, apiFormat: AiApiFormat): Record<string, string> {
  switch (apiFormat) {
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    default: {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://learnplusplus.local'
        headers['X-Title'] = 'learn++ 甘蔗 tutor'
      }
      return headers
    }
  }
}

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
        return JSON.stringify(list.map((hw: any) => ({
          id: hw.id,
          title: hw.title || '',
          submitted: !!hw.submitted,
          deadline: hw.deadline || '',
          description: (hw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
        })))
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
        // List homeworks for the course to give the AI context
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
        const statsFile = settingsFile.replace(/[^/\\]+$/, 'stats.json')
        let dailyMinutes: Record<string, number> = {}
        let lastActiveDate = ''
        try {
          const raw = fs.readFileSync(statsFile, 'utf-8')
          const data = JSON.parse(raw)
          dailyMinutes = data.dailyMinutes || {}
          lastActiveDate = data.lastActiveDate || ''
        } catch { /* no stats file yet */ }

        const today = new Date().toISOString().slice(0, 10)
        const todayMinutes = dailyMinutes[today] || 0
        const totalDays = Object.keys(dailyMinutes).length

        // Compute streak
        let streak = 0
        const d = new Date()
        while (true) {
          const key = d.toISOString().slice(0, 10)
          if (dailyMinutes[key]) {
            streak++
            d.setDate(d.getDate() - 1)
          } else {
            break
          }
        }

        // Course count
        let courseCount = 0
        try {
          const courses = await withAuth(async (h) => {
            const sem = await h.getCurrentSemester()
            return h.getCourseList(String(sem.id), CourseType.STUDENT)
          })
          courseCount = courses.length
        } catch { /* ignore */ }

        return JSON.stringify({
          todayMinutes,
          todayHours: (todayMinutes / 60).toFixed(1),
          totalActiveDays: totalDays,
          streak,
          courseCount,
          lastActiveDate: lastActiveDate || today,
        })
      } catch (err: any) {
        return JSON.stringify({ error: `获取统计数据失败: ${err.message}` })
      }
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` })
  }
}

// ── Custom AI call with tool support (handles both Anthropic and OpenAI) ──

async function runAiCallWithTools(opts: {
  system: string
  messages: any[]
  tools?: any[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
}): Promise<{ content: string; toolCalls?: ToolCall[] }> {
  const { provider, model, apiKey, endpoint, apiFormat } = loadAiSettings()

  if (!apiKey) throw new Error('AI API key not configured')
  if (!endpoint) throw new Error('AI API endpoint not configured')

  const headers = buildAiHeaders(apiKey, provider, apiFormat)
  const maxTokens = 4096

  let body: string

  if (apiFormat === 'anthropic') {
    // Anthropic native format
    const systemContent = [{ type: 'text', text: opts.system }]

    // Convert OpenAI-format tool definitions to Anthropic format
    const anthropicTools = opts.tools?.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    // Build messages array - handle tool_call and tool role messages
    const anthropicMessages = opts.messages.map((m: any) => {
      if (m.role === 'user' || m.role === 'assistant') {
        return {
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
        }
      }
      // Convert tool role messages to user messages with tool result content
      if ((m as any).role === 'tool' || (m as any).tool_call_id) {
        return {
          role: 'user' as const,
          content: `[工具返回结果]\n${m.content || ''}`,
        }
      }
      return { role: 'user' as const, content: String(m.content || '') }
    })

    const bodyObj: any = {
      model,
      max_tokens: maxTokens,
      system: systemContent,
      messages: anthropicMessages,
      stream: true,
    }

    if (anthropicTools?.length) {
      bodyObj.tools = anthropicTools
    }

    body = JSON.stringify(bodyObj)
  } else {
    // OpenAI-compatible format
    const fullMessages: any[] = [
      { role: 'system', content: opts.system },
    ]

    for (const m of opts.messages) {
      if (m.role === 'assistant' && (m as any).tool_calls) {
        fullMessages.push({
          role: 'assistant',
          content: m.content || '',
          tool_calls: (m as any).tool_calls,
        })
      } else if (m.role === 'user') {
        fullMessages.push({
          role: 'user',
          content: typeof m.content === 'string' ? m.content : m.content,
        })
      } else {
        // Skip tool-role messages for OpenAI format (tool results are embedded in user messages)
        fullMessages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
        })
      }
    }

    const bodyObj: any = {
      model,
      max_tokens: maxTokens,
      messages: fullMessages,
      stream: true,
    }

    if (opts.tools?.length) {
      bodyObj.tools = opts.tools
      bodyObj.tool_choice = 'auto'
    }

    body = JSON.stringify(bodyObj)
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
    signal: opts.signal,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`AI API error ${resp.status}: ${text}`)
  }

  if (!resp.body) throw new Error('No response body')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const toolCallMap = new Map<number, ToolCall>()

  function applyOpenAiToolDelta(delta: any): void {
    const calls = delta?.tool_calls || []
    for (const call of calls) {
      const index = call.index || 0
      const current = toolCallMap.get(index) || {
        id: call.id || `tool-${index}`,
        function: { name: '', arguments: '' },
      }
      if (call.id) current.id = call.id
      if (call.function?.name) current.function.name += call.function.name
      if (call.function?.arguments) current.function.arguments += call.function.arguments
      toolCallMap.set(index, current)
    }
  }

  let anthropicToolIndex: number | null = null

  function applyAnthropicEvent(parsed: any): void {
    if (parsed?.type === 'content_block_start' && parsed?.content_block?.type === 'tool_use') {
      const index = parsed.index || 0
      anthropicToolIndex = index
      toolCallMap.set(index, {
        id: parsed.content_block.id || `tool-${index}`,
        function: {
          name: parsed.content_block.name || '',
          arguments: '',
        },
      })
      return
    }
    if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'input_json_delta') {
      const index = parsed.index ?? anthropicToolIndex ?? 0
      const current = toolCallMap.get(index)
      if (current) current.function.arguments += parsed.delta.partial_json || ''
      return
    }
    const delta = parsed?.delta?.text || parsed?.content_block?.text || ''
    if (delta) {
      fullText += delta
      opts.onChunk?.(delta)
    }
  }

  function handleData(data: string): void {
    if (!data || data === '[DONE]') return
    try {
      const parsed = JSON.parse(data)
      if (apiFormat === 'anthropic') {
        applyAnthropicEvent(parsed)
        return
      }

      const delta = parsed?.choices?.[0]?.delta
      const text = delta?.content || ''
      if (text) {
        fullText += text
        opts.onChunk?.(text)
      }
      applyOpenAiToolDelta(delta)
    } catch {
      // Ignore malformed stream fragments.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const data = part.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      handleData(data)
    }
  }

  if (buffer.trim()) {
    const data = buffer.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    handleData(data)
  }

  const toolCalls = Array.from(toolCallMap.values()).filter((call) => call.function.name)

  return { content: fullText, toolCalls: toolCalls.length ? toolCalls : undefined }
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
    // Also abort any tutor chat session with the same ID
    const ctrl = abortControllers.get(sessionId)
    if (ctrl) {
      ctrl.abort()
      abortControllers.delete(sessionId)
    }
  })

  // ── Tutor agent chat (new in v2.0) ──

  ipcMain.handle('tutor:chat', async (event, params: {
    messages: { role: string; content: string }[]
    courseId?: string
    style?: 'cute' | 'serious'
    sessionId: string
  }) => {
    const { messages, courseId, style = 'cute', sessionId } = params
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)

    // Create abort controller for this session
    const ctrl = new AbortController()
    abortControllers.set(sessionId, ctrl)

    try {
      // Build course context if courseId is provided
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
        messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        style,
        courseContext,
        sessionId,
        signal: ctrl.signal,
        onChunk,
        executeTool: executeTutorTool,
        runAiCall: runAiCallWithTools,
      })

      if (win && !win.isDestroyed()) {
        win.webContents.send('hwai:generate-end', { sessionId })
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
