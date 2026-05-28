import { withAuth } from './learn'
import { complete } from './ai'
import { downloadUrlToBuffer } from './downloader'
import { parseAttachment } from './attachment-parser'
import os from 'os'
import path from 'path'
import fs from 'fs'

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

export async function summarizeCourseArea(
  courseId: string,
  kind: TutorSummaryKind,
  onChunk?: (delta: string) => void,
): Promise<string> {
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
      onChunk,
    })
  })
}

export async function askTutor(courseId: string, question: string, onChunk?: (delta: string) => void): Promise<string> {
  const context = courseId === '__mail__' ? '当前问题来自邮箱模块，无课程上下文。' : await buildCourseContext(courseId)
  return complete({
    system: '你是 learn++ 的甘蔗 tutor，全栈式 AI 辅助学习助手。回答要谨慎，不编造课程材料；不确定时提示学生查看原页面或询问老师/助教。',
    messages: [
      {
        role: 'user',
        content: `课程上下文如下：\n${context}\n\n学生问题：${question}\n\n请给出清晰、可操作的答复。`,
      },
    ],
    maxTokens: 2200,
    onChunk,
  })
}

export async function summarizeSingleFile(
  file: { name: string; url: string; fileType?: string },
  onChunk?: (delta: string) => void,
): Promise<string> {
  const buffer = await downloadUrlToBuffer(file.url)
  const tmpDir = path.join(os.tmpdir(), 'learnpp-tutor-files')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `${Date.now()}_${file.name}`)
  fs.writeFileSync(tmpPath, buffer)

  try {
    const parsed = await parseAttachment(tmpPath)
    if (!parsed.text.trim()) {
      return `文件 "${file.name}" 无法提取文本内容（可能为扫描版 PDF 或纯图片），请下载后手动查看。`
    }

    const summary = await complete({
      system: '你是 learn++ 的甘蔗 tutor。请用中文总结以下课件内容，输出简洁有条理的摘要，突出关键概念和学习重点。',
      messages: [{
        role: 'user' as const,
        content: `课件名称：${file.name}\n\n课件内容：\n${parsed.text.slice(0, 15000)}\n\n请总结该课件的：\n1. 核心知识点\n2. 重点概念\n3. 学习建议`,
      }],
      maxTokens: 2000,
      onChunk,
    })

    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    return summary
  } catch (err: any) {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    if (err.message?.includes('不支持的文件类型')) {
      return `文件类型 "${path.extname(file.name)}" 暂不支持内容解析，请下载后手动查看。`
    }
    throw err
  }
}
