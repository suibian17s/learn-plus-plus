import { buildTutorSystemPrompt } from './tutor-prompts'
import { complete, completeNonStreaming } from './ai'
import { withAuth } from './learn'
import type { AiMessage } from './ai'

// ── Tool definitions (OpenAI-compatible function calling format) ──

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_courses',
      description: '列出当前账号的所有课程',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_homeworks',
      description: '列出某门课程的所有作业',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string', description: '课程 ID' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_emails',
      description: '列出邮件（支持文件夹参数：inbox/sent/drafts/trash）',
      parameters: {
        type: 'object',
        properties: { folder: { type: 'string', enum: ['inbox', 'sent', 'drafts', 'trash'] } },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_emails',
      description: '搜索邮件',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_email',
      description: '获取邮件详情',
      parameters: {
        type: 'object',
        properties: { emailId: { type: 'string' } },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: '列出课程课件',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_notices',
      description: '列出课程公告',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_discussions',
      description: '列出课程讨论',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'summarize_content',
      description: '总结指定类型的内容（公告/课件/讨论）',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['notifications', 'files', 'discussion'] },
          courseId: { type: 'string' },
        },
        required: ['type', 'courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'complete_homework',
      description: '帮助完成作业（生成参考草稿）',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string' }, homeworkId: { type: 'string' } },
        required: ['courseId', 'homeworkId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_global',
      description: '全局搜索所有内容',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stats',
      description: '获取学习统计（学习时长、课程进度等）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

// ── Tool execution ──

async function executeToolCall(
  name: string,
  args: Record<string, any>,
): Promise<string> {
  switch (name) {
    case 'list_courses': {
      return withAuth(async (h) => {
        const semester = await h.getCurrentSemester()
        const courses = await h.getCourseList(semester.id)
        return JSON.stringify(courses.map((c: any) => ({
          id: c.id,
          name: c.name,
          teacher: c.teacher,
          semester: semester.id,
        })))
      })
    }

    case 'list_homeworks': {
      return withAuth(async (h) => {
        const list = await h.getHomeworkList(args.courseId)
        return JSON.stringify(list.map((hw: any) => ({
          id: hw.id,
          title: hw.title,
          status: hw.submitted ? '已提交' : '未提交',
          deadline: hw.deadline,
          description: (hw.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
        })))
      })
    }

    case 'list_emails':
    case 'search_emails':
    case 'get_email': {
      return JSON.stringify({ message: '邮件功能正在开发中，即将在 v2.0 后续更新中接入。', placeholder: true })
    }

    case 'list_files': {
      return withAuth(async (h) => {
        const files = await h.getFileList(args.courseId)
        return JSON.stringify(files.slice(0, 30).map((f: any) => ({
          id: f.id,
          name: f.title || f.name,
          fileType: f.fileType,
          uploadTime: f.uploadTime,
          size: f.size || f.rawSize,
        })))
      })
    }

    case 'list_notices': {
      return withAuth(async (h) => {
        const notices = await h.getNotificationList(args.courseId)
        return JSON.stringify(notices.slice(0, 15).map((n: any) => ({
          id: n.id,
          title: n.title,
          publisher: n.publisher,
          publishTime: n.publishTime,
          summary: (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        })))
      })
    }

    case 'list_discussions': {
      return withAuth(async (h) => {
        const discussions = await h.getDiscussionList(args.courseId)
        return JSON.stringify(discussions.slice(0, 20).map((d: any) => ({
          id: d.id,
          title: d.title,
          author: d.publisherName || d.author,
          replyCount: d.replyCount,
          publishTime: d.publishTime,
        })))
      })
    }

    case 'summarize_content': {
      return JSON.stringify({
        message: '内容总结功能需通过专门的总结接口调用。请引导学生在对应页面（课件/公告/讨论）使用"甘蔗 Tutor 总结"按钮获取详细总结。',
      })
    }

    case 'complete_homework': {
      return JSON.stringify({
        message: '作业辅助功能需通过专门的作业自动完成流程使用。请引导学生在作业页面使用"一键完成作业"功能，该功能会扫描未提交作业、分析类型并生成参考草稿。',
        courseId: args.courseId,
        homeworkId: args.homeworkId,
      })
    }

    case 'search_global': {
      return JSON.stringify({ message: '全局搜索功能开发中，即将在 v2.0 后续更新中接入。', placeholder: true })
    }

    case 'get_stats': {
      return JSON.stringify({ message: '学习统计功能开发中，即将在 v2.0 后续更新中接入学习仪表盘。', placeholder: true })
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` })
  }
}

// ── Response parser ──

interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

function parseToolCalls(rawJson: string): { content: string | null; toolCalls: ToolCall[] | null } {
  try {
    const parsed = JSON.parse(rawJson)
    const choice = parsed?.choices?.[0]?.message
    if (!choice) return { content: null, toolCalls: null }

    const toolCalls: ToolCall[] | null = choice.tool_calls?.map((tc: any) => ({
      id: tc.id || '',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      },
    })) || null

    return {
      content: choice.content || null,
      toolCalls: toolCalls?.length ? toolCalls : null,
    }
  } catch {
    // The response is plain text (not JSON) — return as content
    return { content: rawJson, toolCalls: null }
  }
}

// ── Run agent chat ──

export interface AgentChatOptions {
  messages: { role: string; content: string }[]
  style: 'cute' | 'serious'
  courseContext?: { name: string; teacher: string }
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  maxRounds?: number
}

export async function runAgentChat(options: AgentChatOptions): Promise<{
  finalContent: string
  toolCallsMade: number
}> {
  const { messages, style, courseContext, signal, onChunk } = options
  const maxRounds = options.maxRounds || 5
  const systemPrompt = buildTutorSystemPrompt(style, courseContext)

  const conversationMessages: AiMessage[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  let toolCallsMade = 0

  for (let round = 0; round < maxRounds; round++) {
    // Non-streaming call with tool definitions
    const rawResponse = await completeNonStreaming({
      system: systemPrompt,
      messages: conversationMessages,
      tools: TOOLS,
      signal,
      maxTokens: 4096,
    })

    const { content, toolCalls } = parseToolCalls(rawResponse)

    if (toolCalls && toolCalls.length > 0) {
      // Execute each tool call
      const toolResults: { tool_call_id: string; content: string }[] = []

      for (const tc of toolCalls) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* use empty args */ }

        const result = await executeToolCall(tc.function.name, args)
        toolResults.push({ tool_call_id: tc.id, content: result })
      }

      toolCallsMade += toolCalls.length

      // Add assistant message with tool_calls
      conversationMessages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      } as any)

      // Add tool result messages
      for (const tr of toolResults) {
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        } as any)
      }

      continue
    }

    // No tool calls: final text response. Stream it to renderer.
    const finalText = content || ''
    if (onChunk && finalText) {
      const chunkSize = 8
      for (let i = 0; i < finalText.length; i += chunkSize) {
        if (signal?.aborted) break
        onChunk(finalText.slice(i, i + chunkSize))
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    return { finalContent: finalText, toolCallsMade }
  }

  // Max rounds reached: get final text via streaming
  const finalResponse = await complete({
    system: systemPrompt,
    messages: conversationMessages,
    signal,
    maxTokens: 2048,
    onChunk,
  })

  return { finalContent: finalResponse, toolCallsMade }
}
