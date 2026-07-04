import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Input, Spin } from 'antd'
import { ReloadOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'
import { useSummariesStore } from '../store/summaries'

export interface SummaryRunner {
  (sessionId: string): Promise<{ ok: boolean; content?: string; error?: string }>
}

interface ChatMsg { role: 'user' | 'assistant'; content: string }

interface Props {
  open: boolean
  onClose: () => void
  /** 抽屉标题，例如 "课件总结 · 第一讲.pdf" */
  title: string
  /** 持久化键：同一对象的总结直接复用 */
  summaryKey: string
  /** 发起总结生成 */
  run: SummaryRunner
  /** 可选：对该对象追问（课件总结才有）。返回后端 ok，流式经 hwai.onChunk 推送 */
  chatRun?: (question: string, history: ChatMsg[], sessionId: string) => Promise<{ ok: boolean; content?: string; error?: string }>
}

export default function TutorSummaryDrawer({ open, onClose, title, summaryKey, run, chatRun }: Props) {
  const { entries, save } = useSummariesStore()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [createdAt, setCreatedAt] = useState<number | null>(null)
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [chatting, setChatting] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  async function generate() {
    setLoading(true)
    setText('')
    setCreatedAt(null)
    const sessionId = `summary-${Date.now()}`
    let streamed = ''

    const unsubChunk = window.learn.hwai.onChunk((data) => {
      if (data.sessionId === sessionId && data.delta) {
        streamed += data.delta
        setText(streamed)
      }
    })
    const unsubEnd = window.learn.hwai.onEnd((data) => {
      if (data.sessionId === sessionId) setLoading(false)
    })
    unsubRef.current = () => { unsubChunk(); unsubEnd() }

    try {
      const result = await run(sessionId)
      const finalText = streamed || result.content || ''
      if (result.ok && finalText.trim()) {
        setText(finalText)
        save(summaryKey, finalText)
        setCreatedAt(Date.now())
      } else if (!result.ok) {
        setText(`⚠️ 总结生成失败：${result.error || '未知错误'}\n\n请检查 AI 配置后点击右上角重新生成。`)
      }
    } catch (err: any) {
      setText(`⚠️ 总结生成失败：${err?.message || '未知错误'}`)
    } finally {
      unsubRef.current?.()
      unsubRef.current = null
      setLoading(false)
    }
  }

  async function sendQuestion() {
    const q = input.trim()
    if (!q || chatting || !chatRun) return
    setInput('')
    const history = chat
    setChat((c) => [...c, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    setChatting(true)
    const sessionId = `filechat-${Date.now()}`
    let streamed = ''

    const unsubChunk = window.learn.hwai.onChunk((data) => {
      if (data.sessionId === sessionId && data.delta) {
        streamed += data.delta
        setChat((c) => {
          const next = [...c]
          if (next.length && next[next.length - 1].role === 'assistant') {
            next[next.length - 1] = { role: 'assistant', content: streamed }
          }
          return next
        })
      }
    })
    const unsubEnd = window.learn.hwai.onEnd((data) => {
      if (data.sessionId === sessionId) setChatting(false)
    })

    try {
      const result = await chatRun(q, history, sessionId)
      const finalText = streamed || result.content || ''
      setChat((c) => {
        const next = [...c]
        if (next.length && next[next.length - 1].role === 'assistant') {
          next[next.length - 1] = {
            role: 'assistant',
            content: result.ok ? (finalText || '（无回复）') : `⚠️ ${result.error || '回答失败'}`,
          }
        }
        return next
      })
    } catch (err: any) {
      setChat((c) => {
        const next = [...c]
        if (next.length && next[next.length - 1].role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', content: `⚠️ ${err?.message || '回答失败'}` }
        }
        return next
      })
    } finally {
      unsubChunk(); unsubEnd()
      setChatting(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setChat([])
    setInput('')
    const cached = entries[summaryKey]
    if (cached?.content) {
      setText(cached.content)
      setCreatedAt(cached.createdAt)
      setLoading(false)
    } else {
      generate()
    }
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, summaryKey])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [chat])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      className="lp2-tutor-drawer"
      title={
        <span className="lp2-tutor-drawer-title">
          <RobotOutlined />
          <span>{title}</span>
        </span>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} disabled={loading} onClick={generate}>
          重新生成
        </Button>
      }
    >
      <div className="lp2-tutor-drawer-layout">
        <div className="lp2-tutor-drawer-scroll" ref={bodyRef}>
          {loading && !text ? (
            <div className="lp2-tutor-drawer-loading">
              <Spin />
              <p>甘蔗 Tutor 正在阅读并总结...</p>
            </div>
          ) : (
            <>
              <MarkdownRenderer content={text} />
              <p className="lp2-tutor-drawer-note">
                {createdAt ? `生成于 ${new Date(createdAt).toLocaleString('zh-CN')} · ` : ''}
                内容仅供学习参考
              </p>
            </>
          )}

          {chat.length > 0 && (
            <div className="lp2-tutor-drawer-chat">
              {chat.map((m, i) => (
                <div key={i} className={`lp2-tutor-drawer-msg ${m.role}`}>
                  {m.role === 'assistant'
                    ? (m.content ? <MarkdownRenderer content={m.content} /> : <span className="lp2-tutor-drawer-typing">正在思考…</span>)
                    : <span>{m.content}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {chatRun && (
          <div className="lp2-tutor-drawer-input">
            <Input.TextArea
              placeholder="就这份课件继续提问…（Enter 发送）"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion() }
              }}
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={chatting || loading}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={sendQuestion}
              loading={chatting}
              disabled={loading}
            />
          </div>
        )}
      </div>
    </Drawer>
  )
}
