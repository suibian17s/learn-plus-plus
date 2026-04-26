import { useNavigate, useParams } from 'react-router-dom'
import { Card, Button, Space } from 'antd'
import { BellOutlined, FolderOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

export default function Dashboard() {
  const navigate = useNavigate()
  const { courseId } = useParams()
  const { courses } = useAuthStore()
  const cid = courseId || courses[0]?.id

  const actions = [
    { icon: <BellOutlined />, title: '课程公告', desc: '查看最新通知', path: `/course/${cid}/notifications` },
    { icon: <FolderOutlined />, title: '课件下载', desc: '下载课程资料', path: `/course/${cid}/files` },
    { icon: <FileTextOutlined />, title: '作业管理', desc: '查看与提交作业', path: `/course/${cid}/homework` },
    { icon: <RobotOutlined />, title: '甘蔗 tutor', desc: '公告、课件、作业、讨论的全栈式 AI 学习助手', path: `/course/${cid}/homework/auto` },
  ]

  if (!cid) return null

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, color: '#1a1a2e' }}>欢迎使用 learn++</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {actions.map((a) => (
          <Card
            key={a.path}
            hoverable
            onClick={() => navigate(a.path)}
            style={{ borderRadius: 10, cursor: 'pointer' }}
          >
            <Space direction="vertical" size={8}>
              <span style={{ fontSize: 32, color: '#660874' }}>{a.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{a.title}</div>
                <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>{a.desc}</div>
              </div>
            </Space>
          </Card>
        ))}
      </div>
    </div>
  )
}
