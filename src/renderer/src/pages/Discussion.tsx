import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, List, Spin } from 'antd'
import { MessageOutlined, RobotOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import EmptyState from '../components/EmptyState'
import TutorSummaryDrawer from '../components/TutorSummaryDrawer'

export default function DiscussionPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [summaryTarget, setSummaryTarget] = useState<any>(null)

  const { data: discussions, isLoading } = useQuery({
    queryKey: ['discussions', courseId],
    queryFn: () => window.learn.disc.list(courseId!),
    enabled: !!courseId,
  })

  const visibleDiscussions = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return discussions || []
    return (discussions || []).filter((item: any) => `${item.title || ''} ${item.author || ''}`.toLowerCase().includes(q))
  }, [discussions, keyword])

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!discussions?.length) return <EmptyState description="暂无讨论" />

  async function openDiscussion(item: any) {
    if (item.url) {
      await window.learn.disc.openWindow(item.url)
      return
    }
    navigate(`/course/${courseId}/discussion/detail/${item.id}`, { state: { disc: item } })
  }

  return (
    <div>
      <div className="lp2-course-local-toolbar">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索讨论"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <List
        dataSource={visibleDiscussions}
        renderItem={(item: any) => (
          <List.Item
            className="lp2-card"
            style={{
              marginBottom: 10,
              cursor: 'pointer',
            }}
            onClick={() => openDiscussion(item)}
            actions={[
              <Button
                key="tutor"
                className="lp2-green-button"
                size="small"
                icon={<RobotOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  setSummaryTarget(item)
                }}
              >
                甘蔗 Tutor
              </Button>
            ]}
          >
            <List.Item.Meta
              title={<span style={{ fontSize: 15, fontWeight: 500 }}>{item.title}</span>}
              description={
                <div>
                  <div style={{ color: '#666', marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
                    {item.author && <span><UserOutlined style={{ marginRight: 4 }} />{item.author}</span>}
                    <span>{item.publishTime}</span>
                    {item.lastReplierName && (
                      <span style={{ color: '#999' }}>最后回复: {item.lastReplierName}</span>
                    )}
                  </div>
                  <div style={{ color: '#999', marginTop: 4, fontSize: 13 }}>
                    <MessageOutlined style={{ marginRight: 4 }} />
                    {item.replyCount || 0} 条回复
                  </div>
                </div>
              }
            />
          </List.Item>
        )}
      />

      {summaryTarget && (
        <TutorSummaryDrawer
          open={!!summaryTarget}
          onClose={() => setSummaryTarget(null)}
          title={`讨论总结 · ${summaryTarget.title || ''}`}
          summaryKey={`discussion:${courseId}:${summaryTarget.id}`}
          run={(sessionId) => {
            const prompt = `请总结以下课程讨论：\n标题：${summaryTarget.title || ''}\n作者：${summaryTarget.author || ''}\n时间：${summaryTarget.publishTime || ''}\n回复数：${summaryTarget.replyCount || 0}`
            return window.learn.hwai.tutorAsk(courseId!, prompt, sessionId)
          }}
        />
      )}
    </div>
  )
}
