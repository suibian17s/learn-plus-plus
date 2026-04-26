import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { List, Spin } from 'antd'
import { MessageOutlined, UserOutlined } from '@ant-design/icons'
import EmptyState from '../components/EmptyState'

export default function DiscussionPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()

  const { data: discussions, isLoading } = useQuery({
    queryKey: ['discussions', courseId],
    queryFn: () => window.learn.disc.list(courseId!),
    enabled: !!courseId,
  })

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
    <List
      dataSource={discussions}
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
  )
}
