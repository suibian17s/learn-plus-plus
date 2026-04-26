export type AiApiFormat = 'anthropic' | 'openai'

export interface AiProviderPreset {
  id: string
  label: string
  group: '官方服务' | '聚合服务' | '自定义'
  apiFormat: AiApiFormat
  endpoint: string
  defaultModel: string
  models: { value: string; label: string }[]
  customEndpoint?: boolean
  note?: string
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    group: '官方服务',
    apiFormat: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 · Agent/推理' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · 推荐' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 · 快速' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5.5',
    models: [
      { value: 'gpt-5.5', label: 'GPT-5.5 · 旗舰' },
      { value: 'gpt-5.4', label: 'GPT-5.4 · 高性价比' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini · 平衡成本' },
      { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano · 高吞吐' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.1-pro-preview',
    models: [
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · 稳定' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · 稳定' },
    ],
    note: 'Gemini 3 系列可能仍处于 Preview；生产使用可选择 2.5 Pro/Flash。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat · 官方兼容名' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner · 推理' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
    note: 'DeepSeek 官方仍保留 deepseek-chat / deepseek-reasoner 兼容模型名，后续 V4 模式可通过同一接口演进。',
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus-latest',
    models: [
      { value: 'qwen3.6-max-preview', label: 'Qwen3.6 Max Preview' },
      { value: 'qwen3-max', label: 'Qwen3 Max' },
      { value: 'qwen-plus-latest', label: 'Qwen Plus Latest · 推荐' },
      { value: 'qwen3.5-plus', label: 'Qwen3.5 Plus' },
      { value: 'qwen-flash', label: 'Qwen Flash · 快速' },
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4.6',
    models: [
      { value: 'glm-4.6', label: 'GLM-4.6' },
      { value: 'glm-4.5', label: 'GLM-4.5' },
      { value: 'glm-z1-air', label: 'GLM-Z1-Air · 推理轻量' },
    ],
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'kimi-k2.5',
    models: [
      { value: 'kimi-k2.5', label: 'Kimi K2.5' },
      { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo Preview' },
      { value: 'moonshot-v1-128k', label: 'Moonshot 128K · 兼容' },
      { value: 'moonshot-v1-32k', label: 'Moonshot 32K · 兼容' },
    ],
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    group: '官方服务',
    apiFormat: 'openai',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-seed-1-6',
    models: [
      { value: 'doubao-seed-1-6', label: 'Doubao Seed 1.6' },
      { value: 'doubao-1-5-pro-32k', label: 'Doubao 1.5 Pro 32K' },
      { value: 'doubao-1-5-lite-32k', label: 'Doubao 1.5 Lite 32K' },
    ],
    note: '火山方舟账号也可填写自己的 Endpoint ID 作为模型名。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    group: '聚合服务',
    apiFormat: 'openai',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    models: [
      { value: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek-V3.2' },
      { value: 'deepseek-ai/DeepSeek-R1-0528', label: 'DeepSeek-R1-0528' },
      { value: 'Qwen/Qwen3.5-72B-Instruct', label: 'Qwen3.5 72B' },
      { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3 · 兼容' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: '聚合服务',
    apiFormat: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-5.5',
    models: [
      { value: 'openai/gpt-5.5', label: 'OpenAI GPT-5.5' },
      { value: 'openai/gpt-5.4', label: 'OpenAI GPT-5.4' },
      { value: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' },
      { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    ],
  },
  {
    id: 'custom',
    label: '自定义接口',
    group: '自定义',
    apiFormat: 'openai',
    endpoint: '',
    defaultModel: '',
    customEndpoint: true,
    models: [],
    note: '支持 OpenAI 兼容接口，也可切换为 Anthropic messages 格式。',
  },
]

export function getAiProviderPreset(id: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id) || AI_PROVIDER_PRESETS[0]
}

export function normalizeCustomEndpoint(raw: string, format: AiApiFormat): string {
  const url = raw.trim().replace(/\/+$/, '')
  if (!url) return ''

  if (format === 'anthropic') {
    return url.endsWith('/messages') ? url : `${url}/messages`
  }

  if (url.endsWith('/chat/completions')) return url
  if (url.endsWith('/v1')) return `${url}/chat/completions`
  return `${url}/v1/chat/completions`
}
