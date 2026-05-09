import { withAuth } from './learn'

export interface StyleProfile {
  confidence: number
  patterns: {
    titleFormat: string
    usesLatexFormulas: boolean
    usesTables: boolean
    headingHierarchy: string
    answerLength: 'brief' | 'moderate' | 'detailed'
    formatNotes: string
  }
  rawSample: string
}

export async function learnStyle(courseId: string, courseName: string): Promise<StyleProfile | null> {
  return withAuth(async (h) => {
    const list = await h.getHomeworkList(courseId)
    const submitted = list.filter((hw: any) => hw.submitted)
    if (submitted.length === 0) return null

    let sampleText = ''
    let detailFound = false

    for (const hw of submitted.slice(-5).reverse()) {
      try {
        const content = hw.submittedContent || hw.answerContent || ''
        const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (plain.length > 100) {
          sampleText = plain.slice(0, 3000)
          detailFound = true
          break
        }
      } catch { /* try next */ }
    }

    if (!detailFound) return null

    const answerLength: 'brief' | 'moderate' | 'detailed' =
      sampleText.length > 2000 ? 'detailed'
        : sampleText.length > 800 ? 'moderate'
        : 'brief'

    const patterns = {
      titleFormat: sampleText.match(/第[一二三四五六七八九十\d]+次/) ? '第X次作业格式'
        : sampleText.match(/HW\d+/i) ? 'HW编号格式'
        : '标准格式',
      usesLatexFormulas: /\$\$|\$|\\begin\{equation\}|\\frac|\\sum/.test(sampleText),
      usesTables: /(\|.+\|[\r\n]+\|[-|]+\|)/.test(sampleText) || /<table/i.test(sampleText),
      headingHierarchy: sampleText.includes('###') ? 'Markdown ## → ###'
        : sampleText.includes('一、') ? '中文数字 → 阿拉伯数字'
        : '段落式',
      answerLength,
      formatNotes: '',
    }

    return {
      confidence: 0.6,
      patterns,
      rawSample: sampleText,
    }
  })
}

export function buildStyleGuide(profile: StyleProfile, fallbackFormat?: string): string {
  const lines: string[] = ['【往期作业风格指南】']
  lines.push(`标题格式：${profile.patterns.titleFormat}`)
  lines.push(`公式环境：${profile.patterns.usesLatexFormulas ? '使用 LaTeX 公式' : '不使用 LaTeX 公式'}`)
  lines.push(`表格使用：${profile.patterns.usesTables ? '频繁使用表格' : '不使用表格'}`)
  lines.push(`层级结构：${profile.patterns.headingHierarchy}`)
  lines.push(`答案详略：${profile.patterns.answerLength === 'detailed' ? '详细展开' : profile.patterns.answerLength === 'moderate' ? '适中' : '简洁踩点'}`)

  if (fallbackFormat) {
    lines.push(`输出格式：${fallbackFormat}`)
  }

  lines.push('\n请严格按照以上风格生成答案，避免长篇大论，只踩采分点。')
  return lines.join('\n')
}
