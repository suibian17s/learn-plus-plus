import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Empty, Form, Input, Modal, Spin, Tag, message } from 'antd'
import {
  DeleteOutlined,
  ExportOutlined,
  InboxOutlined,
  LoginOutlined,
  LogoutOutlined,
  MailOutlined,
  ReloadOutlined,
  RobotOutlined,
  RollbackOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface MailItem {
  id: string
  subject: string
  from: string
  date: string
  preview: string
  starred: boolean
  read: boolean
}

interface MailDetailData {
  subject: string
  from: string
  date: string
  body: string
  attachments: { name: string; url: string }[]
}

const FOLDER_LABELS: Record<string, string> = {
  inbox: '收件箱',
  sent: '已发送',
  drafts: '草稿箱',
  trash: '已删除',
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseMailTime(value: string): number {
  const raw = normalizeText(value)
  if (!raw) return 0

  const now = new Date()
  if (/今天/.test(raw)) {
    const time = raw.match(/(\d{1,2}):(\d{2})/)
    const d = new Date(now)
    if (time) d.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return d.getTime()
  }
  if (/昨天/.test(raw)) {
    const time = raw.match(/(\d{1,2}):(\d{2})/)
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    if (time) d.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return d.getTime()
  }

  let normalized = raw
    .replace(/[年月.]/g, '-')
    .replace(/日/g, ' ')
    .replace(/\//g, '-')
  if (/^\d{1,2}-\d{1,2}/.test(normalized)) {
    normalized = `${now.getFullYear()}-${normalized}`
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function extractReplyAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/)
  return normalizeText(angle?.[1] || from).replace(/^["']|["']$/g, '')
}

export default function MailboxPage() {
  const [searchParams] = useSearchParams()
  const folder = searchParams.get('folder') || 'inbox'
  const refreshToken = searchParams.get('refresh') || ''
  const searchText = searchParams.get('q') || ''
  const filter = searchParams.get('filter') || 'all'
  const sortBy = searchParams.get('sort') || 'time'

  const [mails, setMails] = useState<MailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mailLoggedIn, setMailLoggedIn] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMode, setComposeMode] = useState<'reply' | 'forward'>('reply')
  const [composeSending, setComposeSending] = useState(false)
  const [composeForm] = Form.useForm()

  const folderLabel = FOLDER_LABELS[folder] || folder

  const loadMails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.learn.mail.list(folder)
      setMails(result.mails || [])
    } catch (err: any) {
      setError(err?.message || '加载邮件失败')
      setMails([])
    } finally {
      setLoading(false)
    }
  }, [folder])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await window.learn.mail.status()
        if (!cancelled) setMailLoggedIn(status.loggedIn)
      } catch {
        if (!cancelled) setMailLoggedIn(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (mailLoggedIn === true) {
      setSelectedId(null)
      setDetail(null)
      loadMails()
    }
    if (mailLoggedIn === false) setLoading(false)
  }, [folder, mailLoggedIn, refreshToken, loadMails])

  const filteredMails = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const list = mails.filter((mail) => {
      if (filter === 'unread' && mail.read) return false
      if (filter === 'starred' && !mail.starred) return false
      if (!q) return true
      return [mail.subject, mail.from, mail.preview].some((value) =>
        normalizeText(value).toLowerCase().includes(q),
      )
    })

    list.sort((a, b) => {
      if (sortBy === 'star') {
        const starDelta = Number(b.starred) - Number(a.starred)
        if (starDelta !== 0) return starDelta
      }
      return parseMailTime(b.date) - parseMailTime(a.date)
    })

    return list
  }, [filter, mails, searchText, sortBy])

  useEffect(() => {
    if (filteredMails.length === 0) {
      if (selectedId) {
        setSelectedId(null)
        setDetail(null)
      }
      return
    }
    if (!selectedId || !filteredMails.some((mail) => mail.id === selectedId)) {
      setSelectedId(filteredMails[0].id)
    }
  }, [filteredMails, selectedId])

  const selected = filteredMails.find((mail) => mail.id === selectedId) || null
  const unreadCount = mails.filter((mail) => !mail.read).length
  const starredCount = mails.filter((mail) => mail.starred).length

  useEffect(() => {
    if (!selectedId || !mailLoggedIn) return
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      setDetail(null)
      try {
        const result = await window.learn.mail.get(selectedId)
        if (!cancelled && result) {
          setDetail({
            subject: result.subject,
            from: result.from,
            date: result.date,
            body: result.body || '',
            attachments: result.attachments || [],
          })
        }
      } catch {
        if (!cancelled) message.warning('邮件正文暂时无法读取，可打开原站查看')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mailLoggedIn, selectedId])

  async function handleLogin() {
    setLoading(true)
    try {
      const result = await window.learn.mail.login()
      if (result.ok) {
        setMailLoggedIn(true)
        message.success('邮箱登录成功')
      } else {
        setLoading(false)
        message.error('邮箱登录超时，请重试')
      }
    } catch {
      setLoading(false)
      message.error('邮箱登录失败')
    }
  }

  async function handleLogout() {
    await window.learn.mail.logout()
    setMailLoggedIn(false)
    setMails([])
    setSelectedId(null)
    setDetail(null)
    message.success('已退出邮箱')
  }

  async function handleStar(mailId: string, starred: boolean) {
    try {
      const result = await window.learn.mail.star(mailId, !starred)
      if (result.ok) {
        setMails((prev) => prev.map((mail) =>
          mail.id === mailId ? { ...mail, starred: !starred } : mail,
        ))
      }
    } catch {
      message.error('星标操作失败')
    }
  }

  async function handleDelete(mailId: string) {
    try {
      const result = await window.learn.mail.delete(mailId)
      if (result.ok) {
        setMails((prev) => prev.filter((mail) => mail.id !== mailId))
        if (selectedId === mailId) {
          setSelectedId(null)
          setDetail(null)
        }
        message.success('已删除')
      }
    } catch {
      message.error('删除失败')
    }
  }

  async function handleTutorSummary() {
    if (!detail && !selected) return
    const subject = detail?.subject || selected?.subject || ''
    const from = detail?.from || selected?.from || ''
    const body = detail?.body ? stripHtml(detail.body) : selected?.preview || ''

    setSummaryOpen(true)
    setSummaryLoading(true)
    setSummaryText('')
    const sessionId = `mail-summary-${Date.now()}`
    const unsubChunk = window.learn.hwai.onChunk((data) => {
      if (data.sessionId === sessionId && data.delta) {
        setSummaryText((prev) => prev + data.delta)
      }
    })
    const unsubEnd = window.learn.hwai.onEnd((data) => {
      if (data.sessionId === sessionId) setSummaryLoading(false)
    })
    try {
      const content = `发件人：${from}\n主题：${subject}\n\n${body}`
      const askResult = await window.learn.hwai.tutorAsk(
        '__mail__',
        `请总结以下邮件内容，提取关键信息、待办事项和时间节点：\n${content.slice(0, 4000)}`,
        sessionId,
      )
      if (!askResult.ok) setSummaryText(askResult.error || '总结生成失败，请稍后重试')
    } catch (err: any) {
      setSummaryText('总结失败：' + (err?.message || '未知错误'))
    } finally {
      unsubChunk()
      unsubEnd()
      setSummaryLoading(false)
    }
  }

  function handleConvertToFocus() {
    const subject = detail?.subject || selected?.subject
    if (!subject) return
    message.success(`已将「${subject}」加入今日重点列表`)
  }

  function openCompose(mode: 'reply' | 'forward') {
    if (!selected && !detail) return
    const subject = detail?.subject || selected?.subject || ''
    const from = detail?.from || selected?.from || ''
    const date = detail?.date || selected?.date || ''
    const plainBody = detail?.body ? stripHtml(detail.body) : selected?.preview || ''

    setComposeMode(mode)
    composeForm.setFieldsValue({
      to: mode === 'reply' ? extractReplyAddress(from) : '',
      subject: `${mode === 'reply' ? 'Re: ' : 'Fwd: '}${subject}`,
      body: mode === 'forward'
        ? `\n\n---------- 转发的邮件 ----------\n发件人：${from}\n日期：${date}\n主题：${subject}\n\n${plainBody}`
        : '',
    })
    setComposeOpen(true)
  }

  async function handleSendCompose() {
    try {
      const values = await composeForm.validateFields()
      setComposeSending(true)
      const result = await window.learn.mail.compose({
        to: values.to,
        subject: values.subject,
        body: values.body,
      })
      if (result.ok) {
        message.success('邮件已发送')
        setComposeOpen(false)
      } else {
        message.error(result.error || '发送失败，请使用“打开原站”手动发送')
      }
    } catch {
      // Ant Design handles form validation messages.
    } finally {
      setComposeSending(false)
    }
  }

  if (mailLoggedIn === false) {
    return (
      <div className="lp2-mail-page lp2-mail-centered">
        <section className="lp2-mail-login-card">
          <span className="lp2-mail-login-icon"><LoginOutlined /></span>
          <h2>登录清华邮箱</h2>
          <p>登录后 learn++ 会在后台读取邮件列表，原站窗口会自动隐藏，需要时可以随时打开。</p>
          <div className="lp2-mail-login-actions">
            <Button type="primary" size="large" icon={<LoginOutlined />} onClick={handleLogin}>
              登录邮箱
            </Button>
            <Button size="large" icon={<ExportOutlined />} onClick={() => window.learn.mail.show()}>
              打开原站
            </Button>
          </div>
        </section>
      </div>
    )
  }

  if (mailLoggedIn === null || loading) {
    return (
      <div className="lp2-mail-page lp2-mail-centered">
        <Spin size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="lp2-mail-page lp2-mail-centered">
        <section className="lp2-mail-empty-state">
          <span className="lp2-mail-empty-icon"><MailOutlined /></span>
          <h2>邮件加载失败</h2>
          <p>{error}</p>
          <div className="lp2-mail-empty-actions">
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadMails}>重试</Button>
            <Button icon={<ExportOutlined />} onClick={() => window.learn.mail.show()}>打开原站</Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="lp2-mail-page">
      <section className="lp2-mail-statusbar">
        <div>
          <span className="lp2-mail-status-icon"><InboxOutlined /></span>
          <strong>{folderLabel}</strong>
          <small>{filteredMails.length} / {mails.length} 封</small>
        </div>
        <div className="lp2-mail-status-tags">
          <Tag>{unreadCount} 未读</Tag>
          <Tag>{starredCount} 星标</Tag>
        </div>
        <div className="lp2-mail-status-actions">
          <Button icon={<ReloadOutlined />} onClick={loadMails}>刷新</Button>
          <Button icon={<ExportOutlined />} onClick={() => window.learn.mail.show()}>打开原站</Button>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </div>
      </section>

      <div className="lp2-mail-layout">
        <section className="lp2-mail-list" aria-label="邮件列表">
          {filteredMails.length === 0 ? (
            <div className="lp2-mail-list-empty">
              <Empty description={mails.length ? '当前筛选下没有邮件' : '未读取到邮件'}>
                <Button icon={<ReloadOutlined />} onClick={loadMails}>重新读取</Button>
              </Empty>
            </div>
          ) : (
            filteredMails.map((mail) => (
              <button
                key={mail.id}
                type="button"
                className={`lp2-mail-row${mail.id === selected?.id ? ' active' : ''}${!mail.read ? ' unread' : ''}`}
                onClick={() => setSelectedId(mail.id)}
              >
                <span className="lp2-mail-row-main">
                  <span className="lp2-mail-row-top">
                    <strong>{mail.subject || '(无主题)'}</strong>
                    <time>{mail.date}</time>
                  </span>
                  <small>{mail.from || '(未知发件人)'}</small>
                  <em>{mail.preview || '暂无预览内容'}</em>
                </span>
                <span
                  className="lp2-mail-row-star"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleStar(mail.id, mail.starred)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      handleStar(mail.id, mail.starred)
                    }
                  }}
                >
                  {mail.starred ? <StarFilled /> : <StarOutlined />}
                </span>
              </button>
            ))
          )}
        </section>

        <article className="lp2-mail-detail">
          {!selected ? (
            <div className="lp2-mail-detail-empty">
              <Empty description="请选择一封邮件" />
            </div>
          ) : (
            <>
              <header className="lp2-mail-detail-title">
                <div>
                  <Tag color="purple">{folderLabel}</Tag>
                  <h2>{detail?.subject || selected.subject || '(无主题)'}</h2>
                  <p>{detail?.from || selected.from || '(未知发件人)'} · {detail?.date || selected.date}</p>
                </div>
                <div className="lp2-mail-detail-tools">
                  <Button
                    icon={selected.starred ? <StarFilled /> : <StarOutlined />}
                    onClick={() => handleStar(selected.id, selected.starred)}
                  />
                  <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(selected.id)} />
                </div>
              </header>

              <div className="lp2-mail-body">
                {detailLoading ? (
                  <div className="lp2-mail-body-loading"><Spin /></div>
                ) : detail?.body ? (
                  <div
                    className="lp2-mail-html-body"
                    dangerouslySetInnerHTML={{ __html: detail.body }}
                  />
                ) : (
                  <p>{selected.preview || '正文暂时无法读取，可打开原站查看。'}</p>
                )}

                {!!detail?.attachments?.length && (
                  <div className="lp2-mail-attachments">
                    {detail.attachments.map((attachment) => (
                      <span key={`${attachment.name}-${attachment.url}`}>{attachment.name}</span>
                    ))}
                  </div>
                )}
              </div>

              <footer className="lp2-mail-detail-actions">
                <Button icon={<RollbackOutlined />} onClick={() => openCompose('reply')}>回复</Button>
                <Button icon={<ShareAltOutlined />} onClick={() => openCompose('forward')}>转发</Button>
                <Button icon={<ThunderboltOutlined />} onClick={handleConvertToFocus}>转为今日重点</Button>
                <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary}>
                  甘蔗 Tutor 总结
                </Button>
              </footer>
            </>
          )}
        </article>
      </div>

      <Modal
        title="甘蔗 Tutor 邮件总结"
        open={summaryOpen}
        onCancel={() => setSummaryOpen(false)}
        footer={null}
        width={600}
      >
        {summaryLoading && !summaryText ? (
          <div className="lp2-mail-modal-loading">
            <Spin />
            <p>正在总结邮件内容...</p>
          </div>
        ) : (
          <MarkdownRenderer content={summaryText} />
        )}
      </Modal>

      <Modal
        title={composeMode === 'reply' ? '回复邮件' : '转发邮件'}
        open={composeOpen}
        onCancel={() => setComposeOpen(false)}
        onOk={handleSendCompose}
        okText="发送"
        cancelText="取消"
        confirmLoading={composeSending}
        width={640}
        destroyOnClose
      >
        <Form form={composeForm} layout="vertical" className="lp2-mail-compose-form">
          <Form.Item name="to" label="收件人" rules={[{ required: true, message: '请输入收件人' }]}>
            <Input placeholder="收件人邮箱地址" />
          </Form.Item>
          <Form.Item name="subject" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
            <Input placeholder="邮件主题" />
          </Form.Item>
          <Form.Item name="body" label="正文">
            <Input.TextArea rows={9} placeholder="邮件正文..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
