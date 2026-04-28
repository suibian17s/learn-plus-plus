import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { List, Button, Tag, Spin } from 'antd'
import { ExportOutlined, ClockCircleOutlined } from '@ant-design/icons'
import EmptyState from '../components/EmptyState'

export default function QuestionnairePage() {
  const { courseId } = useParams()

  const { data: questionnaires, isLoading } = useQuery({
    queryKey: ['questionnaires', courseId],
    queryFn: () => window.learn.questionnaire.list(courseId!),
    enabled: !!courseId,
  })

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (!questionnaires?.length) return <EmptyState description="暂无问卷" />

  return (
    <List
      dataSource={questionnaires}
      renderItem={(item: any) => (
        <List.Item
          className="lp2-card"
          style={{
            marginBottom: 10,
          }}
          actions={[
            <Button
              key="open"
              icon={<ExportOutlined />}
              onClick={() => window.learn.openExternal(item.url)}
            >
              在网页学堂填写
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={<span style={{ fontSize: 15, fontWeight: 500 }}>{item.title}</span>}
            description={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag>{item.status}</Tag>
                {item.deadline && (
                  <span style={{ color: '#999', fontSize: 13 }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    截止: {item.deadline}
                  </span>
                )}
              </div>
            }
          />
        </List.Item>
      )}
    />
  )
}
