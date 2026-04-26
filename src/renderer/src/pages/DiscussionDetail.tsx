import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Empty, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  MessageOutlined,
  UserOutlined,
} from '@ant-design/icons'

const { Title } = Typography

export default function DiscussionDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const disc = (location.state as any)?.disc

  if (!disc) return <Empty description="讨论不存在" />

  return (
    <div style={{ maxWidth: 800 }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ padding: 0, marginBottom: 16 }}
      >
        返回列表
      </Button>

      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', padding: 24 }}>
        <Title level={4} style={{ marginBottom: 12 }}>
          {disc.title}
        </Title>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20, color: '#666', fontSize: 13 }}>
          {disc.author && (
            <span><UserOutlined style={{ marginRight: 4 }} />{disc.author}</span>
          )}
          <span><ClockCircleOutlined style={{ marginRight: 4 }} />{disc.publishTime}</span>
          <span><MessageOutlined style={{ marginRight: 4 }} />{disc.replyCount || 0} 条回复</span>
        </div>

        <Empty
          description="讨论区帖子包含头像、点赞、评论、回复等原站交互，已改为在 learn++ 内置完整页面中打开。"
        >
          <Button
            type="primary"
            icon={<ExportOutlined />}
            onClick={() => window.learn.disc.openWindow(disc.url)}
            disabled={!disc.url}
          >
            打开完整讨论页
          </Button>
        </Empty>
      </div>
    </div>
  )
}
