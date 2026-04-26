import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Tag, Input, message, Spin, Typography, Divider } from 'antd'
import DOMPurify from 'dompurify'
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
  UploadOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import { useDownloadStore } from '../store/downloads'
import { formatDateTime } from '../utils/time'

const { Text, Title } = Typography

interface SelectedAttachment {
  path: string
  name: string
  size: number
}

function htmlToPlainText(html?: string): string {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = DOMPurify.sanitize(html)
  return (div.textContent || '').replace(/\u00a0/g, ' ').trim()
}

function scoreLabel(hw: any): string {
  if (hw.score) {
    const score = String(hw.score)
    return score.endsWith('分') ? score : `${score}分`
  }
  return hw.gradeLevel || ''
}

export default function HomeworkDetailPage() {
  const { courseId, homeworkId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const [content, setContent] = useState('')
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadStates, setDownloadStates] = useState<Record<string, { downloaded: boolean; destPath: string }>>({})
  const downloadRecords = useDownloadStore((s) => s.downloads)
  const addDownloadRecord = useDownloadStore((s) => s.addOrUpdate)

  const navHw = (location.state as any)?.hw

  const { data: homeworks } = useQuery({
    queryKey: ['homework', courseId],
    queryFn: () => window.learn.hw.list(courseId!),
    enabled: !!courseId && !navHw,
  })

  const hw = navHw || (homeworks?.find((h: any) => h.id === homeworkId))

  useEffect(() => {
    if (!hw) return
    if (hw.status === '已提交' && hw.submittedContent) {
      setContent(htmlToPlainText(hw.submittedContent))
    }
  }, [homeworkId, hw?.status, hw?.submittedContent])

  useEffect(() => {
    if (!hw) return
    const names = [
      ...(hw.attachments || []).map((att: any) => att.name),
      hw.submittedAttachment?.name,
      hw.answerAttachment?.name,
      hw.gradeAttachment?.name,
    ].filter(Boolean)

    const uniqueNames = Array.from(new Set(names))
    if (!uniqueNames.length) return

    let alive = true
    Promise.all(
      uniqueNames.map(async (name) => {
        const state = await window.learn.files.downloadState(name)
        return [name, state] as const
      }),
    ).then((entries) => {
      if (!alive) return
      setDownloadStates((prev) => {
        const next = { ...prev }
        for (const [name, state] of entries) next[name] = state
        return next
      })
    })

    return () => {
      alive = false
    }
  }, [homeworkId, hw])

  async function handleSubmit() {
    if (!hw) return
    setSubmitting(true)
    try {
      const result = await window.learn.hw.submit(hw.studentHomeworkId, content, attachment?.path)
      if (!result.ok) {
        message.error(`提交失败: ${result.error || '未知错误'}`)
        return
      }
      message.success('提交成功')
      setContent('')
      setAttachment(null)
      queryClient.invalidateQueries({ queryKey: ['homework', courseId] })
      // Navigate back after successful submit
      setTimeout(() => navigate(-1), 800)
    } catch (err: any) {
      message.error(`提交失败: ${err?.message || String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSelectFile() {
    const selected = await window.learn.hw.selectFile()
    if (!selected) return
    if (selected.error) {
      message.error(selected.error)
      return
    }
    setAttachment(selected)
    message.success(`已选择: ${selected.name}`)
  }

  function formatAttachmentSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  async function handleDownloadAttachment(url: string, name: string) {
    setDownloading(name)
    try {
      const result = await window.learn.hw.downloadAttachment(url, name)
      message.success(`已下载: ${name}`)
      if (result?.destPath) {
        addDownloadRecord({
          id: result.downloadId,
          fileName: name,
          loaded: 0,
          total: 0,
          status: 'completed',
          destPath: result.destPath,
          time: Date.now(),
        })
        setDownloadStates((prev) => ({
          ...prev,
          [name]: { downloaded: true, destPath: result.destPath },
        }))
        window.learn.files.openFolder(result.destPath)
      }
    } catch (err: any) {
      message.error(`下载失败: ${err?.message || String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  function downloadedAttachment(name: string): { destPath: string } | null {
    const state = downloadStates[name]
    if (state?.downloaded) return { destPath: state.destPath }
    const record = downloadRecords.find((item) => (
      item.status === 'completed' &&
      item.destPath &&
      item.fileName === name
    ))
    return record?.destPath ? { destPath: record.destPath } : null
  }

  function renderAttachmentButton(url: string, name: string) {
    const downloaded = downloadedAttachment(name)
    if (downloaded) {
      return (
        <Button
          type="link"
          icon={<FolderOpenOutlined />}
          style={{ color: '#52C41A' }}
          onClick={() => window.learn.files.openFolder(downloaded.destPath)}
        >
          已下载
        </Button>
      )
    }

    return (
      <Button
        type="link"
        icon={<DownloadOutlined />}
        loading={downloading === name}
        onClick={() => handleDownloadAttachment(url, name)}
      >
        下载
      </Button>
    )
  }

  if (!hw) {
    if (!navHw && !homeworks) return <Spin style={{ display: 'block', margin: '40px auto' }} />
    return <EmptyState description="作业不存在" />
  }

  const daysLeft = hw.deadline ? dayjs(hw.deadline).diff(dayjs(), 'day') : 999
  const deadlineExpired = daysLeft < 0
  const isExpired = deadlineExpired && hw.status === '未提交'
  const canSubmit = (hw.status === '未提交' || hw.status === '已提交') && !deadlineExpired
  const sanitizedDescription = hw.description ? DOMPurify.sanitize(hw.description) : ''
  const sanitizedTeacherMessage = hw.teacherMessage ? DOMPurify.sanitize(hw.teacherMessage) : ''
  const shouldShowTeacherMessage = sanitizedTeacherMessage &&
    htmlToPlainText(hw.teacherMessage) !== htmlToPlainText(hw.description)
  const sanitizedSubmittedContent = hw.submittedContent ? DOMPurify.sanitize(hw.submittedContent) : ''
  const submittedText = htmlToPlainText(hw.submittedContent)

  return (
    <div style={{ maxWidth: 800 }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}
        style={{ padding: 0, marginBottom: 16 }}>
        返回列表
      </Button>

      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', padding: 24 }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Title level={4} style={{ margin: 0 }}>{hw.title}</Title>
            {hw.status === '已批阅' && <Tag color="blue">已批阅 {scoreLabel(hw) ? `(${scoreLabel(hw)})` : ''}</Tag>}
            {hw.status === '已提交' && <Tag color="green">已提交</Tag>}
            {hw.status === '未提交' && isExpired && <Tag color="red">已截止</Tag>}
            {hw.status === '未提交' && !isExpired && <Tag color="orange">未提交</Tag>}
          </div>
          {hw.deadline && (
            <div style={{ color: isExpired ? '#CF1322' : '#666', fontSize: 14, marginBottom: 4 }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              截止时间: {formatDateTime(hw.deadline)}
              {canSubmit && (
                <Text strong style={{ marginLeft: 8, color: daysLeft <= 2 ? '#CF1322' : daysLeft <= 7 ? '#FA8C16' : '#52C41A' }}>
                  (剩余 {daysLeft} 天)
                </Text>
              )}
              {deadlineExpired && <Text type="danger" style={{ marginLeft: 8 }}>(已逾期)</Text>}
            </div>
          )}
          {hw.submitTime && (
            <div style={{ color: '#666', fontSize: 13 }}>提交时间: {formatDateTime(hw.submitTime)}</div>
          )}
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Teacher's description */}
        {hw.description && (
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 14 }}>作业要求</Text>
            <div style={{
              background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6,
              padding: 16, marginTop: 8, fontSize: 14, lineHeight: 1.8,
              maxHeight: 500, overflow: 'auto',
            }}
              dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            />
          </div>
        )}

        {shouldShowTeacherMessage && (
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 14 }}>老师留言</Text>
            <div style={{
              background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
              padding: 16, marginTop: 8, fontSize: 14, lineHeight: 1.8,
            }}
              dangerouslySetInnerHTML={{ __html: sanitizedTeacherMessage }}
            />
          </div>
        )}

        {/* Teacher's attachments */}
        {hw.attachments?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 14 }}>老师附件</Text>
            {hw.attachments.map((att: any, i: number) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0',
                borderRadius: 6, marginTop: 8,
              }}>
                <span><PaperClipOutlined style={{ marginRight: 8, color: '#999' }} />{att.name}</span>
                {renderAttachmentButton(att.url, att.name)}
              </div>
            ))}
          </div>
        )}

        <Divider style={{ margin: '12px 0' }} />

        {/* Submitted content (if already submitted/graded) */}
        {(hw.status === '已提交' || hw.status === '已批阅') && (
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 14 }}>我的提交</Text>
            {submittedText ? (
              <div style={{
                background: '#f6ffed', border: '1px solid #d9f7be', borderRadius: 6,
                padding: 16, marginTop: 8, fontSize: 14, lineHeight: 1.6,
              }}
                dangerouslySetInnerHTML={{ __html: sanitizedSubmittedContent }}
              />
            ) : (
              <div style={{ color: '#999', fontSize: 13, marginTop: 8 }}>未提交文字内容</div>
            )}
            {hw.submittedAttachment && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0',
                borderRadius: 6, marginTop: 8,
              }}>
                <span><FileTextOutlined style={{ marginRight: 8, color: '#999' }} />{hw.submittedAttachment.name}</span>
                {renderAttachmentButton(hw.submittedAttachment.url, hw.submittedAttachment.name)}
              </div>
            )}
          </div>
        )}

        {/* Teacher's answer / grading */}
        {hw.status === '已批阅' && (hw.answerContent || hw.answerAttachment || hw.gradeContent) && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ marginBottom: 20 }}>
              <Text strong style={{ fontSize: 14 }}>老师批阅</Text>
              {hw.gradeContent && (
                <div style={{
                  background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
                  padding: 16, marginTop: 8, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>
                  {hw.gradeContent}
                </div>
              )}
              {hw.answerContent && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>参考答案</Text>
                  <div style={{
                    background: '#f0f5ff', border: '1px solid #d6e4ff', borderRadius: 6,
                    padding: 16, marginTop: 4, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {hw.answerContent}
                  </div>
                </div>
              )}
              {hw.answerAttachment && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0',
                  borderRadius: 6, marginTop: 8,
                }}>
                  <span><PaperClipOutlined style={{ marginRight: 8, color: '#999' }} />{hw.answerAttachment.name} (答案附件)</span>
                  {renderAttachmentButton(hw.answerAttachment.url, hw.answerAttachment.name)}
                </div>
              )}
              {hw.gradeAttachment && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0',
                  borderRadius: 6, marginTop: 8,
                }}>
                  <span><PaperClipOutlined style={{ marginRight: 8, color: '#999' }} />{hw.gradeAttachment.name} (批阅附件)</span>
                  {renderAttachmentButton(hw.gradeAttachment.url, hw.gradeAttachment.name)}
                </div>
              )}
              {hw.graderName && (
                <div style={{ color: '#999', fontSize: 13, marginTop: 8 }}>
                  批阅人: {hw.graderName}{hw.gradeTime ? ` · ${formatDateTime(hw.gradeTime)}` : ''}
                </div>
              )}
            </div>
          </>
        )}

        {/* Submit section (unsubmitted or resubmittable before deadline) */}
        {canSubmit && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <div>
              <Text strong style={{ fontSize: 14 }}>{hw.status === '已提交' ? '修改提交' : '提交作业'}</Text>
              <div style={{ marginTop: 8, marginBottom: 16 }}>
                <Input.TextArea rows={6} value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="输入作业内容（文本答案 / 报告内容）" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Button icon={<UploadOutlined />} onClick={handleSelectFile}>上传附件</Button>
                {attachment && (
                  <span style={{ color: '#52C41A', fontSize: 13 }}>
                    <CheckCircleOutlined style={{ marginRight: 4 }} />
                    已选择: {attachment.name} ({formatAttachmentSize(attachment.size)})
                  </span>
                )}
              </div>
              <Button type="primary" danger onClick={handleSubmit} loading={submitting}>
                {hw.status === '已提交' ? '确认修改' : '确认提交'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
