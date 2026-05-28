import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spin, Empty, Tag } from 'antd'
import { useAuthStore } from '../store/auth'
import CourseIcon from '../components/CourseIcon'

function formatTime(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  const y = d.getFullYear(); const m = d.getMonth() + 1; const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

const kindColors: Record<string, string> = { notice: 'blue', homework: 'purple', file: 'green', discussion: 'orange' }

export default function AllUpdatesPage() {
  const navigate = useNavigate()
  const { courses } = useAuthStore()
  const [updates, setUpdates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const items: any[] = []
      for (const c of courses) {
        try {
          const notices = await window.learn.notice.list(c.id)
          for (const n of notices) {
            items.push({ courseId: c.id, courseName: c.name, text: n.title, time: n.publishTime, kind: 'notice' })
          }
        } catch { /* ignore */ }
        try {
          const hws = await window.learn.hw.list(c.id)
          for (const hw of hws) {
            const t = hw.publishTime || hw.startTime || hw.createTime || ''
            if (!t) continue
            items.push({ courseId: c.id, courseName: c.name, text: hw.title, time: t, kind: 'homework' })
          }
        } catch { /* ignore */ }
      }
      items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      if (!cancelled) { setUpdates(items.slice(0, 50)); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [courses])

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />
  if (!updates.length) return <Empty description="暂无最近更新" style={{ marginTop: 60 }} />

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 28, marginTop: 8 }}>全部最近更新</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {updates.map((item, i) => (
          <div key={`${item.courseId}-${item.text}-${i}`}
            onClick={() => navigate(`/course/${item.courseId}/${item.kind === 'homework' ? 'homework' : 'notifications'}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, width: '100%',
              border: '1px solid #ECE5F5', borderRadius: 16, padding: '20px 24px',
              cursor: 'pointer', background: '#fff',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 16px rgba(107,70,193,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = ''}
          >
            <CourseIcon courseName={item.courseName} size="lg" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>{item.text}</strong>
              <small style={{ color: '#888', fontSize: 14 }}>{item.courseName}</small>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Tag color={kindColors[item.kind] || 'default'}>{item.kind === 'notice' ? '公告' : item.kind === 'homework' ? '作业' : item.kind}</Tag>
              <time style={{ color: '#999', fontSize: 13, whiteSpace: 'nowrap' }}>{formatTime(item.time)}</time>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
