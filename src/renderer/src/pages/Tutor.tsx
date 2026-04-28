import { useState } from 'react'
import { Button, Input, Modal, Tag, message } from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  GlobalOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import tutorAvatar from '../assets/sugarcane-tutor.png'

const featureList = [
  { title: '知识总结', desc: '把课程资料整理成重点、摘要和复习提纲', icon: <FileTextOutlined /> },
  { title: '全局辅助', desc: '结合课程、邮件、公告与作业安排学习任务', icon: <GlobalOutlined /> },
  { title: '出题练习', desc: '生成随堂练习题，帮助自查薄弱知识点', icon: <CheckCircleOutlined /> },
  { title: '学习计划', desc: '按考试与截止时间规划复习节奏', icon: <CalendarOutlined /> },
  { title: '一键完成作业', desc: '生成参考思路与解题框架，仅供学习参考', icon: <ThunderboltOutlined />, integrity: true },
]

export default function TutorPage() {
  const navigate = useNavigate()
  const { courseId } = useParams()
  const { courses, selectedCourseId } = useAuthStore()
  const [integrityOpen, setIntegrityOpen] = useState(false)
  const currentCourse = courses.find((course) => course.id === courseId)
    || courses.find((course) => course.id === selectedCourseId)
    || courses[0]

  function planned(label: string) {
    message.info(`${label} 将在 v2.0 后续开发中接入`)
  }

  function openHomeworkAuto() {
    if (!currentCourse) {
      message.info('课程加载后即可进入作业辅助流程')
      return
    }
    navigate(`/course/${currentCourse.id}/homework/auto`)
  }

  function confirmHomeworkAssist() {
    setIntegrityOpen(false)
    openHomeworkAuto()
  }

  function handleFeatureClick(item: (typeof featureList)[number]) {
    if (item.integrity) {
      setIntegrityOpen(true)
      return
    }
    planned(item.title)
  }

  return (
    <div className="lp2-tutor-page">
      <div className="lp2-tutor-chat-layout">
        <main className="lp2-ai-chat-panel">
          <div className="lp2-ai-chat-stream">
            <div className="lp2-ai-message tutor">
              <img src={tutorAvatar} alt="甘蔗 Tutor" />
              <div>
                <strong>Hi~ 我是甘蔗 Tutor</strong>
                <p>
                  我可以帮你总结课程内容、解释知识点、制定学习计划，也能在合规前提下辅助你完成作业。
                  现在可以直接向我提问。
                </p>
              </div>
            </div>

            <div className="lp2-ai-message user">
              <div>如何理解考试前的压力和焦虑？</div>
            </div>

            <div className="lp2-ai-message tutor">
              <img src={tutorAvatar} alt="" />
              <div>
                <p>可以从四个方向处理：</p>
                <ol>
                  <li>规律作息：保证充足睡眠，避免熬夜。</li>
                  <li>合理规划：把复习拆成小任务，减少失控感。</li>
                  <li>放松训练：用深呼吸、冥想或运动降低紧张。</li>
                  <li>积极暗示：关注自己已经完成的努力。</li>
                </ol>
                <p className="lp2-reference-note">以下内容仅供学习参考，请根据课程要求自行判断与修改。</p>
              </div>
            </div>
          </div>

          <div className="lp2-ai-quick-row">
            <button type="button" onClick={() => planned('总结课程内容')}>总结课程内容</button>
            <button type="button" onClick={() => planned('解释概念')}>解释概念</button>
            <button type="button" onClick={() => planned('生成复习计划')}>生成复习计划</button>
            <button type="button" onClick={() => planned('出几道练习题')}>出几道练习题</button>
            <button type="button" className="warning" onClick={() => setIntegrityOpen(true)}>一键完成作业</button>
          </div>

          <div className="lp2-ai-input-bar">
            <Input placeholder="向甘蔗 Tutor 提问..." onPressEnter={() => planned('Tutor 对话')} />
            <Button type="primary" icon={<SendOutlined />} onClick={() => planned('Tutor 对话')} />
          </div>
        </main>

        <aside className="lp2-ai-side-panel">
          <section className="lp2-ai-profile-card">
            <div className="lp2-ai-profile-top">
              <span>
                <RobotOutlined />
                甘蔗 Tutor
              </span>
              <Tag color="green">在线</Tag>
            </div>
            <img src={tutorAvatar} alt="甘蔗 Tutor" />
            <h2>你的 AI 学习助手</h2>
            <p>{currentCourse ? `当前参考课程：${currentCourse.name}` : '选择课程后可自动带入学习上下文'}</p>
          </section>

          <section className="lp2-ai-feature-panel">
            <h3>可用功能</h3>
            <div className="lp2-ai-feature-list">
              {featureList.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className={item.integrity ? 'integrity' : ''}
                  onClick={() => handleFeatureClick(item)}
                >
                  <span>{item.icon}</span>
                  <strong>{item.title}</strong>
                  <small>{item.desc}</small>
                </button>
              ))}
            </div>
            <div className="lp2-ai-integrity-note">
              <WarningOutlined />
              <span>一键完成作业仅用于理解题意、生成参考思路与自查，请遵守课程规范。</span>
            </div>
          </section>
        </aside>
      </div>

      <Modal
        title="学术诚信提醒"
        open={integrityOpen}
        onOk={confirmHomeworkAssist}
        onCancel={() => setIntegrityOpen(false)}
        okText="我知道了，继续辅助"
        cancelText="取消"
        className="lp2-integrity-modal"
      >
        <div className="lp2-integrity-box">
          <WarningOutlined />
          <p>
            该功能生成内容仅供学习参考。请确认你的使用方式符合课程要求与学校学术规范，
            不建议直接提交生成内容。
          </p>
        </div>
      </Modal>
    </div>
  )
}
