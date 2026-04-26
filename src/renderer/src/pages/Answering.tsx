import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { List, Tag, Spin } from 'antd'
import { QuestionCircleOutlined, UserOutlined, ClockCircleOutlined } from '@ant-design/icons'
import EmptyState from '../components/EmptyState'

export default function AnsweringPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()

  const { data: answerings, isLoading } = useQuery({
    queryKey: ['answerings', courseId],
    queryFn: () => window.learn.answering.list(courseId!),
    enabled: !!courseId,
  })

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!answerings?.length) return <EmptyState description="暂无答疑" />

  return (
    <List
      dataSource={answerings}
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
          onClick={() => navigate(`/course/${courseId}/answering/detail/${item.id}`, { state: { question: item } })}
        >
          <List.Item.Meta
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="orange" icon={<QuestionCircleOutlined />}>答疑</Tag>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{item.question}</span>
              </div>
            }
            description={
              <div style={{ color: '#666', marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
                {item.author && <span><UserOutlined style={{ marginRight: 4 }} />{item.author}</span>}
                <span><ClockCircleOutlined style={{ marginRight: 4 }} />{item.askTime}</span>
                {item.replyCount > 0 && <span>{item.replyCount} 条回复</span>}
              </div>
            }
          />
        </List.Item>
      )}
    />
  )
}
