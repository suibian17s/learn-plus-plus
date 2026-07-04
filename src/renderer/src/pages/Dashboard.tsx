import { useEffect, useMemo, useState } from 'react'
import { Button, Progress, Spin, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useTutorStore } from '../store/tutor'
import CourseIcon from '../components/CourseIcon'
import tutorAvatar from '../assets/sugarcane-tutor.png'

interface DashboardData {
  todayMinutes: number
  streakDays: number
  completedCourses: number
  totalCourses: number
  coursesWithHomework: number
  weeklyMinutes: number
  todayFocus: { priority: string; courseName: string; courseId: string; title: string; tag: string; deadline?: string; targetTab: string; targetId?: string }[]
  courseProgress: { courseId: string; courseName: string; done: number; total: number; percent: number }[]
  recentUpdates: { courseId: string; courseName: string; text: string; time: string; kind?: string }[]
}

// Module-level cache — survives route navigation, avoids reloading on every visit
let cachedStats: DashboardData | null = null
let cachedKey = ''
let cachedVersion = 0

function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (isNaN(then)) return iso
  const diffMs = Date.now() - then
  if (diffMs < 0) return iso
  const diffHours = Math.floor(diffMs / 3600000)
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / 60000)
    return mins < 1 ? '刚刚' : `${mins} 分钟前`
  }
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { courses, statsVersion } = useAuthStore()

  const [stats, setStats] = useState<DashboardData | null>(cachedStats)
  const [statsLoading, setStatsLoading] = useState(!cachedStats && courses.length > 0)
  // Navigation to dedicated pages

  useEffect(() => {
    let cancelled = false
    async function loadStats() {
      if (!courses.length) return
      const key = courses.map((c) => c.id).sort().join(',')
      // Use cache if course IDs and version haven't changed
      if (key === cachedKey && statsVersion === cachedVersion && cachedStats) {
        if (!cancelled) { setStats(cachedStats); setStatsLoading(false) }
        return
      }
      setStatsLoading(true)
      try {
        // B14 fix: single IPC call instead of N*3 serial per-course calls.
        // Main process fetches all data in parallel with concurrency limit + 5-min TTL cache.
        const result = await window.learn.stats.refreshDashboard({ courses })
        if (!cancelled) {
          cachedStats = result
          cachedKey = key
          cachedVersion = statsVersion
          setStats(result)
        }
      } catch {
        if (!cancelled && !cachedStats) message.error('统计数据加载失败')
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    }
    loadStats()
    return () => { cancelled = true }
  }, [courses, statsVersion])

  function goCourseTab(courseId: string, tab: string) {
    navigate(`/course/${courseId}/${tab}`)
  }

  function formatDeadline(raw?: string): string {
    if (!raw) return ''
    const date = new Date(raw)
    if (isNaN(date.getTime())) return raw
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hour}:${minute}`
  }

  function formatRemainingDays(raw?: string): string {
    if (!raw) return ''
    const date = new Date(raw)
    if (isNaN(date.getTime())) return ''
    const dayMs = 24 * 60 * 60 * 1000
    const days = Math.max(0, Math.ceil((date.getTime() - Date.now()) / dayMs))
    return `剩余 ${days} 天`
  }

  const overallPercent = useMemo(() => {
    if (!stats || !stats.courseProgress.length) return 0
    // B12 fix: exclude courses with no homework (percent === -1) from average
    const withHw = stats.courseProgress.filter((cp: any) => cp.total > 0)
    if (withHw.length === 0) return 0
    return Math.round(withHw.reduce((s: number, c: any) => s + c.percent, 0) / withHw.length)
  }, [stats])

  const weeklyHours = stats ? (stats.weeklyMinutes / 60).toFixed(1) + ' h' : '0 h'

  const progressRows = useMemo(() => {
    if (!stats) return []
    return stats.courseProgress.map((cp) => ({
      key: cp.courseId,
      name: cp.courseName,
      percent: cp.percent,
      courseId: cp.courseId,
    }))
  }, [stats])

  const focusItems = useMemo(() => {
    if (!stats) return []
    return stats.todayFocus.slice(0, 6).map((item: any) => ({
      key: `${item.courseId}-${item.title}`,
      course: item.courseName,
      title: item.title,
      tag: item.tag,
      priority: item.priority,
      deadline: formatDeadline(item.deadline),
      remaining: formatRemainingDays(item.deadline),
      onClick: () => {
        if (item.targetTab === 'mailbox') {
          navigate(`/mailbox?mailId=${item.targetId}`)
        } else {
          goCourseTab(item.courseId, item.targetTab)
        }
      },
    }))
  }, [stats])

  const updates = useMemo(() => {
    if (!stats) return []
    // 快照含 100 条供"全部记录"页复用，首页卡片只展示前 10 条
    return stats.recentUpdates.slice(0, 10).map((u) => ({
      key: `${u.courseId}-${u.text}`,
      course: u.courseName,
      text: u.text,
      time: formatRelativeTime(u.time),
      kind: u.kind,
    }))
  }, [stats])

  // SWR：主进程后台刷新完成后推送最新数据，静默更新界面
  useEffect(() => {
    const unsub = window.learn.stats.onUpdated((fresh: any) => {
      cachedStats = fresh
      setStats(fresh)
    })
    return () => { unsub() }
  }, [])

  const isReady = !statsLoading && stats

  return (
    <div className="lp2-home">
      <section className="lp2-home-hero">
        <div className="lp2-hero-copy">
          <h1>你好，欢迎回来！</h1>
          <p>全局进度一览，规划你的学习之旅</p>
        </div>
        <div className="lp2-home-tutor-card">
          <div>
            <Tag color="green">甘蔗 Tutor</Tag>
            <h3>你的 AI 学习助手</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button className="lp2-green-button" onClick={() => navigate('/tutor')}>
                问问甘蔗
              </Button>
              <Button
                className="lp2-green-button"
                onClick={() => {
                  useTutorStore.getState().startFocused(null, '生成今日简报：我今天/近期要交的作业和收件箱里的新邮件概览')
                  navigate('/tutor')
                }}
              >
                今日简报
              </Button>
            </div>
          </div>
          <img src={tutorAvatar} alt="甘蔗 Tutor" />
        </div>
      </section>

      <div className="lp2-dashboard-grid">
        {/* ── 全局学习进度 ── */}
        <section className="lp2-card lp2-overview-card">
          <div className="lp2-card-title"><span>全局学习进度</span></div>
          <div className="lp2-overview-body">
            {statsLoading && !stats ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140 }}>
                <Spin />
              </div>
            ) : (
              <>
                <Progress
                  type="circle"
                  percent={overallPercent}
                  size={148}
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeColor={{ '0%': '#4C1D95', '52%': '#7C5CE6', '100%': '#B7A4FF' }}
                  trailColor="rgba(107, 70, 193, 0.12)"
                  format={() => (
                    <span className="lp2-progress-center">
                      <strong>{overallPercent}%</strong>
                      <small>总进度</small>
                    </span>
                  )}
                />
                <div className="lp2-overview-metrics">
                  <span><small>已完成课程</small><strong>{stats?.completedCourses ?? 0} / {stats?.coursesWithHomework ?? stats?.totalCourses ?? courses.length}</strong></span>
                  <span><small>本周学习时长</small><strong>{weeklyHours}</strong></span>
                  <span><small>连续学习天数</small><strong>{stats?.streakDays ?? 0} 天</strong></span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── 今日重点 ── */}
        <section className="lp2-card lp2-focus-card">
          <div className="lp2-card-title"><span>今日重点</span></div>
          <div className="lp2-task-list">
            {!isReady ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : focusItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无待办任务</div>
            ) : (
              focusItems.map((item: any) => (
                <button key={item.key} type="button" className={`lp2-task-row priority-${item.priority}`} onClick={item.onClick}>
                  <CourseIcon courseName={item.course} size="sm" />
                  <span><strong>{item.title}</strong><small>{item.course}</small></span>
                  <span className="lp2-task-meta">
                    <em>{item.remaining}</em>
                  </span>
                </button>
              ))
            )}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => navigate('/all-tasks')}>
            查看全部任务（{stats?.todayFocus.length ?? 0}）›
          </Button>
        </section>

        {/* ── 所有课程进度 ── */}
        <section className="lp2-card lp2-course-progress-card">
          <div className="lp2-card-title"><span>所有课程进度</span></div>
          <div className="lp2-course-progress-list">
            {!isReady ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : progressRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无课程数据</div>
            ) : (
              progressRows.map((row: any) => (
                <button
                  key={row.key} type="button" className="lp2-course-progress-row"
                  onClick={() => row.courseId && navigate(`/course/${row.courseId}/files`)}
                >
                  <CourseIcon courseName={row.name} size="sm" />
                  <span className="lp2-progress-name">{row.name}</span>
                  {row.percent >= 0 ? (
                    <>
                      <Progress percent={row.percent} showInfo={false} size="small" />
                      <strong>{row.percent}%</strong>
                    </>
                  ) : (
                    <span style={{ color: '#999', fontSize: 12, minWidth: 40, textAlign: 'right' }}>无作业</span>
                  )}
                </button>
              ))
            )}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => navigate('/all-courses')}>
            查看全部课程（{stats?.totalCourses ?? courses.length}）›
          </Button>
        </section>

        {/* ── 最近更新 ── */}
        <section className="lp2-card lp2-updates-card">
          <div className="lp2-card-title"><span>最近更新</span></div>
          <div className="lp2-update-list">
            {!isReady ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : updates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>暂无最近更新</div>
            ) : (
              updates.map((item: any) => (
                <div key={item.key} className="lp2-update-row">
                  <CourseIcon courseName={item.course} size="sm" />
                  <span><strong>{item.course}</strong><small>{item.text}</small></span>
                  <time>{item.time}</time>
                </div>
              ))
            )}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => navigate('/all-updates')}>
            查看全部记录 ›
          </Button>
        </section>
      </div>
    </div>
  )
}
