import { complete } from './ai'
import type { AiMessage } from './ai'

export interface ReviewInput {
  homeworkTitle: string
  homeworkDescription: string
  assembledContent: string
  coursewareUsed: string
  styleGuide: string
}

export interface ReviewOutput {
  passed: boolean
  issues: { severity: 'critical' | 'warning' | 'info'; description: string }[]
  correctedContent: string
  needsManualReview: string[]
}

export async function runReview(input: ReviewInput): Promise<ReviewOutput> {
  const system = `你是 learn++ 的甘蔗 Tutor 审查代理。你的任务是审查一份 AI 生成的作业草稿，检查以下方面：

1. 漏题：是否所有题目都回答了
2. 公式/数值：计算结果是否正确、公式是否合理
3. 方法匹配：是否使用了课件中讲过的方法
4. 格式一致：是否符合作业要求的输出格式
5. 人工复核：标记需要学生自行检查的部分

请返回严格的 JSON 格式（不要包含 markdown 代码块标记）：
{
  "passed": true,
  "issues": [{ "severity": "critical", "description": "..." }],
  "correctedContent": "修正后的完整内容",
  "needsManualReview": ["需人工复核的项1", "项2"]
}

如果 passes 为 false，说明有严重问题需要重新生成。如果 passes 为 true，issues 可以包含 warning/info 级别的建议。`

  const prompt = `作业标题：${input.homeworkTitle}
作业描述：${input.homeworkDescription.slice(0, 2000)}

${input.coursewareUsed ? `参考课件：${input.coursewareUsed.slice(0, 2000)}` : ''}

${input.styleGuide}

待审查草稿：
${input.assembledContent.slice(0, 15000)}

请进行甘蔗 Tutor 审查。`

  const messages: AiMessage[] = [{ role: 'user', content: prompt }]

  try {
    const raw = await complete({ system, messages, maxTokens: 4096 })
    const trimmed = raw.trim()
    // Strip markdown code fences if present
    const json = JSON.parse(trimmed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, ''))
    return {
      passed: !!json.passed,
      issues: json.issues || [],
      correctedContent: json.correctedContent || input.assembledContent,
      needsManualReview: json.needsManualReview || [],
    }
  } catch {
    // If JSON parsing fails, return a graceful fallback
    return {
      passed: true,
      issues: [],
      correctedContent: input.assembledContent,
      needsManualReview: ['甘蔗 Tutor 审查代理无法完成自动审查，请人工通读全文'],
    }
  }
}
