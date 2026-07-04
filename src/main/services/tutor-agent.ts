import type { AiMessage } from './ai'
import { buildTutorSystemPrompt } from './tutor-prompts'

// ── Exported types ──

export interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

export interface AgentChunkCallback {
  (chunk:
    | { type: 'text'; delta: string }
    | { type: 'tool_call'; call: ToolCall }
    | { type: 'tool_result'; name: string; result: string }): void
}

export type ToolExecutor = (name: string, args: Record<string, any>) => Promise<string>

// ── Tool definitions (OpenAI function-calling format) ──

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_courses',
      description: '列出当前学期所有课程',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_homeworks',
      description: '列出某课程的所有作业，含提交状态、得分/等级、批阅评语与批阅人',
      parameters: {
        type: 'object',
        properties: { courseId: { type: 'string', description: '课程ID' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_emails',
      description: '列出邮件，默认收件箱',
      parameters: {
        type: 'object',
        properties: { folder: { type: 'string', enum: ['inbox', 'sent', 'drafts', 'trash'] } },
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
        properties: { query: { type: 'string', description: '搜索关键词' } },
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
        properties: { mailId: { type: 'string', description: '邮件ID' } },
        required: ['mailId'],
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
        properties: { courseId: { type: 'string', description: '课程ID' } },
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
        properties: { courseId: { type: 'string', description: '课程ID' } },
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
        properties: { courseId: { type: 'string', description: '课程ID' } },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'summarize_content',
      description: '总结指定的文本内容',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '需要总结的内容' },
          kind: { type: 'string', description: '内容类型：notifications/files/discussion' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'complete_homework',
      description: '帮助完成指定课程的作业',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程ID' },
          homeworkId: { type: 'string', description: '作业ID（可选，不指定则列出可选作业）' },
        },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_global',
      description: '全局搜索课程、作业、课件、公告、讨论、邮件',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '搜索关键词' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stats',
      description: '获取学习统计数据（今日学习时长、连续天数、课程进度等）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_file_content',
      description: '下载并解析某课件的全文内容（支持 PDF/PPT/DOCX/TXT），用于讲解课件、基于课件出题或回答课件相关问题',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程ID' },
          fileId: { type: 'string', description: '课件ID（来自 list_files 结果）' },
        },
        required: ['courseId', 'fileId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_homework_detail',
      description: '获取某作业的完整信息：要求全文、附件解析文本、截止时间与提交状态',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程ID' },
          homeworkId: { type: 'string', description: '作业ID（来自 list_homeworks 结果）' },
        },
        required: ['courseId', 'homeworkId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_notice_detail',
      description: '获取某公告的全文内容',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程ID' },
          noticeId: { type: 'string', description: '公告ID（来自 list_notices 结果）' },
        },
        required: ['courseId', 'noticeId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_deadlines',
      description: '获取全部课程的待办与截止日期快照（毫秒级返回，回答"我最近/本周要交什么"必用）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_focus_item',
      description: '把一个任务加入用户首页的"今日重点"列表',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务标题' },
          description: { type: 'string', description: '来源或补充说明（可选）' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draft_mail',
      description: '为用户起草一封邮件正文（只生成草稿文本返回给用户，绝不会实际发送）',
      parameters: {
        type: 'object',
        properties: {
          purpose: { type: 'string', description: '邮件目的与要点，例如"向张老师请假，周三有病假条"' },
          tone: { type: 'string', description: '语气：正式/客气/简洁（可选）' },
        },
        required: ['purpose'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'navigate_to',
      description: '在回答中给用户一张可点击的跳转卡片。涉及具体课程/作业/课件/邮件时主动使用',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '卡片显示文字，例如"经济学原理 · 作业"' },
          courseId: { type: 'string', description: '课程ID（跳转课程页时必填）' },
          tab: { type: 'string', description: 'notifications/files/homework/discussion/questionnaire，或 mailbox/home' },
        },
        required: ['label', 'tab'],
      },
    },
  },
]

// ── AI response parser ──

export type AiApiFormat = 'anthropic' | 'openai'

export function parseAiToolResponse(
  raw: string,
  apiFormat: AiApiFormat,
): { content: string; toolCalls?: ToolCall[] } {
  try {
    const parsed = JSON.parse(raw)
    if (apiFormat === 'anthropic') {
      const blocks: any[] = Array.isArray(parsed.content) ? parsed.content : []
      const textBlocks = blocks.filter((b: any) => b.type === 'text')
      const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use')
      const content = textBlocks.map((b: any) => b.text || '').join('')
      const toolCalls: ToolCall[] = toolBlocks.map((b: any) => ({
        id: b.id || '',
        function: {
          name: b.name || '',
          arguments: JSON.stringify(b.input || {}),
        },
      }))
      return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
    }

    // OpenAI-compatible format
    const msg = parsed.choices?.[0]?.message || {}
    const content: string =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text || '')
              .join('')
          : ''
    const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc: any) => ({
      id: tc.id || '',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      },
    }))
    return { content, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined }
  } catch {
    return { content: raw }
  }
}

// ── Pluggable agent loop ──

export async function runAgentLoop(params: {
  messages: AiMessage[]
  style: 'cute' | 'serious'
  courseContext?: { name: string; teacher: string }
  pageContext?: import('./tutor-prompts').TutorPageContext
  sessionId: string
  signal?: AbortSignal
  onChunk: AgentChunkCallback
  executeTool: ToolExecutor
  runAiCall: (opts: {
    system: string
    messages: AiMessage[]
    tools?: any[]
    signal?: AbortSignal
    onChunk?: (delta: string) => void
  }) => Promise<{ content: string; toolCalls?: ToolCall[] }>
}): Promise<{ messages: AiMessage[]; finishReason: 'stop' | 'abort' | 'error'; error?: string }> {
  const { messages, style, courseContext, pageContext, signal, onChunk, executeTool, runAiCall } = params
  const system = buildTutorSystemPrompt(style, courseContext, pageContext)

  const updatedMessages = [...messages]
  let loopCount = 0
  const MAX_LOOPS = 8

  try {
    while (loopCount < MAX_LOOPS) {
      if (signal?.aborted) return { messages: updatedMessages, finishReason: 'abort' }
      loopCount++

      const result = await runAiCall({
        system,
        messages: updatedMessages,
        tools: TOOLS,
        signal,
        onChunk: (delta) => onChunk({ type: 'text', delta }),
      })

      // No tool calls -- conversation complete
      if (!result.toolCalls || result.toolCalls.length === 0) {
        updatedMessages.push({ role: 'assistant', content: result.content })
        return { messages: updatedMessages, finishReason: 'stop' }
      }

      // Record assistant message with tool calls（补全 OpenAI 协议必需的 type 字段）
      const assistantMsg: AiMessage = {
        role: 'assistant',
        content: result.content || '',
      }
      ;(assistantMsg as any).tool_calls = result.toolCalls.map((tc) => ({
        type: 'function' as const,
        id: tc.id,
        function: tc.function,
      }))
      updatedMessages.push(assistantMsg)

      for (const call of result.toolCalls) {
        if (signal?.aborted) return { messages: updatedMessages, finishReason: 'abort' }

        onChunk({ type: 'tool_call', call })

        let toolResult: string
        try {
          const args = JSON.parse(call.function.arguments || '{}')
          // 30 秒工具超时兜底：任何工具挂起都不允许卡死整个对话
          toolResult = await Promise.race([
            executeTool(call.function.name, args),
            new Promise<string>((resolve) =>
              setTimeout(() => resolve(JSON.stringify({ error: `工具 ${call.function.name} 执行超时（30s）` })), 30000),
            ),
          ])
        } catch (err: any) {
          toolResult = `Error: ${err.message}`
        }

        onChunk({ type: 'tool_result', name: call.function.name, result: toolResult })

        updatedMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult,
        } as AiMessage)
      }
    }

    // MAX_LOOPS reached — notify the user
    const truncationNotice = '\n\n*(已达到对话轮次上限，Tutor 已完成本轮思考)*'
    onChunk({ type: 'text', delta: truncationNotice })
    return { messages: updatedMessages, finishReason: 'stop' }
  } catch (err: any) {
    return { messages: updatedMessages, finishReason: 'error', error: err.message }
  }
}
