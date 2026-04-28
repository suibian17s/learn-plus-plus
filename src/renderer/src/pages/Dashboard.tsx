import { Button, Progress, Tag, message } from 'antd'
import {
  BellOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import tutorAvatar from '../assets/sugarcane-tutor.png'

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

  function goCourse(tab: string) {
    if (!primaryCourse) {
      message.info('课程加载后即可进入')
      return
    }
    navigate(`/course/${primaryCourse.id}/${tab}`)
  }

  function planned(label: string) {
    message.info(`${label} 将在 v2.0 后续开发中接入`)
  }

  const focusItems = [
    { course: '高等数学（下）', title: '习题 3.2 截止', tag: '今日截止', tone: 'danger', icon: <ClockCircleOutlined /> },
    { course: '心理学导论', title: '讨论回复', tag: '今日截止', tone: 'danger', icon: <BellOutlined /> },
    { course: '数据结构与算法', title: '实验报告提交', tag: '明天截止', tone: 'purple', icon: <FileTextOutlined /> },
  ]

  const progressRows = [68, 55, 40, 32, 25].map((progress, index) => ({
    name: courseNames[index],
    progress,
    tone: ['purple', 'green', 'red', 'slate', 'blue'][index],
  }))

  const updates = [
    { course: courseNames[0], text: '新增课件：第 3 章 情绪与压力管理', time: '1 小时前', tone: 'green' },
    { course: courseNames[1], text: '更新课件：第 4 章 树与队列', time: '3 小时前', tone: 'slate' },
    { course: courseNames[2], text: '作业发布：矩阵运算习题', time: '昨天', tone: 'purple' },
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
              percent={62}
              size={112}
              strokeWidth={11}
              strokeColor={{ '0%': '#6B46C1', '100%': '#8B5CF6' }}
              trailColor="#ECE5FA"
              format={() => (
                <span className="lp2-progress-center">
                  <strong>62%</strong>
                  <small>总进度</small>
                </span>
              )}
            />
            <div className="lp2-overview-metrics">
              <span><small>已完成课程</small><strong>8 / 13</strong></span>
              <span><small>本周学习时长</small><strong>18.6 h</strong></span>
              <span><small>连续学习天数</small><strong>14 天</strong></span>
            </div>
          </div>
        </section>

        <section className="lp2-card lp2-focus-card">
          <div className="lp2-card-title">
            <span>今日重点（所有课程）</span>
          </div>
          <div className="lp2-task-list">
            {focusItems.map((item, index) => (
              <button key={item.title} type="button" className="lp2-task-row" onClick={() => goCourse(index === 2 ? 'homework' : 'notifications')}>
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
            查看全部任务（6）›
          </Button>
        </section>

        <section className="lp2-card lp2-course-progress-card">
          <div className="lp2-card-title">
            <span>所有课程进度</span>
          </div>
          <div className="lp2-course-progress-list">
            {progressRows.map((row, index) => (
              <button
                key={row.name}
                type="button"
                className="lp2-course-progress-row"
                onClick={() => courses[index] ? navigate(`/course/${courses[index].id}/files`) : planned('课程详情')}
              >
                <span className={`lp2-course-mark ${row.tone}`}>{String.fromCharCode(65 + index)}</span>
                <span className="lp2-progress-name">{row.name}</span>
                <Progress percent={row.progress} showInfo={false} size="small" />
                <strong>{row.progress}%</strong>
              </button>
            ))}
          </div>
          <Button type="link" className="lp2-card-link" onClick={() => planned('课程说明')}>
            查看全部课程（13）›
          </Button>
        </section>

        <section className="lp2-card lp2-updates-card">
          <div className="lp2-card-title">
            <span>最近更新</span>
          </div>
          <div className="lp2-update-list">
            {updates.map((item) => (
              <div key={`${item.course}-${item.text}`} className="lp2-update-row">
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
