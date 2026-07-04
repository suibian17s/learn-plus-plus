// 纯函数：把中性多模态 content 转为各服务商的 image block 格式。
// 单独抽出来是为单测 —— 不 import 任何 electron / fs / 网络依赖。
// ai-client 调用这些函数构造消息体。

// 中性 content 单元类型：
// - 字符串 → 当作单条 text
// - 数组，元素 {type:'text', text} 或 {type:'image', dataUrl: 'data:image/png;base64,...'}

/** OpenAI 兼容（content array of {type:'text'} / {type:'image_url'}）。纯字符串原样返回。 */
export function toOpenAiContent(content: unknown): unknown {
  if (typeof content === 'string' || !Array.isArray(content)) return content
  return content.map((part: any) => {
    if (part?.type === 'image' && part.dataUrl) return { type: 'image_url', image_url: { url: part.dataUrl } }
    if (part?.type === 'text') return { type: 'text', text: part.text || '' }
    return part
  })
}

/** Anthropic（content array of {type:'text'} / {type:'image', source:{type:'base64',...}}）。 */
export function toAnthropicContent(content: unknown): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }]
  return content.map((part: any) => {
    if (part?.type === 'image' && part.dataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(part.dataUrl)
      if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
      return { type: 'text', text: '[图片]' }
    }
    if (part?.type === 'text') return { type: 'text', text: part.text || '' }
    return part
  })
}