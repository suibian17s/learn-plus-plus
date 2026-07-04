import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Modal, Input, Upload, message, Spin } from 'antd'
import {
  CheckCircleOutlined,
  RobotOutlined,
  UploadOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'

function urgencyColor(daysLeft: number): string {
  if (daysLeft <= 2) return '#CF1322'
  if (daysLeft <= 7) return '#FA8C16'
  return '#52C41A'
}

export default function HomeworkPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [submitTarget, setSubmitTarget] = useState<any>(null)
  const [content, setContent] = useState('')
  const [attachPath, setAttachPath] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [keyword, setKeyword] = useState('')

  const { data: homeworks, isLoading } = useQuery({
    queryKey: ['homework', courseId],
    queryFn: () => window.learn.hw.list(courseId!),
    enabled: !!courseId,
  })

  const { uncompleted, completed, expired } = useMemo(() => {
    if (!homeworks) return { uncompleted: [], completed: [], expired: [] }
    const now = dayjs()
    const q = keyword.trim().toLowerCase()
    const visibleHomeworks = q
      ? homeworks.filter((hw: any) => `${hw.title || ''} ${hw.description || ''} ${hw.teacherMessage || ''}`.toLowerCase().includes(q))
      : homeworks
    const un: any[] = []
    const done: any[] = []
    const exp: any[] = []
    for (const hw of visibleHomeworks) {
      if (hw.status === '已提交' || hw.status === '已批阅') {
        done.push(hw)
      } else if (hw.deadline && dayjs(hw.deadline).isBefore(now)) {
        exp.push(hw)
      } else {
        un.push(hw)
      }
    }
    // Sort uncompleted by deadline ascending (closest first)
    un.sort((a, b) => dayjs(a.deadline).valueOf() - dayjs(b.deadline).valueOf())
    // Sort completed: graded first, then submitted
    done.sort((a, b) => (a.status === '已批阅' ? -1 : 1))
    return { uncompleted: un, completed: done, expired: exp }
  }, [homeworks, keyword])

  async function handleSubmit() {
    if (!submitTarget) return
    setSubmitting(true)
    try {
      const result = await window.learn.hw.submit(submitTarget.studentHomeworkId, content, attachPath || undefined)
      if (!result.ok) {
        message.error(`提交失败: ${(result as any).error || '未知错误'}`)
        return
      }
      message.success('提交成功')
      setSubmitTarget(null)
      setContent('')
      setAttachPath(null)
      queryClient.invalidateQueries({ queryKey: ['homework', courseId] })
    } catch (err: any) {
      message.error(`提交失败: ${err?.message || String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  function handleFileSelect(file: File) {
    setAttachPath((file as any).path || file.name)
    return false
  }

  function openSubmit(hw: any) {
    setSubmitTarget(hw)
    setContent('')
    setAttachPath(null)
  }

  function renderItem(hw: any, pending: boolean) {
    const daysLeft = hw.deadline ? dayjs(hw.deadline).diff(dayjs(), 'day') : 999
    const dotColor = urgencyColor(daysLeft)
    const deadlineText = hw.deadline ? dayjs(hw.deadline).format('M月D日 HH:mm') : ''
    // 成绩过滤异常负值（维护铁律：-60 等无效分数不展示）
    const validScore = hw.score != null && Number(hw.score) > 0 ? `${hw.score}分` : ''
    const gradeText = hw.status === '已批阅' ? (validScore || hw.gradeLevel || '') : ''
    const descText = hw.description ? String(hw.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72) : ''

    return (
      <button
        key={hw.id}
        type="button"
        className={`lp2-hw-row${pending ? '' : ' done'}`}
        onClick={() => navigate(`/course/${courseId}/homework/detail/${hw.id}`, { state: { hw } })}
      >
        {pending && (
          <span
            className="lp2-hw-dot"
            style={{ background: daysLeft >= 0 ? dotColor : 'transparent' }}
            aria-hidden="true"
          />
        )}
        <span className="lp2-hw-main">
          <strong>{hw.title}</strong>
          <small>
            {deadlineText && <>截止 {deadlineText}</>}
            {pending && daysLeft >= 0 && (
              <em style={{ color: dotColor, fontStyle: 'normal' }}> · 剩余 {daysLeft} 天</em>
            )}
            {hw.attachments?.length > 0 && <> · {hw.attachments.length} 个附件</>}
            {descText && <> · {descText}</>}
          </small>
        </span>
        <span className="lp2-hw-side">
          {hw.status === '已批阅' ? (
            <span className="lp2-hw-grade">
              {gradeText && <strong>{gradeText}</strong>}
              <small>已批阅</small>
            </span>
          ) : hw.status === '已提交' ? (
            <span className="lp2-hw-state submitted">已提交</span>
          ) : hw.deadline && dayjs(hw.deadline).isBefore(dayjs()) ? (
            <span className="lp2-hw-state expired">已截止</span>
          ) : (
            <Button
              type="primary"
              size="small"
              onClick={(e) => { e.stopPropagation(); openSubmit(hw) }}
            >
              提交作业
            </Button>
          )}
        </span>
      </button>
    )
  }

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!homeworks?.length) return <EmptyState description="暂无作业" />

  return (
    <div>
      <div className="lp2-course-local-toolbar">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索作业"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['homework', courseId] })}>
          刷新
        </Button>
        <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={() => navigate(`/course/${courseId}/homework/auto`)}>
          甘蔗 Tutor 辅助
        </Button>
      </div>

      {uncompleted.length > 0 && (
        <section className="lp2-hw-section">
          <h3 className="lp2-hw-section-title">未完成 · {uncompleted.length}</h3>
          {uncompleted.map((hw: any) => renderItem(hw, true))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="lp2-hw-section">
          <h3 className="lp2-hw-section-title">已完成 · {completed.length}</h3>
          {completed.map((hw: any) => renderItem(hw, false))}
        </section>
      )}

      {expired.length > 0 && (
        <section className="lp2-hw-section">
          <h3 className="lp2-hw-section-title muted">已截止 · {expired.length}</h3>
          {expired.map((hw: any) => renderItem(hw, false))}
        </section>
      )}

      <Modal
        title={`提交: ${submitTarget?.title}`}
        open={!!submitTarget}
        onCancel={() => setSubmitTarget(null)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText="确认提交"
        okButtonProps={{ danger: true }}
        width={640}
      >
        {submitTarget?.description && (
          <div style={{
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 13,
            lineHeight: 1.6,
          }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(submitTarget.description) }}
          />
        )}
        {submitTarget?.teacherMessage && (
          <div style={{
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            <strong>老师留言：</strong>{String(submitTarget.teacherMessage).replace(/<[^>]+>/g, '')}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <Input.TextArea
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入作业内容（文本答案 / 报告内容）"
          />
        </div>
        <Upload beforeUpload={handleFileSelect} maxCount={1} fileList={[]}>
          <Button icon={<UploadOutlined />}>上传附件</Button>
        </Upload>
        {attachPath && (
          <div style={{ marginTop: 8, color: '#52C41A', fontSize: 13 }}>
            <CheckCircleOutlined style={{ marginRight: 4 }} />
            已选择: {attachPath.split(/[/\\]/).pop()}
          </div>
        )}
      </Modal>
    </div>
  )
}
