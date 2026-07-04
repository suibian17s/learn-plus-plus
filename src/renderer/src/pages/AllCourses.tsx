import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Progress, Spin, Empty } from 'antd'
import { useAuthStore } from '../store/auth'
import CourseIcon from '../components/CourseIcon'

export default function AllCoursesPage() {
  const navigate = useNavigate()
  const { courses } = useAuthStore()
  const [progress, setProgress] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const items: any[] = []
      // 复用主进程 dashboard 快照（缓存命中毫秒级），不再逐课串行拉取
      try {
        const snapshot: any = await window.learn.stats.refreshDashboard({ courses })
        const teacherById = new Map(courses.map((c) => [c.id, c.teacher]))
        for (const cp of snapshot?.courseProgress || []) {
          items.push({
            courseId: cp.courseId,
            courseName: cp.courseName,
            teacher: teacherById.get(cp.courseId) || '',
            done: cp.done,
            total: cp.total,
            percent: cp.total > 0 ? cp.percent : 100,
          })
        }
      } catch { /* ignore */ }
      items.sort((a, b) => { if (a.total === 0 && b.total > 0) return 1; if (b.total === 0 && a.total > 0) return -1; return a.courseName.localeCompare(b.courseName, 'zh') })
      if (!cancelled) { setProgress(items); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [courses])

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />
  if (!progress.length) return <Empty description="暂无课程" style={{ marginTop: 60 }} />

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 28, marginTop: 8 }}>全部课程</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {progress.map((row) => (
          <button key={row.courseId} type="button"
            onClick={() => navigate(`/course/${row.courseId}/files`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, width: '100%',
              border: '1px solid #ECE5F5', borderRadius: 16, padding: '20px 24px',
              cursor: 'pointer', background: '#fff', textAlign: 'left',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 16px rgba(107,70,193,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = ''}
          >
            <CourseIcon courseName={row.courseName} size="lg" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>{row.courseName}</strong>
              <small style={{ color: '#888', fontSize: 14 }}>
                {row.teacher}{row.total === 0 ? ' · 无作业' : ` · ${row.done}/${row.total} 已完成`}
              </small>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <Progress percent={row.percent} showInfo={false} size="small" style={{ width: 120 }} />
              <strong style={{ fontSize: 16, minWidth: 40, textAlign: 'right' }}>{row.percent}%</strong>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
