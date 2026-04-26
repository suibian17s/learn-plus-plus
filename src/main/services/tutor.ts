import { withAuth } from './learn'
import { complete } from './ai'

export type TutorSummaryKind = 'notifications' | 'files' | 'discussion'

function stripHtml(value: string): string {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function limit(text: string, max = 12000): string {
  return text.length > max ? `${text.slice(0, max)}\n...（内容已截断）` : text
}

async function buildCourseContext(courseId: string): Promise<string> {
  return withAuth(async (h) => {
    const [notices, files, homeworks, discussions] = await Promise.all([
      h.getNotificationList(courseId).catch(() => []),
      h.getFileList(courseId).catch(() => []),
      h.getHomeworkList(courseId).catch(() => []),
      h.getDiscussionList(courseId).catch(() => []),
    ])

    const lines: string[] = []
    lines.push('=== 公告 ===')
    for (const n of notices.slice(0, 12) as any[]) {
      lines.push(`- ${n.title || ''}: ${stripHtml(n.content || '').slice(0, 240)}`)
    }

    lines.push('\n=== 课件 ===')
    for (const f of files.slice(0, 30) as any[]) {
      lines.push(`- ${f.title || f.name || ''} ${f.fileType ? `.${f.fileType}` : ''}`)
    }

    lines.push('\n=== 作业 ===')
    for (const hw of homeworks.slice(0, 20) as any[]) {
      lines.push(`- ${hw.title || ''} ${hw.submitted ? '已提交' : '未提交'} 截止: ${hw.deadline || ''}`)
    }

    lines.push('\n=== 讨论 ===')
    for (const d of discussions.slice(0, 20) as any[]) {
      lines.push(`- ${d.title || ''} 回复: ${d.replyCount || 0}`)
    }

    return limit(lines.join('\n'))
  })
}

export async function summarizeCourseArea(courseId: string, kind: TutorSummaryKind): Promise<string> {
  return withAuth(async (h) => {
    let title = ''
    let context = ''

    if (kind === 'notifications') {
      title = '课程公告总结'
      const notices = await h.getNotificationList(courseId)
      context = (notices as any[]).slice(0, 20).map((n) => [
        `标题: ${n.title || ''}`,
        `发布人: ${n.publisher || ''}`,
        `时间: ${n.publishTime || ''}`,
        `内容: ${stripHtml(n.content || '')}`,
      ].join('\n')).join('\n\n')
    } else if (kind === 'files') {
      title = '课件学习路径总结'
      const files = await h.getFileList(courseId)
      context = (files as any[]).slice(0, 60).map((f) => (
        `- ${f.title || f.name || ''}${f.fileType ? `.${f.fileType}` : ''} 上传时间: ${f.uploadTime || ''} 大小: ${f.size || f.rawSize || ''}`
      )).join('\n')
    } else {
      title = '课程讨论总结'
      const discussions = await h.getDiscussionList(courseId)
      context = (discussions as any[]).slice(0, 40).map((d) => (
        `- ${d.title || ''} 发帖人: ${d.publisherName || ''} 回复: ${d.replyCount || 0} 浏览: ${d.visitCount || 0}`
      )).join('\n')
    }

    return complete({
      system: '你是 learn++ 的甘蔗 tutor，全栈式 AI 辅助学习助手。请用中文输出，直接给学生可执行、结构清晰的总结。',
      messages: [
        {
          role: 'user',
          content: `${title}\n\n请基于以下网络学堂信息，输出：\n1. 重点概览\n2. 待办事项\n3. 学习建议\n4. 需要打开原页面进一步确认的事项\n\n${limit(context)}`,
        },
      ],
      maxTokens: 2200,
    })
  })
}

export async function askTutor(courseId: string, question: string): Promise<string> {
  const context = await buildCourseContext(courseId)
  return complete({
    system: '你是 learn++ 的甘蔗 tutor，全栈式 AI 辅助学习助手。回答要谨慎，不编造课程材料；不确定时提示学生查看原页面或询问老师/助教。',
    messages: [
      {
        role: 'user',
        content: `课程上下文如下：\n${context}\n\n学生问题：${question}\n\n请给出清晰、可操作的答复。`,
      },
    ],
    maxTokens: 2200,
  })
}
