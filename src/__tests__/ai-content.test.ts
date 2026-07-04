import { describe, it, expect } from 'vitest'
import { toOpenAiContent, toAnthropicContent } from '../main/services/ai-content'

describe('toOpenAiContent', () => {
  it('passes plain strings through unchanged', () => {
    expect(toOpenAiContent('hello')).toBe('hello')
  })

  it('passes null / non-array through unchanged', () => {
    expect(toOpenAiContent(null)).toBeNull()
    expect(toOpenAiContent({ type: 'text', text: 'x' })).toEqual({ type: 'text', text: 'x' })
  })

  it('converts neutral image parts to OpenAI image_url blocks', () => {
    const out = toOpenAiContent([
      { type: 'text', text: '看这道题' },
      { type: 'image', dataUrl: 'data:image/png;base64,abc' },
    ]) as any[]
    expect(out[0]).toEqual({ type: 'text', text: '看这道题' })
    expect(out[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } })
  })

  it('preserves existing standard-format parts unchanged', () => {
    const existing = { type: 'image_url', image_url: { url: 'x' } }
    expect(toOpenAiContent([existing])).toEqual([existing])
  })

  it('uses empty string for missing text', () => {
    expect(toOpenAiContent([{ type: 'text' }])).toEqual([{ type: 'text', text: '' }])
  })
})

describe('toAnthropicContent', () => {
  it('wraps a plain string into a single text block', () => {
    expect(toAnthropicContent('hi')).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('stringifies non-array non-string content', () => {
    expect(toAnthropicContent(42)).toEqual([{ type: 'text', text: '42' }])
    expect(toAnthropicContent(null)).toEqual([{ type: 'text', text: '' }])
  })

  it('converts neutral image parts to Anthropic base64 source blocks', () => {
    const out = toAnthropicContent([
      { type: 'image', dataUrl: 'data:image/jpeg;base64,Zm9v' },
      { type: 'text', text: 'caption' },
    ]) as any[]
    expect(out[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'Zm9v' },
    })
    expect(out[1]).toEqual({ type: 'text', text: 'caption' })
  })

  it('falls back to "[图片]" for malformed data URLs', () => {
    const out = toAnthropicContent([{ type: 'image', dataUrl: 'not-a-data-url' }]) as any[]
    expect(out[0]).toEqual({ type: 'text', text: '[图片]' })
  })

  it('uses empty string for missing text', () => {
    expect(toAnthropicContent([{ type: 'text' }])).toEqual([{ type: 'text', text: '' }])
  })
})