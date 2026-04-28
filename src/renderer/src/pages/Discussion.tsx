import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, List, Spin, message } from 'antd'
import { MessageOutlined, RobotOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import EmptyState from '../components/EmptyState'

export default function DiscussionPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')

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
        <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={() => message.info('甘蔗 Tutor 讨论总结将在后续接入')}>
          甘蔗 Tutor 总结
        </Button>
      </div>
      <List
        dataSource={visibleDiscussions}
        renderItem={(item: any) => (
          <List.Item
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: '16px 20px',
              marginBottom: 10,
              border: '1px solid #f0f0f0',
              cursor: 'pointer',
            }}
            onClick={() => openDiscussion(item)}
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
    </div>
  )
}
