import { withAuth } from './learn'
import { complete } from './ai'
import { parseAttachment } from './attachment-parser'
import { buildDocx, buildPdf } from './attachment-builder'
import { downloadUrlToBuffer } from './downloader'
import type { HomeworkSummary, AnalyzedHomework, HomeworkType, GenerateRequestParams, GenerateResult, ParsedAttachment } from '../types'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sanitizeFilename } from '../utils/sanitize'

// ── Classification heuristics ──

function classifyByKeywords(hw: any): { type: HomeworkType; confidence: number } {
  const text = `${hw.title || ''} ${hw.description || ''}`.toLowerCase()

  const rules: [RegExp, HomeworkType][] = [
    [/编程|代码|code|lab|实验|program|implement|算法/, 'code'],
    [/ppt|幻灯片|slides|汇报|presentation/, 'ppt'],
    [/报告|report|论文|小结|paper|essay|总结/, 'report'],
    [/实验/, 'lab'],
    [/简答|问答|回答|简述|分析|论述|讨论|思考/, 'text'],
  ]

  for (const [re, type] of rules) {
    if (re.test(text)) return { type, confidence: 0.8 }
  }
  return { type: 'unknown', confidence: 0.3 }
}

function classifyDetailed(hw: any): { type: HomeworkType; confidence: number } {
  const result = classifyByKeywords(hw)
  if (result.confidence >= 0.7) return result
  const text = `${hw.title || ''} ${hw.description || ''}`
  if (text.length < 50) return { type: 'text', confidence: 0.4 }
  if (text.includes('提交') && !text.includes('附件')) return { type: 'text', confidence: 0.5 }
  return result
}

// ── Prompt builders ──

function buildSystemPrompt(hwType: HomeworkType): string {
  const base = `你在协助一名清华大学本科生理解并完成作业。学生会审阅并对最终内容负责。

输出要求：
- 中文 + 学术语气
- 不要编造引用、不要伪造实验数据 —— 拿不准请输出 [需要学生补充: ...] 占位
- 保持逻辑清晰、条理分明`

  switch (hwType) {
    case 'text':
      return `${base}\n这是一道文本简答题。请直接输出完整的答案文本。语言精炼、论点明确。`
    case 'report':
      return `${base}\n这是一份报告/论文。请以 Markdown 格式输出完整的报告。包含标题、摘要、正文（分章节）、结论。不要编造具体数据，用 [需要学生补充: 请填写XX数据] 替代不确定的部分。`
    case 'code':
      return `${base}\n这是一份代码作业。请输出完整的代码实现，包含必要的注释。代码必须是可运行的。如果某些实现需要学生本地文件或配置，用 [需要学生补充: ...] 标明。`
    case 'lab':
      return `${base}\n这是一份实验报告。请以 Markdown 格式输出，包含实验目的、原理、步骤、结果分析、结论。实验数据用 [需要学生补充: 请填写实验数据] 占位。`
    case 'ppt':
      return `${base}\n这是一个 PPT 汇报作业。v1 不自动生成 PPTX 文件。请输出一份详细的大纲建议，包含每页标题和要点。学生将据此自行制作 PPT。`
    default:
      return `${base}\n请帮助学生理解并完成此作业。如果无法确定作业类型，请输出审题分析和建议。`
  }
}

function buildHomeworkContext(hw: any, parsedAttachments: ParsedAttachment[]): string {
  const parts: string[] = []
  parts.push(`课程: ${hw.courseName || ''}`)
  parts.push(`作业标题: ${hw.title || ''}`)
  parts.push(`截止时间: ${hw.deadline || ''}`)
  parts.push('')
  parts.push('=== 作业描述 ===')
  const plainDesc = (hw.description || '').replace(/<[^>]+>/g, '')
  parts.push(plainDesc)

  if (parsedAttachments.length > 0) {
    parts.push('')
    parts.push('=== 附件内容 ===')
    for (const att of parsedAttachments) {
      parts.push(`\n--- ${att.name} ---`)
      parts.push(att.text.slice(0, 8000))
    }
  }

  return parts.join('\n')
}

function getHomeworkAttachments(hw: any): { name: string; url: string }[] {
  const raw = [
    ...(Array.isArray(hw.attachments) ? hw.attachments : []),
    ...(Array.isArray(hw.attachment) ? hw.attachment : hw.attachment ? [hw.attachment] : []),
  ]

  const seen = new Set<string>()
  return raw
    .map((att) => ({
      name: att.name || att.title || att.filename || 'attachment',
      url: att.downloadUrl || att.downloadURL || att.url || '',
    }))
    .filter((att) => {
      if (!att.url) return false
      const key = `${att.name}\n${att.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function downloadAttachmentToTemp(att: { name: string; url: string }): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'learnpp-ai-attachments')
  fs.mkdirSync(tempDir, { recursive: true })

  const safeName = sanitizeFilename(att.name || 'attachment')
  const tempPath = path.join(tempDir, `${Date.now()}-${safeName}`)
  const buffer = await downloadUrlToBuffer(att.url)
  fs.writeFileSync(tempPath, buffer)
  return tempPath
}

// ── Main pipeline ──

export async function scan(courseId: string): Promise<HomeworkSummary[]> {
  return withAuth(async (h) => {
    const list = await h.getHomeworkList(courseId)
    return list
      .filter((hw) => !hw.submitted)
      .map((hw) => {
        const { type, confidence } = classifyDetailed(hw)
        return {
          homeworkId: hw.id,
          studentHomeworkId: hw.studentHomeworkId,
          title: hw.title,
          deadline: hw.deadline instanceof Date ? hw.deadline.toISOString() : String(hw.deadline),
          type,
          confidence,
          courseId,
          courseName: '',
          status: hw.submitted ? '已提交' : '未提交',
        }
      })
  })
}

export async function analyze(courseId: string, hwId: string): Promise<AnalyzedHomework> {
  return withAuth(async (h) => {
    const list = await h.getHomeworkList(courseId)
    const hw = list.find((item) => item.id === hwId)
    if (!hw) throw new Error('Homework not found')

    const { type, confidence } = classifyDetailed(hw)
    const warnings: string[] = []
    const parsedAttachments: ParsedAttachment[] = []

    const attachments = getHomeworkAttachments(hw)
    for (const att of attachments) {
      try {
        const filePath = await downloadAttachmentToTemp(att)
        const parsed = await parseAttachment(filePath)
        warnings.push(...parsed.warnings.map((warning) => `${att.name}: ${warning}`))
        parsedAttachments.push({
          name: att.name,
          text: parsed.text || `[附件 ${att.name} 未能提取到文本内容]`,
          tokenEstimate: parsed.tokenEstimate,
        })
      } catch (err) {
        warnings.push(`${att.name}: 附件下载或解析失败（${err instanceof Error ? err.message : String(err)}）`)
        parsedAttachments.push({
          name: att.name,
          text: `[附件 ${att.name} 下载或解析失败，生成时请提醒学生手动查看]`,
          tokenEstimate: 20,
        })
      }
    }

    const suggestedOutputs: ('content' | 'docx' | 'pdf' | 'code')[] = ['content']
    if (type === 'report' || type === 'lab') suggestedOutputs.push('docx')
    if (type === 'code') suggestedOutputs.push('code')

    const deadline = hw.deadline instanceof Date ? hw.deadline.toISOString() : String(hw.deadline)

    return {
      hw: {
        id: hw.id,
        studentHomeworkId: hw.studentHomeworkId,
        title: hw.title,
        description: hw.description || '',
        deadline,
        courseId,
        courseName: '',
      },
      type,
      confidence,
      parsedAttachments,
      suggestedOutputs,
      warnings,
    }
  })
}

const activeGenerations = new Map<string, AbortController>()

export async function generate(req: GenerateRequestParams): Promise<GenerateResult> {
  const { analyzed, userInstruction, sessionId } = req
  const abortController = new AbortController()
  activeGenerations.set(sessionId, abortController)

  try {
    const systemPrompt = buildSystemPrompt(analyzed.type)
    const homeworkContext = buildHomeworkContext(analyzed.hw, analyzed.parsedAttachments)

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: homeworkContext },
    ]

    if (userInstruction) {
      messages.push({ role: 'user', content: `额外要求: ${userInstruction}` })
    }

    messages.push({ role: 'user', content: '请根据以上作业信息，按要求生成回答。' })

    let fullResponse = ''

    const result = await complete({
      system: systemPrompt,
      messages: messages as any,
      signal: abortController.signal,
      onChunk: (delta) => {
        fullResponse += delta
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          win.webContents.send('hwai:generate-chunk', { sessionId, delta })
        }
      },
    })

    fullResponse = result
    const tokensUsed = Math.ceil(fullResponse.length / 2)

    let attachmentSpec: GenerateResult['attachmentSpec']
    if (analyzed.suggestedOutputs.includes('docx')) {
      const { buffer: buf } = await buildDocx(fullResponse)
      attachmentSpec = {
        kind: 'docx',
        filename: sanitizeFilename(`${analyzed.hw.title || 'homework'}.docx`),
        buffer: Array.from(buf),
      }
    }

    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('hwai:generate-end', { sessionId })
    }

    return {
      contentMarkdown: fullResponse,
      attachmentSpec,
      meta: { tokensUsed, modelId: 'ai-model' },
    }
  } finally {
    activeGenerations.delete(sessionId)
  }
}

export function abortGeneration(sessionId: string): void {
  const controller = activeGenerations.get(sessionId)
  if (controller) {
    controller.abort()
    activeGenerations.delete(sessionId)
  }
}

export async function buildHwAttachment(
  spec: { kind: 'docx' | 'pdf'; filename: string },
  markdown: string,
): Promise<{ tempPath: string }> {
  if (spec.kind === 'docx') {
    const { buffer, filename } = await buildDocx(markdown, { filename: sanitizeFilename(spec.filename) })
    const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${filename}`)
    fs.writeFileSync(tmpPath, new Uint8Array(buffer))
    return { tempPath: tmpPath }
  } else {
    const { buffer, filename } = await buildPdf(markdown, { filename: sanitizeFilename(spec.filename) })
    const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${filename}`)
    fs.writeFileSync(tmpPath, new Uint8Array(buffer))
    return { tempPath: tmpPath }
  }
}
