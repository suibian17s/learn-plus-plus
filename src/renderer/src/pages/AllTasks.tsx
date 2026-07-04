import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spin, Empty } from 'antd'
import { useAuthStore } from '../store/auth'
import CourseIcon from '../components/CourseIcon'

const priorityColors: Record<string, { bg: string; border: string; text: string; tag: string }> = {
  P0: { bg: '#FFF1F2', border: '#FECDD3', text: '#B91C1C', tag: '#DC2626' },
  P1: { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C', tag: '#D97706' },
  P2: { bg: '#F5F3FF', border: '#DDD6FE', text: '#5B21B6', tag: '#6B46C1' },
}

function classifyDeadline(raw: string): { priority: 'P0' | 'P1' | 'P2'; tag: string; deadlineText: string; deadlineTime: number } | null {
  const dl = new Date(raw)
  if (isNaN(dl.getTime()) || dl < new Date()) return null
  const now = new Date()
  const deadlineText = `${dl.getMonth() + 1}/${dl.getDate()} ${String(dl.getHours()).padStart(2, '0')}:${String(dl.getMinutes()).padStart(2, '0')}`
  const remainingDays = Math.max(0, Math.ceil((dl.getTime() - now.getTime()) / 86400000))
  const tag = `剩余 ${remainingDays} 天`
  if (remainingDays <= 1) return { priority: 'P0', tag, deadlineText, deadlineTime: dl.getTime() }
  if (remainingDays <= 3) return { priority: 'P1', tag, deadlineText, deadlineTime: dl.getTime() }
  return { priority: 'P2', tag, deadlineText, deadlineTime: dl.getTime() }
}

export default function AllTasksPage() {
  const navigate = useNavigate()
  const { courses } = useAuthStore()
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // 复用主进程 dashboard 快照（缓存命中毫秒级），不再逐课串行拉取
      const all: any[] = []
      try {
        const snapshot: any = await window.learn.stats.refreshDashboard({ courses })
        for (const item of snapshot?.todayFocus || []) {
          const deadline = classifyDeadline(item.deadline || '')
          if (!deadline) continue
          all.push({
            ...deadline,
            courseName: item.courseName,
            courseId: item.courseId,
            title: item.title,
            targetTab: item.targetTab || 'homework',
          })
        }
      } catch { /* ignore */ }
      all.sort((a, b) => {
        const order = { P0: 0, P1: 1, P2: 2 } as Record<string, number>
        const byPriority = (order[a.priority] || 3) - (order[b.priority] || 3)
        return byPriority || a.deadlineTime - b.deadlineTime
      })
      if (!cancelled) { setTasks(all); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [courses])

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />
  if (!tasks.length) return <Empty description="暂无待办任务" style={{ marginTop: 60 }} />

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 28, marginTop: 8 }}>全部任务</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tasks.map((item) => {
          const c = priorityColors[item.priority] || priorityColors.P2
          return (
            <button key={`${item.courseId}-${item.title}`} type="button"
              onClick={() => navigate(`/course/${item.courseId}/${item.targetTab}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                border: `1px solid ${c.border}`, borderRadius: 16, padding: '20px 24px',
                cursor: 'pointer', background: c.bg, textAlign: 'left',
                transition: 'box-shadow 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.boxShadow = ''}
            >
              <CourseIcon courseName={item.courseName} size="lg" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>{item.title}</strong>
                <small style={{ color: '#888', fontSize: 14 }}>{item.courseName} · {item.deadlineText}</small>
              </span>
              <span style={{
                background: c.tag, color: '#fff', borderRadius: 999, padding: '5px 12px',
                fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {item.tag}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
