import { useState, useEffect, useRef } from 'react'
import { Button, Input, Modal, Tag, message } from 'antd'
import {
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  WarningOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useTutorStore } from '../store/tutor'
import tutorAvatar from '../assets/sugarcane-tutor.png'

const quickActions = [
  { label: '总结课程内容', prompt: '请帮我总结当前课程的核心内容' },
  { label: '解释概念', prompt: '请解释以下概念：' },
  { label: '生成复习计划', prompt: '请根据当前课程内容帮我制定一个复习计划' },
  { label: '出几道练习题', prompt: '请根据当前课程内容出几道练习题，帮助我自查薄弱知识点' },
]


function getToolLabel(name: string): string {
  const map: Record<string, string> = {
    list_courses: '查询课程列表',
    list_homeworks: '查询作业列表',
    list_emails: '查询邮件',
    search_emails: '搜索邮件',
    get_email: '获取邮件详情',
    list_files: '查询课件列表',
    list_notices: '查询公告列表',
    list_discussions: '查询讨论列表',
    summarize_content: '正在总结内容',
    complete_homework: '查询作业信息',
    search_global: '全局搜索',
    get_stats: '获取学习统计',
  }
  return map[name] || `执行: ${name}`
}

function buildWelcome(style: 'cute' | 'serious'): string {
  if (style === 'cute') {
    return '诶嘿～ 我是甘蔗 Tutor！\n\n我可以帮你总结课程、解释知识点、制定学习计划，也能在合规前提下辅助你完成作业。尽管问我吧～'
  }
  return '你好，我是甘蔗 Tutor。\n\n我可以帮你总结课程内容、解释知识点、制定学习计划，也能在合规前提下辅助你完成作业。请直接提问。'
}

export default function TutorPage() {
  const navigate = useNavigate()
  const { courseId } = useParams()
  const { courses, selectedCourseId } = useAuthStore()
  const { messages, streaming, style, addMessage, setStreaming, setStyle, clearMessages } = useTutorStore()

  const [input, setInput] = useState('')
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [integrityOpen, setIntegrityOpen] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [healthModalOpen, setHealthModalOpen] = useState(false)
  const [healthError, setHealthError] = useState('')

  const sessionRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const chatStreamRef = useRef<HTMLDivElement>(null)

  const currentCourse =
    courses.find((c) => c.id === courseId) ||
    courses.find((c) => c.id === selectedCourseId) ||
    courses[0]

  // Load style on mount; show picker if never chosen
  useEffect(() => {
    window.learn.settings.getAll().then((s) => {
      if (s.tutorStyle) {
        setStyle(s.tutorStyle)
      } else {
        setShowStylePicker(true)
      }
    })
  }, [])

  // Health check on mount
  useEffect(() => {
    let cancelled = false
    window.learn.hwai.healthCheck().then((r) => {
      if (cancelled) return
      setOnline(r.ok)
      if (!r.ok) {
        setHealthError(r.error || '未知错误')
        setHealthModalOpen(true)
      }
    }).catch(() => {
      if (cancelled) return
      setOnline(false)
      setHealthError('无法连接到 AI 服务')
      setHealthModalOpen(true)
    })
    return () => { cancelled = true }
  }, [])

  // Seed welcome message
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({ role: 'assistant', content: buildWelcome(style) })
    }
  }, [style])

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight
    }
  }, [messages])

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  function selectStyle(s: 'cute' | 'serious') {
    setStyle(s)
    window.learn.settings.set({ tutorStyle: s })
    setShowStylePicker(false)
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    setInput('')

    addMessage({ role: 'user', content })
    // Placeholder for streaming assistant reply
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)
    setToolStatus(null)

    const sessionId = `tutor-${Date.now()}`
    sessionRef.current = sessionId

    // Clean up previous listeners
    unsubRef.current?.()

    let streamedContent = ''

    const unsubChunk = window.learn.hwai.onChunk((data) => {
      if (data.sessionId !== sessionId) return

      if (data.type === 'text' && data.delta) {
        streamedContent += data.delta
        useTutorStore.setState((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: streamedContent }
          }
          return { messages: msgs }
        })
      } else if (data.type === 'tool_call' && data.call) {
        const name = data.call.function?.name || 'unknown'
        setToolStatus(getToolLabel(name))
      } else if (data.type === 'tool_result') {
        setToolStatus(null)
      }
    })

    const unsubEnd = window.learn.hwai.onEnd((data) => {
      if (data.sessionId !== sessionId) return
      unsubChunk()
      unsubEnd()
      unsubRef.current = null
      setStreaming(false)
      setToolStatus(null)
      sessionRef.current = null

      // Append reference note to the final message
      useTutorStore.setState((s) => {
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && last.content) {
          msgs[msgs.length - 1] = {
            ...last,
            content: last.content + '\n\n<span class="lp2-reference-note">以下内容仅供学习参考，请根据课程要求自行判断与修改。</span>',
          }
        }
        return { messages: msgs }
      })
    })

    unsubRef.current = () => {
      unsubChunk()
      unsubEnd()
    }

    try {
      const allMessages = useTutorStore.getState().messages
      // Send messages up to (but not including) the just-added placeholder
      const history = allMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      await window.learn.hwai.tutorChat({
        messages: history,
        courseId: currentCourse?.id,
        style: useTutorStore.getState().style,
        sessionId,
      })
    } catch (err: any) {
      message.error('对话失败: ' + (err.message || '未知错误'))
      setStreaming(false)
      setToolStatus(null)
    }
  }

  function handleAbort() {
    if (sessionRef.current) {
      window.learn.hwai.tutorAbort(sessionRef.current)
    }
  }

  function handleNewChat() {
    clearMessages()
    addMessage({ role: 'assistant', content: buildWelcome(style) })
  }

  function openHomeworkAuto() {
    if (!currentCourse) {
      message.info('请先选择一门课程')
      return
    }
    navigate(`/course/${currentCourse.id}/homework/auto`)
  }

  function confirmHomeworkAssist() {
    setIntegrityOpen(false)
    openHomeworkAuto()
  }


  function renderMessageContent(content: string) {
    // Support basic newlines → <br/>
    return content.split('\n').map((line, i) => (
      <span key={i}>
        {i > 0 && <br />}
        <span dangerouslySetInnerHTML={line.startsWith('<span') ? { __html: line } : undefined}>
          {line.startsWith('<span') ? undefined : line}
        </span>
      </span>
    ))
  }

  return (
    <div className="lp2-tutor-page">
      <div className="lp2-tutor-chat-layout">
        <main className="lp2-ai-chat-panel">
          <div className="lp2-ai-chat-stream" ref={chatStreamRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`lp2-ai-message ${msg.role === 'assistant' ? 'tutor' : msg.role}`}>
                {msg.role === 'assistant' ? (
                  <img src={tutorAvatar} alt="甘蔗 Tutor" />
                ) : null}
                <div>{renderMessageContent(msg.content)}</div>
              </div>
            ))}

            {streaming && toolStatus && (
              <div className="lp2-ai-message tutor" style={{ opacity: 0.7 }}>
                <img src={tutorAvatar} alt="" />
                <div>
                  <em style={{ color: '#7CB342' }}>正在{toolStatus}...</em>
                </div>
              </div>
            )}
          </div>

          {online !== null && (
            <div style={{
              textAlign: 'center', padding: '4px 0',
              color: online ? '#52C41A' : '#8C8C8C', fontSize: 12,
            }}>
              <Tag color={online ? 'green' : 'default'}>
                {online ? '在线' : '离线'}
              </Tag>
            </div>
          )}

          <div className="lp2-ai-quick-row">
            {quickActions.map((action) => (
              <button key={action.label} type="button" onClick={() => setInput(action.prompt)}>
                {action.label}
              </button>
            ))}
            <button type="button" className="warning" onClick={() => setIntegrityOpen(true)}>
              一键完成作业
            </button>
          </div>

          <div className="lp2-ai-input-bar">
            <Input
              placeholder="向甘蔗 Tutor 提问..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={() => sendMessage()}
              disabled={streaming}
            />
            {streaming ? (
              <Button danger icon={<StopOutlined />} onClick={handleAbort}>
                停止
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={() => sendMessage()}>
                发送
              </Button>
            )}
            <Button
              icon={<DeleteOutlined />}
              onClick={handleNewChat}
              disabled={streaming}
              title="新对话"
            />
          </div>
        </main>

      </div>

      {/* First-use style picker */}
      <Modal
        title="选择甘蔗 Tutor 风格"
        open={showStylePicker}
        footer={null}
        closable={false}
        maskClosable={false}
        width={420}
      >
        <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
          <div
            onClick={() => selectStyle('cute')}
            style={{
              flex: 1,
              padding: '20px 16px',
              border: '2px solid #7CB342',
              borderRadius: 12,
              cursor: 'pointer',
              textAlign: 'center',
              background: '#f6ffed',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>
              <img src={tutorAvatar} alt="" style={{ width: 48, height: 48 }} />
            </div>
            <strong style={{ display: 'block', marginBottom: 4 }}>可爱风</strong>
            <small style={{ color: '#666' }}>
              正太语气，俏皮活泼
              <br />
              诶嘿～ 交给我吧！
            </small>
          </div>
          <div
            onClick={() => selectStyle('serious')}
            style={{
              flex: 1,
              padding: '20px 16px',
              border: '2px solid #e8e8e8',
              borderRadius: 12,
              cursor: 'pointer',
              textAlign: 'center',
              background: '#fafafa',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>
              <RobotOutlined style={{ fontSize: 48, color: '#6B46C1' }} />
            </div>
            <strong style={{ display: 'block', marginBottom: 4 }}>正经风</strong>
            <small style={{ color: '#666' }}>
              专业学术助手
              <br />
              简洁直接，严谨高效
            </small>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, color: '#888', fontSize: 13 }}>
          风格可随时在设置页中更改
        </div>
      </Modal>

      {/* Academic integrity modal */}
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

      {/* Health check failure modal */}
      <Modal
        title="甘蔗 Tutor 当前离线"
        open={healthModalOpen}
        onOk={() => setHealthModalOpen(false)}
        onCancel={() => setHealthModalOpen(false)}
        okText="知道了"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <p>甘蔗 Tutor 当前无法连接到 AI 服务。</p>
        <p style={{ color: '#888' }}>错误信息：{healthError}</p>
        <p>请检查：</p>
        <ul>
          <li>设置页中是否已配置 API Key</li>
          <li>网络连接是否正常</li>
          <li>所选模型服务是否可用</li>
        </ul>
      </Modal>
    </div>
  )
}
