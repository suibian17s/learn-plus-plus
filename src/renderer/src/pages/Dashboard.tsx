import { useEffect, useState } from 'react'
import { Button, Progress, Tag, message } from 'antd'
import {
  BellOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import tutorAvatar from '../assets/sugarcane-tutor.png'

const toneColors = ['purple', 'green', 'red', 'slate', 'blue'] as const

interface DashboardData {
  todayMinutes: number
  streakDays: number
  completedCourses: number
  totalCourses: number
  weeklyMinutes: number
  todayFocus: { priority: string; courseName: string; courseId: string; title: string; tag: string; targetTab: string; targetId?: string }[]
  courseProgress: { courseId: string; courseName: string; done: number; total: number; percent: number }[]
  recentUpdates: { courseId: string; courseName: string; text: string; time: string }[]
}

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

const fallbackCourses = [
  '大学生心理训练与潜能开发',
  '数据结构与算法',
  '线性代数',
  '高等数学（下）',
  '中国近现代史纲要',
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { courses, selectedCourseId } = useAuthStore()
  const primaryCourse = courses.find((course) => course.id === selectedCourseId) || courses[0]
  const courseNames = fallbackCourses.map((name, index) => courses[index]?.name || name)

  const [stats, setStats] = useState<DashboardData | null>(null)

  useEffect(() => {
    async function loadStats() {
      if (!courses.length) return
      const homeworksByCourse: Record<string, any[]> = {}
      const noticesByCourse: Record<string, any[]> = {}
      const discussionsByCourse: Record<string, any[]> = {}
      for (const c of courses) {
        try { homeworksByCourse[c.id] = await window.learn.hw.list(c.id) } catch { homeworksByCourse[c.id] = [] }
        try { noticesByCourse[c.id] = await window.learn.notice.list(c.id) } catch { noticesByCourse[c.id] = [] }
        try { discussionsByCourse[c.id] = await window.learn.disc.list(c.id) } catch { discussionsByCourse[c.id] = [] }
      }
      const result = await window.learn.stats.computeDashboard({ courses, homeworksByCourse, noticesByCourse, discussionsByCourse })
      setStats(result)
    }
    loadStats()
  }, [])

  function goCourse(tab: string) {
    if (!primaryCourse) {
      message.info('课程加载后即可进入')
      return
    }
    navigate(`/course/${primaryCourse.id}/${tab}`)
  }

  function goCourseTab(courseId: string, tab: string) {
    navigate(`/course/${courseId}/${tab}`)
  }

  function planned(label: string) {
    message.info(`${label} 将在 v2.0 后续开发中接入`)
  }

  function priorityIcon(p: string) {
    if (p === 'P0') return { icon: <ClockCircleOutlined />, tone: 'danger' as const }
    if (p === 'P1') return { icon: <BellOutlined />, tone: 'purple' as const }
    return { icon: <FileTextOutlined />, tone: 'slate' as const }
  }

  const overallPercent = stats
    ? Math.round(stats.courseProgress.reduce((s, c) => s + c.percent, 0) / Math.max(stats.courseProgress.length, 1))
    : 62

  const weeklyHours = stats
    ? (stats.weeklyMinutes / 60).toFixed(1) + ' h'
    : '18.6 h'

  const progressRows = stats
    ? stats.courseProgress.map((cp, i) => ({
        key: cp.courseId,
        name: cp.courseName,
        percent: cp.percent,
        tone: toneColors[i % toneColors.length],
        courseId: cp.courseId,
      }))
    : [68, 55, 40, 32, 25].map((pct, i) => ({
        key: courseNames[i],
        name: courseNames[i],
        percent: pct,
        tone: toneColors[i],
        courseId: courses[i]?.id || '',
      }))

  const focusItems = stats
    ? stats.todayFocus.slice(0, 6).map((item) => ({
        key: `${item.courseId}-${item.title}`,
        course: item.courseName,
        title: item.title,
        tag: item.tag,
        ...priorityIcon(item.priority),
        onClick: () => goCourseTab(item.courseId, item.targetTab),
      }))
    : ([
        { course: '高等数学（下）', title: '习题 3.2 截止', tag: '今日截止', tone: 'danger' as const, icon: <ClockCircleOutlined /> },
        { course: '心理学导论', title: '讨论回复', tag: '今日截止', tone: 'danger' as const, icon: <BellOutlined /> },
        { course: '数据结构与算法', title: '实验报告提交', tag: '明天截止', tone: 'purple' as const, icon: <FileTextOutlined /> },
      ] as any[]).map((item: any, i: number) => ({
        key: item.title,
        course: item.course,
        title: item.title,
        tag: item.tag,
        icon: item.icon,
        tone: item.tone,
        onClick: () => goCourse(i === 2 ? 'homework' : 'notifications'),
      }))

  const updates = stats
    ? stats.recentUpdates.map((u, i) => ({
        key: `${u.courseId}-${u.text}`,
        course: u.courseName,
        text: u.text,
        time: formatRelativeTime(u.time),
        tone: toneColors[i % toneColors.length],
      }))
    : [
        { key: '0', course: courseNames[0], text: '新增课件：第 3 章 情绪与压力管理', time: '1 小时前', tone: 'green' as const },
        { key: '1', course: courseNames[1], text: '更新课件：第 4 章 树与队列', time: '3 小时前', tone: 'slate' as const },
        { key: '2', course: courseNames[2], text: '作业发布：矩阵运算习题', time: '昨天', tone: 'purple' as const },
      ]

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
            <Button className="lp2-green-button" onClick={() => navigate('/tutor')}>
              问问甘蔗
            </Button>
          </div>
          <img src={tutorAvatar} alt="甘蔗 Tutor" />
        </div>
      </section>

      <div className="lp2-dashboard-grid">
        <section className="lp2-card lp2-overview-card">
          <div className="lp2-card-title">
            <span>全局学习进度</span>
          </div>
          <div className="lp2-overview-body">
            <Progress
              type="circle"
              percent={overallPercent}
              size={112}
              strokeWidth={11}
              strokeColor={{ '0%': '#6B46C1', '100%': '#8B5CF6' }}
              trailColor="#ECE5FA"
              format={() => (
                <span className="lp2-progress-center">
                  <strong>{overallPercent}%</strong>
                  <small>总进度</small>
                </span>
              )}
            />
            <div className="lp2-overview-metrics">
              <span><small>已完成课程</small><strong>{stats?.completedCourses ?? '...'} / {stats?.totalCourses ?? '...'}</strong></span>
              <span><small>本周学习时长</small><strong>{weeklyHours}</strong></span>
              <span><small>连续学习天数</small><strong>{stats?.streakDays ?? '...'} 天</strong></span>
            </div>
          </div>
        </section>

        <section className="lp2-card lp2-focus-card">
          <div className="lp2-card-title">
            <span>今日重点（所有课程）</span>
          </div>
          <div className="lp2-task-list">
            {focusItems.map((item: any) => (
              <button key={item.key} type="button" className="lp2-task-row" onClick={item.onClick}>
                <span className={`lp2-task-icon ${item.tone}`}>{item.icon}</span>
                <span>
                  <strong>{item.course}</strong>
                  <small>{item.title}</small>
                </span>
                <em className={`lp2-soft-tag ${item.tone}`}>{item.tag}</em>
              </button>
            ))}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => goCourse('homework')}>
            查看全部任务（{stats?.todayFocus.length ?? 6}）›
          </Button>
        </section>

        <section className="lp2-card lp2-course-progress-card">
          <div className="lp2-card-title">
            <span>所有课程进度</span>
          </div>
          <div className="lp2-course-progress-list">
            {progressRows.map((row: any, index: number) => (
              <button
                key={row.key}
                type="button"
                className="lp2-course-progress-row"
                onClick={() => {
                  if (stats && row.courseId) {
                    navigate(`/course/${row.courseId}/files`)
                  } else if (courses[index]) {
                    navigate(`/course/${courses[index].id}/files`)
                  } else {
                    planned('课程详情')
                  }
                }}
              >
                <span className={`lp2-course-mark ${row.tone}`}>{String.fromCharCode(65 + index)}</span>
                <span className="lp2-progress-name">{row.name}</span>
                <Progress percent={row.percent} showInfo={false} size="small" />
                <strong>{row.percent}%</strong>
              </button>
            ))}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => planned('课程说明')}>
            查看全部课程（{stats?.totalCourses ?? 13}）›
          </Button>
        </section>

        <section className="lp2-card lp2-updates-card">
          <div className="lp2-card-title">
            <span>最近更新</span>
          </div>
          <div className="lp2-update-list">
            {updates.map((item: any) => (
              <div key={item.key} className="lp2-update-row">
                <span className={`lp2-update-dot ${item.tone}`} />
                <span>
                  <strong>{item.course}</strong>
                  <small>{item.text}</small>
                </span>
                <time>{item.time}</time>
              </div>
            ))}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => planned('最近更新')}>
            查看全部记录 ›
          </Button>
        </section>

      </div>
    </div>
  )
}
