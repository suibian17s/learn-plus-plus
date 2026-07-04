import { withAuth } from './learn'
import { complete } from './ai'
import { downloadUrlToBuffer } from './downloader'
import { parseAttachment } from './attachment-parser'
import { learnStyle, buildStyleGuide, type StyleProfile } from './homework-style-learner'
import { runSubAgent, type SubAgentOutput } from './homework-subagent'
import { runReview, type ReviewOutput } from './homework-reviewer'
import type { AnalyzedHomework } from '../types'
import os from 'os'
import path from 'path'
import fs from 'fs'

export type OrchestratePhase =
  | 'analyzing'
  | 'learning-style'
  | 'decomposing'
  | { type: 'generating'; current: number; total: number }
  | 'assembling'
  | 'reviewing'
  | 'done'

export interface OrchestrateCallback {
  (chunk: { phase: OrchestratePhase; detail?: string; content?: string }): void
}

export interface OrchestrateRequest {
  analyzed: AnalyzedHomework
  sessionId: string
  outputFormat?: string
  signal?: AbortSignal
  onProgress: OrchestrateCallback
}

export interface OrchestrateResult {
  contentMarkdown: string
  review: ReviewOutput | null
  styleProfile: StyleProfile | null
}

// ── Concurrency limiter ──

async function runSubAgentsWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return []
  const results: T[] = new Array(tasks.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= tasks.length) break
        results[i] = await tasks[i]()
      }
    })
  )
  return results
}

export async function orchestrate(req: OrchestrateRequest): Promise<OrchestrateResult> {
  const { analyzed, signal, onProgress } = req

  // Phase 1: Analyze course materials
  onProgress({ phase: 'analyzing', detail: '扫描课件和课程资料...' })
  const coursewareText = await matchCourseware(analyzed, signal)

  // Phase 2: Learn style
  onProgress({ phase: 'learning-style', detail: '学习往期作业风格...' })
  let styleProfile: StyleProfile | null = null
  try {
    styleProfile = await learnStyle(analyzed.hw.courseId, analyzed.hw.courseName || '')
  } catch { /* best-effort */ }
  const styleGuide = styleProfile
    ? buildStyleGuide(styleProfile, req.outputFormat)
    : `使用${req.outputFormat || '标准学术'}格式输出。`

  // Phase 3: Decompose
  onProgress({ phase: 'decomposing', detail: '分析题目结构...' })
  const questions = await decomposeHomework(analyzed, coursewareText, styleGuide, signal)
  if (questions.length === 0) {
    questions.push({
      index: 1, total: 1,
      questionText: `${analyzed.hw.title}\n\n${analyzed.hw.description || ''}`,
      coursewareContext: coursewareText,
    })
  }

  // Phase 4: Parallel sub-agents (concurrency-limited)
  const subResults: SubAgentOutput[] = await runSubAgentsWithLimit(
    questions.map((q) => async () => {
      if (signal?.aborted) throw new Error('Aborted')
      onProgress({ phase: { type: 'generating', current: q.index, total: questions.length }, detail: `生成第 ${q.index}/${questions.length} 部分...` })
      return runSubAgent({
        index: q.index,
        total: q.total,
        questionText: q.questionText,
        coursewareContext: q.coursewareContext,
        styleGuide,
        courseName: analyzed.hw.courseName || '',
        homeworkTitle: analyzed.hw.title || '',
        type: analyzed.type,
        signal,
      })
    }),
    3,
  )

  // Sort by index
  subResults.sort((a, b) => a.index - b.index)

  // Phase 5: Assemble
  onProgress({ phase: 'assembling', detail: '组装答案...' })
  const assembled = await assembleResults(analyzed, subResults, styleGuide, signal)

  // Phase 6: Review
  onProgress({ phase: 'reviewing', detail: '甘蔗 Tutor 审查中...' })
  let review: ReviewOutput | null = null
  try {
    review = await runReview({
      homeworkTitle: analyzed.hw.title || '',
      homeworkDescription: analyzed.hw.description || '',
      assembledContent: assembled,
      coursewareUsed: coursewareText,
      styleGuide,
      signal,
    })
  } catch { /* best-effort */ }

  onProgress({ phase: 'done', detail: '完成', content: review?.correctedContent || assembled })
  return { contentMarkdown: review?.correctedContent || assembled, review, styleProfile }
}

// ── Courseware matching ──

async function matchCourseware(analyzed: AnalyzedHomework, signal?: AbortSignal): Promise<string> {
  return withAuth(async (h) => {
    const files = await h.getFileList(analyzed.hw.courseId)
    if (!files.length) return ''

    const hwText = `${analyzed.hw.title || ''} ${analyzed.hw.description || ''}`.toLowerCase()
    // Extract meaningful keywords (2+ chars)
    const keywords = hwText.replace(/[^一-龥a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1)
    if (keywords.length === 0) return ''

    // Score files by keyword match
    const scored = files
      .filter((f: any) => {
        const name = (f.title || f.name || '').toLowerCase()
        const ext = (f.fileType || '').toLowerCase()
        return ['.pdf', '.pptx', '.ppt', '.docx', '.doc', '.txt', '.md'].some(e => ext === e || name.endsWith(e))
      })
      .map((f: any) => {
        const name = (f.title || f.name || '').toLowerCase()
        const score = keywords.filter(k => name.includes(k)).length
        return { file: f, score }
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (scored.length === 0) return ''

    const parts: string[] = []
    for (const { file } of scored) {
      if (signal?.aborted) break
      try {
        const url = file.downloadUrl || file.url
        if (!url) continue
        const buf = await downloadUrlToBuffer(url)
        const tmp = path.join(os.tmpdir(), `learnpp-match-${Date.now()}-${file.title || file.name || 'file'}`)
        fs.mkdirSync(path.dirname(tmp), { recursive: true })
        fs.writeFileSync(tmp, buf)
        const parsed = await parseAttachment(tmp)
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        if (parsed.text.trim()) {
          parts.push(`【课件：${file.title || file.name}】\n${parsed.text.slice(0, 3000)}`)
        }
      } catch { /* skip this file */ }
    }

    return parts.join('\n\n')
  })
}

// ── Decomposition ──

async function decomposeHomework(
  analyzed: AnalyzedHomework,
  coursewareText: string,
  styleGuide: string,
  signal?: AbortSignal,
): Promise<{ index: number; total: number; questionText: string; coursewareContext: string }[]> {
  const prompt = `请分析以下作业，判断是否可以按题目或实验模块拆分为独立的部分。

作业标题：${analyzed.hw.title || ''}
作业描述：${analyzed.hw.description || ''}
${coursewareText ? `\n参考课件内容：\n${coursewareText.slice(0, 6000)}` : ''}

如果可以拆分，请返回严格的 JSON 数组（不要包含 markdown 代码块标记）：
[
  { "index": 1, "questionText": "第1题完整题面（含题干数据和所有细节）", "coursewareContext": "匹配的课件内容摘录（若作业描述中未关联课件则为空字符串）" },
  { "index": 2, ... }
]

如果无法拆分（只有一道大题或各题高度耦合无法独立完成），返回空数组 []。

重要：每个 questionText 必须包含该题的完整题干，保证子代理仅靠该文本就能独立作答。`

  try {
    const raw = await complete({
      system: '你是一个作业分析助手。只返回 JSON 数组，不写任何其他文字。无法拆分就返回 []。',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      signal,
    })
    const trimmed = raw.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const total = parsed.length
      return parsed.map((q: any) => ({
        index: q.index || 1,
        total,
        questionText: q.questionText || `${analyzed.hw.title}\n${analyzed.hw.description}`,
        coursewareContext: q.coursewareContext || coursewareText,
      }))
    }
  } catch { /* fall through */ }

  return []
}

// ── Assembly ──

async function assembleResults(
  analyzed: AnalyzedHomework,
  subResults: SubAgentOutput[],
  styleGuide: string,
  signal?: AbortSignal,
): Promise<string> {
  if (subResults.length === 0) return ''
  if (subResults.length === 1) return subResults[0].content

  const parts = subResults.map(r => `### 第 ${r.index} 部分\n\n${r.content}`).join('\n\n---\n\n')

  const prompt = `请将以下按题目拆分生成的各部分答案合并为一份完整的作业草稿。
统一标题层级、编号格式、参考文献位置。保持内容不变，只做格式统一。

${styleGuide}

各部分内容：
${parts}`

  try {
    const assembled = await complete({
      system: '你是作业格式整理助手。只做格式统一，不改变内容。直接输出整理后的完整答案，不要写任何解释性文字。',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 6000,
      signal,
    })
    return assembled
  } catch {
    return parts
  }
}
