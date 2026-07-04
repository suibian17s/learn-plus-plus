// Thin wrappers around the unified ai-client.
// All real logic lives in ./ai-client.ts

import { aiCall, type AiMessage as AiClientMessage } from './ai-client'

// ── Public types (backward-compatible) ──

export type AiMessage = AiClientMessage

export interface AiCompleteOptions {
  system: string
  messages: AiClientMessage[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  maxTokens?: number
}

// ── Implementation ──

export async function complete(options: AiCompleteOptions): Promise<string> {
  const messages: AiClientMessage[] = [
    { role: 'system', content: options.system },
    ...options.messages,
  ]

  const result = await aiCall(messages, {
    signal: options.signal,
    onChunk: options.onChunk,
    maxTokens: options.maxTokens,
    stream: true,
  })

  return result.content
}
