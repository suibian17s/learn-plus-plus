import { complete } from './ai'
import type { AiMessage } from './ai'

export interface SubAgentInput {
  index: number
  total: number
  questionText: string
  coursewareContext: string
  styleGuide: string
  courseName: string
  homeworkTitle: string
  type: string
}

export interface SubAgentOutput {
  index: number
  content: string
  tokensUsed: number
}

export async function runSubAgent(input: SubAgentInput): Promise<SubAgentOutput> {
  const system = `你在协助一名清华大学本科生完成作业的第 ${input.index}/${input.total} 部分。
课程：${input.courseName}
作业：${input.homeworkTitle}

${input.styleGuide}

${input.coursewareContext ? `【相关课件内容】\n${input.coursewareContext}\n\n优先使用课件中讲过的方法解决问题。` : ''}

输出要求：
- 只回答本部分的题目，不要输出其他部分
- 语言精简，只踩采分点，不写长篇讲义
- 不确定的内容用 [需要学生补充: ...] 标明
- 中文 + 学术语气`

  const messages: AiMessage[] = [
    { role: 'user', content: input.questionText },
  ]

  const content = await complete({ system, messages, maxTokens: 4096 })
  const tokensUsed = Math.ceil(content.length / 2)

  return { index: input.index, content, tokensUsed }
}
