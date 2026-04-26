import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { List, Tag, Button, Modal, Input, Upload, message, Spin, Space, Typography } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  UploadOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import { formatDateTime } from '../utils/time'

const { Text } = Typography

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

  const { data: homeworks, isLoading } = useQuery({
    queryKey: ['homework', courseId],
    queryFn: () => window.learn.hw.list(courseId!),
    enabled: !!courseId,
  })

  const { uncompleted, completed, expired } = useMemo(() => {
    if (!homeworks) return { uncompleted: [], completed: [], expired: [] }
    const now = dayjs()
    const un: any[] = []
    const done: any[] = []
    const exp: any[] = []
    for (const hw of homeworks) {
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
  }, [homeworks])

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

  function statusTag(hw: any) {
    if (hw.status === '已批阅') {
      const gradeText = hw.score ? `${hw.score}分` : hw.gradeLevel
      return <Tag color="blue">{hw.status} {gradeText ? `(${gradeText})` : ''}</Tag>
    }
    if (hw.status === '已提交') return <Tag color="green">{hw.status}</Tag>
    if (hw.deadline && dayjs(hw.deadline).isBefore(dayjs())) {
      return <Tag color="red">已截止</Tag>
    }
    return <Tag color="orange">未提交</Tag>
  }

  function renderItem(hw: any, showSubmit: boolean, showAi: boolean) {
    const daysLeft = hw.deadline ? dayjs(hw.deadline).diff(dayjs(), 'day') : 999
    const dotColor = urgencyColor(daysLeft)

    return (
      <List.Item
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 10,
          border: '1px solid #f0f0f0',
          cursor: 'pointer',
          opacity: hw.status !== '未提交' ? 0.55 : 1,
        }}
        onClick={() => navigate(`/course/${courseId}/homework/detail/${hw.id}`, { state: { hw } })}
        actions={[
          showSubmit && (
            <Button
              key="submit"
              type="primary"
              size="small"
              onClick={(e) => { e.stopPropagation(); openSubmit(hw) }}
            >
              提交作业
            </Button>
          ),
          showAi && (
            <Button
              key="ai"
              size="small"
              icon={<RobotOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/course/${courseId}/homework/auto`)
              }}
            >
              甘蔗 tutor
            </Button>
          ),
        ].filter(Boolean)}
      >
        <List.Item.Meta
          avatar={
            hw.status === '未提交' && daysLeft >= 0 ? (
              <span style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: dotColor,
                marginTop: 6,
                flexShrink: 0,
              }} />
            ) : null
          }
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{hw.title}</span>
              {statusTag(hw)}
            </div>
          }
          description={
            <div>
              {hw.deadline && (
                <span style={{ color: dotColor, fontWeight: 500, fontSize: 13 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  截止: {formatDateTime(hw.deadline)}
                  {hw.status === '未提交' && daysLeft >= 0 && (
                    <span style={{ marginLeft: 4 }}>
                      (剩余 <Text strong style={{ color: dotColor }}>{daysLeft}</Text> 天)
                    </span>
                  )}
                  {hw.status === '未提交' && daysLeft < 0 && (
                    <span style={{ marginLeft: 4, color: '#CF1322' }}>(已逾期)</span>
                  )}
                </span>
              )}
              {hw.description && (
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  {hw.description.replace(/<[^>]+>/g, '').slice(0, 120)}
                  {(hw.description.length > 120 || hw.attachments?.length > 0) ? '...' : ''}
                </div>
              )}
              {hw.teacherMessage && (
                <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                  老师留言: {String(hw.teacherMessage).replace(/<[^>]+>/g, '').slice(0, 120)}
                </div>
              )}
              {hw.attachments?.length > 0 && (
                <span style={{ fontSize: 12, color: '#660874', marginTop: 2 }}>
                  📎 {hw.attachments.length} 个附件
                </span>
              )}
            </div>
          }
        />
      </List.Item>
    )
  }

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!homeworks?.length) return <EmptyState description="暂无作业" />

  const hasActive = uncompleted.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
        <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['homework', courseId] })}>
          刷新
        </Button>
        {hasActive && (
          <Button icon={<RobotOutlined />} onClick={() => navigate(`/course/${courseId}/homework/auto`)}>
            甘蔗 tutor
          </Button>
        )}
      </div>

      {uncompleted.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#333' }}>
            未完成 ({uncompleted.length})
          </h3>
          <List
            dataSource={uncompleted}
            renderItem={(hw: any) => renderItem(hw, true, true)}
          />
        </div>
      )}

      {completed.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#333' }}>
            已完成 ({completed.length})
          </h3>
          <List
            dataSource={completed}
            renderItem={(hw: any) => renderItem(hw, false, false)}
          />
        </div>
      )}

      {expired.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#999' }}>
            已截止 ({expired.length})
          </h3>
          <List
            dataSource={expired}
            renderItem={(hw: any) => renderItem(hw, false, false)}
          />
        </div>
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
            dangerouslySetInnerHTML={{ __html: submitTarget.description }}
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
