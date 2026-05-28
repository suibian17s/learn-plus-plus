import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, List, Drawer, Input, Modal, Typography, Spin, Tag } from 'antd'
import { DownloadOutlined, FolderOpenOutlined, PaperClipOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons'
import DOMPurify from 'dompurify'
import EmptyState from '../components/EmptyState'
import { useDownloadStore } from '../store/downloads'
import { formatDateTime } from '../utils/time'

export default function NotificationsPage() {
  const { courseId } = useParams()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [downloadingAttachment, setDownloadingAttachment] = useState(false)
  const [attachmentState, setAttachmentState] = useState<{ downloaded: boolean; destPath: string } | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const downloadRecords = useDownloadStore((s) => s.downloads)
  const addDownloadRecord = useDownloadStore((s) => s.addOrUpdate)

  const { data: notices, isLoading } = useQuery({
    queryKey: ['notices', courseId],
    queryFn: () => window.learn.notice.list(courseId!),
    enabled: !!courseId,
  })

  const filteredNotices = notices?.filter((notice: any) => {
    const q = keyword.trim().toLowerCase()
    if (!q) return true
    return `${notice.title || ''} ${notice.publisher || ''}`.toLowerCase().includes(q)
  })
  const detail = notices?.find((n: any) => n.id === detailId)
  const attachmentHistory = detail?.attachment?.name
    ? downloadRecords.find((item) => (
      item.status === 'completed' &&
      item.destPath &&
      item.fileName === detail.attachment.name
    ))
    : null
  const downloadedAttachmentPath = attachmentState?.downloaded
    ? attachmentState.destPath
    : attachmentHistory?.destPath

  useEffect(() => {
    if (!detail?.attachment?.name) {
      setAttachmentState(null)
      return
    }

    let alive = true
    window.learn.files.downloadState(detail.attachment.name).then((state) => {
      if (alive) setAttachmentState(state)
    })
    return () => {
      alive = false
    }
  }, [detail?.attachment?.name])

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />

  if (!notices?.length) return <EmptyState description="暂无公告" />

  async function downloadAttachment(attachment: any) {
    if (!attachment?.downloadUrl || !attachment?.name) return
    setDownloadingAttachment(true)
    try {
      const result = await window.learn.hw.downloadAttachment(attachment.downloadUrl, attachment.name)
      if (result?.destPath) {
        addDownloadRecord({
          id: result.downloadId,
          fileName: attachment.name,
          loaded: 0,
          total: 0,
          status: 'completed',
          destPath: result.destPath,
          time: Date.now(),
        })
        setAttachmentState({ downloaded: true, destPath: result.destPath })
        await window.learn.files.openFolder(result.destPath)
      }
    } finally {
      setDownloadingAttachment(false)
    }
  }

  async function summarizeAllNotices() {
    const source = notices || []
    if (!source.length) return
    setSummaryOpen(true)
    setSummaryLoading(true)
    setSummaryText('')
    try {
      const content = source.slice(0, 40).map((notice: any, index: number) => {
        const plainContent = (notice.htmlContent || notice.content || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return [
          `#${index + 1} ${notice.title || '无标题'}`,
          `发布人：${notice.publisher || '未知'}`,
          `时间：${notice.publishTime || ''}`,
          `内容：${plainContent.slice(0, 1200)}`,
        ].join('\n')
      }).join('\n\n')
      const prompt = `请总结这个课程的全部公告，按重要事项、时间安排、需要学生行动、附件/材料线索四类整理，最后给出优先级建议。\n\n${content}`
      const result = await window.learn.hwai.tutorAsk(courseId!, prompt)
      setSummaryText(result.content || '总结生成失败')
    } catch (err: any) {
      setSummaryText('总结生成失败：' + (err.message || '未知错误'))
    } finally {
      setSummaryLoading(false)
    }
  }

  return (
    <div>
      <style>
        {`
          .notice-html img {
            display: block;
            max-width: 100%;
            height: auto;
            margin: 12px 0;
          }
          .notice-html table {
            max-width: 100%;
          }
        `}
      </style>
      <div className="lp2-course-local-toolbar lp2-notice-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索公告" allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={summarizeAllNotices}>
          甘蔗 Tutor 总结
        </Button>
      </div>

      <List
        dataSource={filteredNotices}
        renderItem={(item: any) => (
          <List.Item
            onClick={() => setDetailId(item.id)}
            style={{ cursor: 'pointer', padding: '14px 0' }}
          >
            <List.Item.Meta
              title={
                <span style={{ fontSize: 15, fontWeight: 500 }}>
                  {item.publisher && <Tag color="purple" style={{ marginRight: 6 }}>{item.publisher}</Tag>}
                  {item.title}
                </span>
              }
              description={formatDateTime(item.publishTime)}
            />
          </List.Item>
        )}
      />

      <Drawer
        title={detail?.title}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={640}
      >
        {detail && (
          <Typography>
            <div
              className="notice-html"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(detail.htmlContent || detail.content || '', {
                  ADD_ATTR: ['style', 'width', 'height', 'align', 'target', 'data-original-src'],
                }),
              }}
              style={{ lineHeight: 1.8 }}
            />
            {detail.attachment && (
              <div style={{
                marginTop: 20,
                padding: '12px 14px',
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <PaperClipOutlined style={{ color: '#666' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {detail.attachment.name}
                  </span>
                  {detail.attachment.size && (
                    <span style={{ color: '#999', fontSize: 12 }}>{detail.attachment.size}</span>
                  )}
                </span>
                {downloadedAttachmentPath ? (
                  <Button
                    size="small"
                    icon={<FolderOpenOutlined />}
                    style={{ color: '#52C41A' }}
                    onClick={() => window.learn.files.openFolder(downloadedAttachmentPath)}
                  >
                    已下载
                  </Button>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    loading={downloadingAttachment}
                    onClick={() => downloadAttachment(detail.attachment)}
                  >
                    下载
                  </Button>
                )}
              </div>
            )}
            {detail.publishTime && (
              <div style={{ color: '#999', marginTop: 24, fontSize: 13 }}>
                发布于 {formatDateTime(detail.publishTime)}
              </div>
            )}
          </Typography>
        )}
      </Drawer>

      <Modal
        title="甘蔗 Tutor 公告总结"
        open={summaryOpen}
        onCancel={() => setSummaryOpen(false)}
        footer={null}
        width={600}
      >
        {summaryLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
            <p style={{ marginTop: 12, color: '#888' }}>正在生成公告总结...</p>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{summaryText}</div>
        )}
      </Modal>
    </div>
  )
}
