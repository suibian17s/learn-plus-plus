import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { loadApiKey } from './secret-store'
import {
  getAiProviderPreset,
  normalizeCustomEndpoint,
} from '../../shared/aiProviders'
import type { AiApiFormat } from '../../shared/aiProviders'
import { toOpenAiContent, toAnthropicContent } from './ai-content'

export { toOpenAiContent, toAnthropicContent }

// ── Protocol-agnostic types ──

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | any[]
  /** OpenAI-style tool calls on assistant messages */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** Required on role:'tool' messages to match the assistant tool_call id */
  tool_call_id?: string
}

export interface AiCallOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: any[]
  signal?: AbortSignal
  stream?: boolean
  onChunk?: (delta: string) => void
}

export interface AiCallResult {
  content: string
  toolCalls?: Array<{
    id: string
    function: { name: string; arguments: string }
  }>
}

// ── Internal helpers ──

interface AiSettings {
  provider: string
  model: string
  apiKey: string
  endpoint: string
  apiFormat: AiApiFormat
}

function loadAiSettings(): AiSettings {
  try {
    const raw = fs.readFileSync(settingsFile, 'utf-8')
    const s = JSON.parse(raw)
    const provider = s.aiProvider || 'anthropic'
    const preset = getAiProviderPreset(provider)
    const apiFormat =
      (provider === 'custom' ? s.aiApiFormat : preset.apiFormat) || 'openai'
    const endpoint =
      provider === 'custom'
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

function buildAiHeaders(
  apiKey: string,
  provider: string,
  apiFormat: AiApiFormat,
): Record<string, string> {
  if (apiFormat === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
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

// ── Body builders ──

// toOpenAiContent / toAnthropicContent 现抽到 ./ai-content.ts（纯函数、无 electron 依赖，便于单测）。
// 这里通过顶部 re-export 保持对外接口不变。

function buildOpenAiBody(
  messages: AiMessage[],
  model: string,
  maxTokens: number,
  tools?: any[],
  stream = true,
): string {
  const bodyMessages: any[] = messages.map((m) => {
    const msg: any = { role: m.role, content: toOpenAiContent(m.content) }
    if (m.tool_calls) {
      // OpenAI 协议要求每个 tool_call 必须带 type:"function"（DeepSeek 等严格校验，缺失即 400）
      msg.tool_calls = m.tool_calls.map((tc: any) => ({ ...tc, type: tc.type || 'function' }))
    }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
    return msg
  })

  const body: any = {
    model,
    max_tokens: maxTokens,
    messages: bodyMessages,
    stream,
  }

  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  return JSON.stringify(body)
}

function buildAnthropicBody(
  messages: AiMessage[],
  model: string,
  maxTokens: number,
  tools?: any[],
  stream = true,
): string {
  // Extract system messages into the top-level system field
  const systemParts: string[] = []
  const conversationMessages: any[] = []

  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : ''
      if (text) systemParts.push(text)
      continue
    }

    if (m.role === 'assistant' && m.tool_calls) {
      // Convert OpenAI-style tool_calls to Anthropic tool_use content blocks
      const textContent = typeof m.content === 'string' ? m.content : ''
      const contentBlocks: any[] = []
      if (textContent) contentBlocks.push({ type: 'text', text: textContent })
      for (const tc of m.tool_calls) {
        let input: any = {}
        try {
          input = JSON.parse(tc.function.arguments || '{}')
        } catch {
          // Keep empty object on parse failure
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        })
      }
      conversationMessages.push({ role: 'assistant', content: contentBlocks })
      continue
    }

    if (m.role === 'tool' && m.tool_call_id) {
      // Convert role:'tool' messages to Anthropic tool_result content blocks
      const text =
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content)
      conversationMessages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: m.tool_call_id, content: text },
        ],
      })
      continue
    }

    // Regular user / assistant message（含中性图片元素 → anthropic image block）
    conversationMessages.push({
      role: m.role,
      content: toAnthropicContent(m.content),
    })
  }

  const body: any = {
    model,
    max_tokens: maxTokens,
    messages: conversationMessages,
    stream,
  }

  if (systemParts.length > 0) {
    body.system = systemParts.map((t) => ({
      type: 'text',
      text: t,
      cache_control: { type: 'ephemeral' },
    }))
  }

  // Convert OpenAI-format tools to Anthropic format
  if (tools?.length) {
    body.tools = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }

  return JSON.stringify(body)
}

// ── SSE streaming with cross-chunk buffering (B3 fix) ──

async function streamSseResponse(
  response: Response,
  apiFormat: AiApiFormat,
  onChunk?: (delta: string) => void,
): Promise<AiCallResult> {
  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  const toolCallMap = new Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >()
  let anthropicToolIndex: number | null = null

  function processData(data: string): void {
    if (!data || data === '[DONE]') return
    try {
      const parsed = JSON.parse(data)

      if (apiFormat === 'anthropic') {
        // content_block_start: track new tool_use block
        if (
          parsed?.type === 'content_block_start' &&
          parsed?.content_block?.type === 'tool_use'
        ) {
          const index = parsed.index || 0
          anthropicToolIndex = index
          toolCallMap.set(index, {
            id: parsed.content_block.id || `tool-${index}`,
            function: { name: parsed.content_block.name || '', arguments: '' },
          })
          return
        }

        // content_block_start: text block started (text arrives in deltas)
        if (
          parsed?.type === 'content_block_start' &&
          parsed?.content_block?.type === 'text'
        ) {
          return
        }

        // content_block_delta: accumulate input_json_delta
        if (
          parsed?.type === 'content_block_delta' &&
          parsed?.delta?.type === 'input_json_delta'
        ) {
          const index = parsed.index ?? anthropicToolIndex ?? 0
          const current = toolCallMap.get(index)
          if (current) {
            current.function.arguments += parsed.delta.partial_json || ''
          }
          return
        }

        // Generic text delta fallback
        const delta = parsed?.delta?.text || ''
        if (delta) {
          fullText += delta
          onChunk?.(delta)
        }
        return
      }

      // ── OpenAI / compatible format ──
      const choice = parsed?.choices?.[0]
      const delta = choice?.delta
      const text = delta?.content || ''
      if (text) {
        fullText += text
        onChunk?.(text)
      }

      // Track streaming tool calls
      const toolDeltas: any[] = delta?.tool_calls || []
      for (const call of toolDeltas) {
        const index = call.index ?? 0
        const current = toolCallMap.get(index) || {
          id: call.id || `tool-${index}`,
          function: { name: '', arguments: '' },
        }
        if (call.id) current.id = call.id
        if (call.function?.name) current.function.name += call.function.name
        if (call.function?.arguments)
          current.function.arguments += call.function.arguments
        toolCallMap.set(index, current)
      }
    } catch {
      // Skip unparseable SSE fragments gracefully
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // B3 FIX: accumulate across raw TCP chunks so partial SSE events are not dropped
    buffer += decoder.decode(value, { stream: true })

    // Split on SSE event delimiter (double newline)
    const events = buffer.split('\n\n')
    // Keep the incomplete trailing event in the buffer
    buffer = events.pop() || ''

    for (const eventBlock of events) {
      // Each SSE event may contain multiple data: lines; join them
      const data = eventBlock
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      processData(data)
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim()) {
    const data = buffer
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    processData(data)
  }

  // Flush decoder
  decoder.decode()

  const toolCalls = Array.from(toolCallMap.values()).filter(
    (tc) => tc.function.name,
  )

  return {
    content: fullText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

// ── Non-streaming response parsing ──

async function parseNonStreamingResponse(
  response: Response,
  apiFormat: AiApiFormat,
): Promise<AiCallResult> {
  const raw = await response.text()

  try {
    const parsed = JSON.parse(raw)

    if (apiFormat === 'anthropic') {
      const blocks: any[] = Array.isArray(parsed.content)
        ? parsed.content
        : []
      const textBlocks = blocks.filter((b: any) => b.type === 'text')
      const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use')

      return {
        content: textBlocks.map((b: any) => b.text || '').join(''),
        toolCalls:
          toolBlocks.length > 0
            ? toolBlocks.map((b: any) => ({
                id: b.id || '',
                function: {
                  name: b.name || '',
                  arguments: JSON.stringify(b.input || {}),
                },
              }))
            : undefined,
      }
    }

    // OpenAI / compatible format
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
    const toolCalls: AiCallResult['toolCalls'] = msg.tool_calls?.map(
      (tc: any) => ({
        id: tc.id || '',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
        },
      }),
    )

    return {
      content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    }
  } catch {
    return { content: raw }
  }
}

// ── Public API ──

export async function aiCall(
  messages: AiMessage[],
  options: AiCallOptions = {},
): Promise<AiCallResult> {
  const settings = loadAiSettings()

  const model = options.model || settings.model
  const apiKey = settings.apiKey
  const endpoint = settings.endpoint
  const apiFormat = settings.apiFormat
  const maxTokens = options.maxTokens || 4096
  const stream = options.stream !== false // default to streaming

  if (!apiKey) throw new Error('AI API key not configured')
  if (!endpoint) throw new Error('AI API endpoint not configured')

  const headers = buildAiHeaders(apiKey, settings.provider, apiFormat)

  let body: string
  if (apiFormat === 'anthropic') {
    body = buildAnthropicBody(messages, model, maxTokens, options.tools, stream)
  } else {
    body = buildOpenAiBody(messages, model, maxTokens, options.tools, stream)
  }

  // 180 秒请求超时兜底：网络/服务端挂起不允许卡死调用方
  const timeoutSignal = AbortSignal.timeout(180000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`AI API error ${resp.status}: ${text}`)
  }

  if (stream) {
    return streamSseResponse(resp, apiFormat, options.onChunk)
  }

  return parseNonStreamingResponse(resp, apiFormat)
}

// Re-export loadAiSettings for health-check and other diagnostic callers
export { loadAiSettings, buildAiHeaders }
