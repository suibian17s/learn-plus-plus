import { useState, useEffect, useRef } from 'react'
import { Button, Dropdown, Input, Modal, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  DeleteOutlined,
  HistoryOutlined,
  PictureOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useTutorStore, useCurrentTutorMessages, type TutorNav } from '../store/tutor'
import MarkdownRenderer from '../components/MarkdownRenderer'
import tutorAvatar from '../assets/sugarcane-tutor.png'

// 启发式判断模型是否支持图片输入（覆盖主流视觉模型；仅用于发图前的非阻塞提示）
function modelLikelySupportsVision(model: string): boolean {
  const m = model.toLowerCase()
  return /vl|vision|4v|gpt-4o|gpt-4\.|gpt-5|claude|gemini|o1|o3|o4|pixtral|llava|internvl/.test(m)
}

const guideCards = [
  { title: '本周要交什么', desc: '汇总全部课程的截止任务', prompt: '我最近有哪些作业要交？按紧急程度排一下' },
  { title: '解释概念', desc: '把不懂的知识点讲明白', prompt: '请解释以下概念：' },
  { title: '出几道练习题', desc: '自查薄弱知识点', prompt: '请根据当前课程内容出几道练习题，帮助我自查薄弱知识点' },
  { title: '生成复习计划', desc: '结合课程安排定计划', prompt: '请根据当前课程内容帮我制定一个复习计划' },
]

const quickActions = [
  { label: '今日简报', prompt: '生成今日简报：我今天/近期要交的作业和收件箱里的新邮件概览' },
  { label: '解释概念', prompt: '请解释以下概念：' },
  { label: '出练习题', prompt: '请根据当前课程内容出几道练习题' },
  { label: '复习计划', prompt: '请根据当前课程内容帮我制定一个复习计划' },
]

function getToolLabel(name: string): string {
  const map: Record<string, string> = {
    list_courses: '查询课程列表',
    list_homeworks: '查询作业列表',
    get_homework_detail: '阅读作业详情与附件',
    list_emails: '查询邮件',
    search_emails: '搜索邮件',
    get_email: '读取邮件详情',
    list_files: '查询课件列表',
    get_file_content: '下载并阅读课件',
    list_notices: '查询公告列表',
    get_notice_detail: '读取公告全文',
    list_discussions: '查询讨论列表',
    list_deadlines: '汇总截止日期',
    add_focus_item: '添加到今日重点',
    draft_mail: '起草邮件',
    navigate_to: '生成跳转卡片',
    summarize_content: '总结内容',
    complete_homework: '查询作业信息',
    search_global: '全局搜索',
    get_stats: '获取学习统计',
  }
  return map[name] || `执行 ${name}`
}

function buildWelcome(style: 'cute' | 'serious'): string {
  if (style === 'cute') {
    return '诶嘿～ 我是甘蔗 Tutor！课程、作业、课件、邮件我都能帮你打理，尽管问我吧～'
  }
  return '你好，我是甘蔗 Tutor。课程、作业、课件、邮件相关的问题都可以直接提问。'
}

export default function TutorPage() {
  const navigate = useNavigate()
  const { courseId } = useParams()
  const { courses, selectedCourseId } = useAuthStore()
  const messages = useCurrentTutorMessages()
  const {
    sessions, currentId, streaming, style, context, pendingPrompt,
    addMessage, updateMessages, setStreaming, setStyle,
    newSession, switchSession, deleteSession, setContext, setPendingPrompt,
  } = useTutorStore()

  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [integrityOpen, setIntegrityOpen] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [healthModalOpen, setHealthModalOpen] = useState(false)
  const [healthError, setHealthError] = useState('')

  const sessionRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const chatStreamRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const visionWarnedRef = useRef(false)

  const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 单图上限 4MB

  function addImageFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    for (const file of list) {
      if (file.size > MAX_IMAGE_BYTES) {
        message.warning(`图片「${file.name}」超过 4MB，已跳过`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result || '')
        if (url) setPendingImages((prev) => (prev.length >= 4 ? prev : [...prev, url]))
      }
      reader.readAsDataURL(file)
    }
  }

  async function handlePickImage() {
    // 视觉能力预检：当前模型可能不支持图片时给一次性非阻塞提示（启发式，不拦截）
    try {
      const s = await window.learn.settings.getAll()
      const model = String((s as any)?.aiModel || '')
      if (model && !modelLikelySupportsVision(model) && !visionWarnedRef.current) {
        visionWarnedRef.current = true
        message.info('当前模型可能不支持图片输入。如发送后报错，请在设置页切换到支持视觉的模型（如 GPT-4o、Claude、Gemini、Qwen-VL）')
      }
    } catch { /* 读设置失败则跳过预检 */ }
    fileInputRef.current?.click()
  }

  function handlePasteImage(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    const imgs: File[] = []
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imgs.push(f)
      }
    }
    if (imgs.length) { e.preventDefault(); addImageFiles(imgs) }
  }

  const currentCourse =
    courses.find((c) => c.id === (context?.courseId || courseId)) ||
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

  // Check AI config on mount (no billable API call)
  useEffect(() => {
    window.learn.settings.getAll().then((s) => {
      // aiProvider/aiModel 有主进程默认值，是否可用只取决于当前服务商是否存了 Key
      const configured = !!s.hasApiKey
      setOnline(configured)
      if (!configured) {
        setHealthError('请先在设置页配置 AI 服务商、模型和 API Key')
        setHealthModalOpen(true)
      }
    })
  }, [])

  // 其他页面带着"待发送提示"跳转过来（如首页"今日简报"）时自动发送
  useEffect(() => {
    if (pendingPrompt && !streaming) {
      const prompt = pendingPrompt
      setPendingPrompt(null)
      sendMessage(prompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt])

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight
    }
  }, [messages, toolStatus])

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
    const images = text ? [] : pendingImages
    if ((!content && !images.length) || streaming) return
    setInput('')
    if (!text) setPendingImages([])

    addMessage({ role: 'user', content, images: images.length ? images : undefined })
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
        updateMessages((msgs) => {
          const next = [...msgs]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant' && !last.nav) {
            next[next.length - 1] = { ...last, content: streamedContent }
          }
          return next
        })
      } else if (data.type === 'tool_call' && data.call) {
        const name = data.call.function?.name || 'unknown'
        if (name === 'navigate_to') {
          // 跳转卡片：插入到流式占位消息之前
          try {
            const args = JSON.parse(data.call.function?.arguments || '{}')
            if (args.label && args.tab) {
              const nav: TutorNav = { label: args.label, courseId: args.courseId, tab: args.tab }
              updateMessages((msgs) => {
                const next = [...msgs]
                next.splice(next.length - 1, 0, { role: 'assistant', content: '', nav })
                return next
              })
            }
          } catch { /* 参数不完整则忽略 */ }
        } else {
          setToolStatus(getToolLabel(name))
        }
      } else if (data.type === 'tool_result') {
        setToolStatus(null)
      }
    })

    const unsubEnd = window.learn.hwai.onEnd((data: any) => {
      if (data.sessionId !== sessionId) return
      unsubChunk()
      unsubEnd()
      unsubRef.current = null
      setStreaming(false)
      setToolStatus(null)
      sessionRef.current = null
      updateMessages((msgs) => {
        const next = [...msgs]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant' && !last.content && !last.nav) {
          if (data.error) {
            // 错误可见：占位变成错误说明而不是无声消失
            next[next.length - 1] = { ...last, content: `⚠️ 对话出错：${data.error}\n\n请检查设置页的 AI 服务商与 API Key，或换一个模型再试。` }
          } else {
            next.pop() // 模型只调了工具没有输出文字
          }
        }
        return next
      })
    })

    unsubRef.current = () => {
      unsubChunk()
      unsubEnd()
    }

    try {
      const state = useTutorStore.getState()
      const allMessages = state.sessions.find((s) => s.id === state.currentId)?.messages || []
      // Send messages up to (but not including) the just-added placeholder; nav 卡片不进历史
      const history = allMessages.slice(0, -1)
        .filter((m) => !m.nav)
        .map((m) => ({ role: m.role, content: m.content, images: m.images }))

      await window.learn.hwai.tutorChat({
        messages: history,
        courseId: currentCourse?.id,
        style: state.style,
        sessionId,
        pageContext: state.context || undefined,
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

  function handleNavClick(nav: TutorNav) {
    if (nav.tab === 'mailbox') navigate('/mailbox?folder=inbox')
    else if (nav.tab === 'home') navigate('/')
    else if (nav.courseId) navigate(`/course/${nav.courseId}/${nav.tab}`)
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

  const historyItems = sessions.map((s) => ({
    key: s.id,
    label: (
      <div className="lp2-tutor-history-item">
        <span>{s.title || '新对话'}</span>
        <DeleteOutlined
          onClick={(e) => {
            e.stopPropagation()
            deleteSession(s.id)
          }}
        />
      </div>
    ),
  }))

  const isEmpty = messages.length === 0

  return (
    <div className="lp2-tutor-page">
      <div className="lp2-tutor-chat-layout">
        <main className="lp2-ai-chat-panel">
          {/* 会话工具行 */}
          <div className="lp2-tutor-session-bar">
            <Dropdown
              trigger={['click']}
              menu={{
                items: historyItems,
                selectedKeys: [currentId],
                onClick: ({ key }) => switchSession(String(key)),
              }}
            >
              <button type="button" className="lp2-tutor-session-button">
                <HistoryOutlined />
                <span>{sessions.find((s) => s.id === currentId)?.title || '新对话'}</span>
              </button>
            </Dropdown>
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => newSession()}
              disabled={streaming}
            >
              新对话
            </Button>
          </div>

          <div className="lp2-ai-chat-stream" ref={chatStreamRef}>
            {isEmpty ? (
              <div className="lp2-tutor-empty">
                <img src={tutorAvatar} alt="甘蔗 Tutor" draggable={false} />
                <h2>甘蔗 Tutor</h2>
                <p>{buildWelcome(style)}</p>
                <div className="lp2-tutor-guide-grid">
                  {guideCards.map((card) => (
                    <button key={card.title} type="button" onClick={() => sendMessage(card.prompt)}>
                      <strong>{card.title}</strong>
                      <small>{card.desc}</small>
                      <ArrowRightOutlined />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                if (msg.nav) {
                  return (
                    <button
                      key={i}
                      type="button"
                      className="lp2-tutor-nav-card"
                      onClick={() => handleNavClick(msg.nav!)}
                    >
                      <span className="lp2-tutor-nav-icon"><ArrowRightOutlined /></span>
                      <span className="lp2-tutor-nav-label">{msg.nav.label}</span>
                      <span className="lp2-tutor-nav-go">带我去 ›</span>
                    </button>
                  )
                }
                if (msg.role === 'assistant' && !msg.content && streaming && i === messages.length - 1 && !toolStatus) {
                  return (
                    <div key={i} className="lp2-tutor-tool-line">
                      <span className="lp2-tutor-pulse" />正在思考...
                    </div>
                  )
                }
                if (msg.role === 'assistant' && !msg.content) return null
                return (
                  <div key={i} className={`lp2-ai-message ${msg.role === 'assistant' ? 'tutor' : msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <img src={tutorAvatar} alt="甘蔗 Tutor" draggable={false} />
                    ) : null}
                    <div>
                      {msg.images && msg.images.length > 0 && (
                        <div className="lp2-tutor-msg-images">
                          {msg.images.map((src, ii) => (
                            <img key={ii} src={src} alt="用户上传图片" draggable={false} />
                          ))}
                        </div>
                      )}
                      {msg.content && <MarkdownRenderer content={msg.content} />}
                    </div>
                  </div>
                )
              })
            )}

            {streaming && toolStatus && (
              <div className="lp2-tutor-tool-line">
                <span className="lp2-tutor-pulse" />正在{toolStatus}...
              </div>
            )}
          </div>

          {online === false && (
            <div style={{ textAlign: 'center', padding: '4px 0', fontSize: 12 }}>
              <Tag color="warning">AI 服务未配置，请前往设置页填写 API Key</Tag>
            </div>
          )}

          {!isEmpty && (
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
          )}

          {context && (context.label || context.itemTitle) && (
            <div className="lp2-tutor-context-chip">
              <span>上下文：{context.label || ''}{context.itemTitle ? `「${context.itemTitle}」` : ''}</span>
              <button type="button" aria-label="移除上下文" title="移除上下文" onClick={() => setContext(null)}>×</button>
            </div>
          )}

          {pendingImages.length > 0 && (
            <div className="lp2-tutor-pending-images">
              {pendingImages.map((src, i) => (
                <span key={i} className="lp2-tutor-pending-thumb">
                  <img src={src} alt="待发送图片" draggable={false} />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                  >×</button>
                </span>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) addImageFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <div className="lp2-ai-input-bar lp2-ai-input-bar-simple">
            <Button
              className="lp2-ai-image-button"
              icon={<PictureOutlined />}
              onClick={handlePickImage}
              disabled={streaming || pendingImages.length >= 4}
              title="添加图片（也可直接粘贴，最多 4 张）"
            />
            <Input.TextArea
              placeholder="向甘蔗 Tutor 提问，可粘贴/添加图片... (Enter 发送，Shift+Enter 换行)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePasteImage}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              disabled={streaming}
              autoSize={{ minRows: 1, maxRows: 6 }}
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
          </div>
          <p className="lp2-tutor-disclaimer">甘蔗 Tutor 生成内容仅供学习参考，请根据课程要求自行判断与修改</p>
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
