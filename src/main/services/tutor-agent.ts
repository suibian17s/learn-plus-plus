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
      description: '列出某课程的所有作业',
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
  const { messages, style, courseContext, signal, onChunk, executeTool, runAiCall } = params
  const system = buildTutorSystemPrompt(style, courseContext)

  const updatedMessages = [...messages]
  let loopCount = 0
  const MAX_LOOPS = 5

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

      // Record assistant message with tool calls
      const assistantMsg: AiMessage = {
        role: 'assistant',
        content: result.content || '',
      }
      ;(assistantMsg as any).tool_calls = result.toolCalls
      updatedMessages.push(assistantMsg)

      for (const call of result.toolCalls) {
        if (signal?.aborted) return { messages: updatedMessages, finishReason: 'abort' }

        onChunk({ type: 'tool_call', call })

        let toolResult: string
        try {
          const args = JSON.parse(call.function.arguments || '{}')
          toolResult = await executeTool(call.function.name, args)
        } catch (err: any) {
          toolResult = `Error: ${err.message}`
        }

        onChunk({ type: 'tool_result', name: call.function.name, result: toolResult })

        updatedMessages.push({
          role: 'user',
          content: `[工具 ${call.function.name} 返回结果]\n${toolResult}`,
        })
      }
    }

    return { messages: updatedMessages, finishReason: 'stop' }
  } catch (err: any) {
    return { messages: updatedMessages, finishReason: 'error', error: err.message }
  }
}
