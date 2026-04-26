import fs from 'fs'
import { settingsFile } from '../utils/paths'
import { loadApiKey } from './secret-store'
import { getAiProviderPreset, normalizeCustomEndpoint, type AiApiFormat } from '../../shared/aiProviders'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[]
}

export interface AiCompleteOptions {
  system: string
  messages: AiMessage[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  maxTokens?: number
}

export interface AiMultimodalOptions {
  system: string
  messages: AiMessage[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  maxTokens?: number
}

export type AiProvider = 'anthropic' | 'openai' | 'custom'

function loadSettings(): { provider: string; model: string; apiKey: string; endpoint: string; apiFormat: AiApiFormat } {
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

function buildHeaders(apiKey: string, provider: string, apiFormat: AiApiFormat): Record<string, string> {
  switch (apiFormat) {
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    default:
      {
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

function buildAnthropicBody(model: string, system: string, messages: AiMessage[], maxTokens: number): string {
  const systemMsg = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  const userMsgs = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : m.content,
  }))
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemMsg,
    messages: userMsgs,
    stream: true,
  })
}

function buildOpenAiBody(model: string, system: string, messages: AiMessage[], maxTokens: number): string {
  const fullMessages = [
    { role: 'system', content: system },
    ...messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    })),
  ]
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: fullMessages,
    stream: true,
  })
}

async function streamComplete(
  endpoint: string,
  headers: Record<string, string>,
  body: string,
  apiFormat: AiApiFormat,
  signal?: AbortSignal,
  onChunk?: (delta: string) => void,
): Promise<string> {
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

  if (!resp.body) throw new Error('No response body')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        let delta = ''

        if (apiFormat === 'anthropic') {
          delta = parsed?.delta?.text || parsed?.content_block?.text || ''
          if (parsed?.type === 'content_block_delta' && parsed?.delta?.text) {
            delta = parsed.delta.text
          }
        } else {
          delta = parsed?.choices?.[0]?.delta?.content || ''
        }

        if (delta) {
          fullText += delta
          onChunk?.(delta)
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  return fullText
}

export async function complete(options: AiCompleteOptions): Promise<string> {
  const { provider, model, apiKey, endpoint, apiFormat } = loadSettings()
  if (!apiKey) throw new Error('AI API key not configured')
  if (!endpoint) throw new Error('AI API endpoint not configured')

  const headers = buildHeaders(apiKey, provider, apiFormat)
  const maxTokens = options.maxTokens || 4096

  let body: string
  if (apiFormat === 'anthropic') {
    body = buildAnthropicBody(model, options.system, options.messages, maxTokens)
  } else {
    body = buildOpenAiBody(model, options.system, options.messages, maxTokens)
  }

  return streamComplete(endpoint, headers, body, apiFormat, options.signal, options.onChunk)
}

export async function completeMultimodal(options: AiMultimodalOptions): Promise<string> {
  return complete(options)
}
