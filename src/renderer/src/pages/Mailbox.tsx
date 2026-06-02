import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Form, Input, Modal, Spin, Switch, Tag, message } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
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
  to: string
  date: string
  preview: string
  starred: boolean
  read: boolean
}

interface MailDetailData extends MailItem {
  body: string
  attachments: { name: string; url: string }[]
}

interface MailLoginValues {
  mailUsername: string
  mailPassword?: string
  mailImapHost?: string
  mailImapPort?: number | string
  mailImapTls?: boolean
  mailSmtpHost?: string
  mailSmtpPort?: number | string
  mailSmtpTls?: boolean
}

const MAIL_DEFAULTS = {
  imapHost: 'mails.tsinghua.edu.cn',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'mails.tsinghua.edu.cn',
  smtpPort: 465,
  smtpTls: true,
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
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
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

function displayCounterparty(mail: MailItem, folder: string): string {
  const value = folder === 'sent' || folder === 'drafts' ? (mail.to || mail.from) : mail.from
  return normalizeText(value) || '(未知联系人)'
}

export default function MailboxPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const folder = searchParams.get('folder') || 'inbox'
  const refreshToken = searchParams.get('refresh') || ''
  const searchText = searchParams.get('q') || ''
  const filter = searchParams.get('filter') || 'all'
  const sortBy = searchParams.get('sort') || 'time'
  const activeMailId = searchParams.get('mailId') || ''
  const composeRequested = searchParams.get('compose') === '1'

  const [mails, setMails] = useState<MailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mailLoggedIn, setMailLoggedIn] = useState<boolean | null>(null)
  const [detail, setDetail] = useState<MailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMode, setComposeMode] = useState<'write' | 'reply' | 'forward'>('write')
  const [composeSending, setComposeSending] = useState(false)
  const [composeForm] = Form.useForm()
  const [imapForm] = Form.useForm<MailLoginValues>()
  const [imapConnecting, setImapConnecting] = useState(false)

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
        const settings = await window.learn.settings.getAll()
        if (!cancelled) {
          imapForm.setFieldsValue({
            mailUsername: settings.mailUsername || '',
            mailImapHost: settings.mailImapHost || MAIL_DEFAULTS.imapHost,
            mailImapPort: settings.mailImapPort || MAIL_DEFAULTS.imapPort,
            mailImapTls: settings.mailImapTls !== false,
            mailSmtpHost: settings.mailSmtpHost || settings.mailImapHost || MAIL_DEFAULTS.smtpHost,
            mailSmtpPort: settings.mailSmtpPort || MAIL_DEFAULTS.smtpPort,
            mailSmtpTls: settings.mailSmtpTls !== false,
          })
        }
        const status = await window.learn.mail.status()
        if (!cancelled) setMailLoggedIn(status.loggedIn)
      } catch {
        if (!cancelled) setMailLoggedIn(false)
      }
    })()
    return () => { cancelled = true }
  }, [imapForm])

  useEffect(() => {
    if (mailLoggedIn === true) {
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
      return [mail.subject, mail.from, mail.to, mail.preview].some((value) =>
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

  const selected = mails.find((mail) => mail.id === activeMailId) || null
  const unreadCount = mails.filter((mail) => !mail.read).length
  const starredCount = mails.filter((mail) => mail.starred).length

  useEffect(() => {
    if (!activeMailId || !mailLoggedIn) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      setDetail(null)
      try {
        const result = await window.learn.mail.get(activeMailId)
        if (!cancelled && result) {
          setDetail({
            id: result.id,
            subject: result.subject,
            from: result.from,
            to: result.to,
            date: result.date,
            preview: result.preview,
            starred: result.starred,
            read: result.read,
            body: result.body || '',
            attachments: result.attachments || [],
          })
        }
      } catch {
        if (!cancelled) message.warning('邮件正文暂时无法读取，请重新同步或检查 IMAP 连接')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeMailId, mailLoggedIn])

  useEffect(() => {
    if (!composeRequested) return
    setComposeMode('write')
    composeForm.resetFields()
    setComposeOpen(true)
  }, [composeRequested, composeForm])

  function patchQuery(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams)
    params.set('folder', folder)
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    navigate(`/mailbox?${params.toString()}`)
  }

  function closeCompose() {
    setComposeOpen(false)
    if (composeRequested) patchQuery({ compose: null })
  }

  async function handleLogin() {
    setImapConnecting(true)
    try {
      const values = await imapForm.validateFields()
      const config = {
        imapHost: normalizeText(values.mailImapHost) || MAIL_DEFAULTS.imapHost,
        imapPort: Number(values.mailImapPort || MAIL_DEFAULTS.imapPort),
        imapTls: values.mailImapTls !== false,
        smtpHost: normalizeText(values.mailSmtpHost) || normalizeText(values.mailImapHost) || MAIL_DEFAULTS.smtpHost,
        smtpPort: Number(values.mailSmtpPort || MAIL_DEFAULTS.smtpPort),
        smtpTls: values.mailSmtpTls !== false,
        username: normalizeText(values.mailUsername),
        password: values.mailPassword || '',
      }

      await window.learn.settings.set({
        mailMode: 'imap',
        mailUsername: config.username,
        mailImapHost: config.imapHost,
        mailImapPort: config.imapPort,
        mailImapTls: config.imapTls,
        mailSmtpHost: config.smtpHost,
        mailSmtpPort: config.smtpPort,
        mailSmtpTls: config.smtpTls,
      })
      if (values.mailPassword?.trim()) {
        await window.learn.settings.setApiKey(values.mailPassword, 'mail')
      }

      const result = await window.learn.mail.loginImap(config)
      if (result.ok) {
        setMailLoggedIn(true)
        message.success('IMAP 邮箱连接成功')
      } else {
        message.error('IMAP 连接失败，请检查账号、密码或客户端专用密码')
      }
    } catch {
      message.error('IMAP 登录失败')
    }
    setImapConnecting(false)
  }

  async function handleTestImap() {
    try {
      const values = await imapForm.validateFields()
      message.loading({ key: 'mail-imap-test', content: '正在测试 IMAP 连接...' })
      const ok = await window.learn.mail.testConnection({
        imapHost: normalizeText(values.mailImapHost) || MAIL_DEFAULTS.imapHost,
        imapPort: Number(values.mailImapPort || MAIL_DEFAULTS.imapPort),
        imapTls: values.mailImapTls !== false,
        smtpHost: normalizeText(values.mailSmtpHost) || normalizeText(values.mailImapHost) || MAIL_DEFAULTS.smtpHost,
        smtpPort: Number(values.mailSmtpPort || MAIL_DEFAULTS.smtpPort),
        smtpTls: values.mailSmtpTls !== false,
        username: normalizeText(values.mailUsername),
        password: values.mailPassword || '',
      })
      message.destroy('mail-imap-test')
      if (ok) message.success('IMAP 连接测试成功')
      else message.error('IMAP 连接测试失败')
    } catch {
      message.destroy('mail-imap-test')
    }
  }

  async function handleLogout() {
    await window.learn.mail.logout()
    setMailLoggedIn(false)
    setMails([])
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
        setDetail((prev) => prev?.id === mailId ? { ...prev, starred: !starred } : prev)
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
        if (activeMailId === mailId) patchQuery({ mailId: null })
        message.success('已删除')
      }
    } catch {
      message.error('删除失败')
    }
  }

  async function handleTutorSummary() {
    const subject = detail?.subject || selected?.subject || ''
    const from = detail?.from || selected?.from || ''
    const body = detail?.body ? stripHtml(detail.body) : selected?.preview || ''
    if (!subject && !body) return

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
      setSummaryText(`总结失败：${err?.message || '未知错误'}`)
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
        closeCompose()
      } else {
        message.error(result.error || '发送失败，请检查 SMTP 配置')
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
        <section className="lp2-mail-login-card lp2-imap-login-card">
          <span className="lp2-mail-login-icon"><LoginOutlined /></span>
          <h2>使用 IMAP 登录邮箱</h2>
          <p>网页登录抓取已关闭。请使用邮箱账号和客户端密码连接 IMAP/SMTP，Learn++ 会像常规邮箱客户端一样同步邮件。</p>
          <Alert
            type="info"
            showIcon
            message="默认使用 mails.tsinghua.edu.cn，IMAP 993 SSL，SMTP 465 SSL。"
            className="lp2-imap-login-alert"
          />
          <Form
            form={imapForm}
            layout="vertical"
            className="lp2-imap-login-form"
            initialValues={{
              mailImapHost: MAIL_DEFAULTS.imapHost,
              mailImapPort: MAIL_DEFAULTS.imapPort,
              mailImapTls: true,
              mailSmtpHost: MAIL_DEFAULTS.smtpHost,
              mailSmtpPort: MAIL_DEFAULTS.smtpPort,
              mailSmtpTls: true,
            }}
          >
            <div className="lp2-imap-form-grid">
              <Form.Item name="mailUsername" label="邮箱账号" rules={[{ required: true, message: '请输入邮箱账号' }]}>
                <Input placeholder="username@mails.tsinghua.edu.cn" />
              </Form.Item>
              <Form.Item name="mailPassword" label="密码 / 客户端专用密码">
                <Input.Password placeholder="留空则使用已保存的密码" />
              </Form.Item>
              <Form.Item name="mailImapHost" label="IMAP 服务器" rules={[{ required: true, message: '请输入 IMAP 服务器' }]}>
                <Input placeholder={MAIL_DEFAULTS.imapHost} />
              </Form.Item>
              <Form.Item name="mailImapPort" label="IMAP 端口">
                <Input placeholder="993" />
              </Form.Item>
              <Form.Item name="mailSmtpHost" label="SMTP 服务器">
                <Input placeholder={MAIL_DEFAULTS.smtpHost} />
              </Form.Item>
              <Form.Item name="mailSmtpPort" label="SMTP 端口">
                <Input placeholder="465" />
              </Form.Item>
            </div>
            <div className="lp2-imap-switches">
              <Form.Item name="mailImapTls" valuePropName="checked">
                <Switch checkedChildren="IMAP SSL" unCheckedChildren="IMAP 无加密" />
              </Form.Item>
              <Form.Item name="mailSmtpTls" valuePropName="checked">
                <Switch checkedChildren="SMTP SSL" unCheckedChildren="SMTP STARTTLS" />
              </Form.Item>
            </div>
          </Form>
          <div className="lp2-mail-login-actions">
            <Button size="large" onClick={handleTestImap}>
              测试连接
            </Button>
            <Button type="primary" size="large" icon={<LoginOutlined />} loading={imapConnecting} onClick={handleLogin}>
              登录邮箱
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
            <Button icon={<LoginOutlined />} onClick={() => setMailLoggedIn(false)}>重新配置 IMAP</Button>
          </div>
        </section>
      </div>
    )
  }

  const detailMail = detail || selected

  return (
    <div className="lp2-mail-page">
      {!activeMailId ? (
        <section className="lp2-mail-list-view" aria-label={`${folderLabel}邮件列表`}>
          <header className="lp2-mail-list-summary">
            <div>
              <span className="lp2-mail-summary-icon"><InboxOutlined /></span>
              <strong>{folderLabel}</strong>
              <small>{filteredMails.length} / {mails.length} 封 · {unreadCount} 未读 · {starredCount} 星标</small>
            </div>
            <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>退出邮箱</Button>
          </header>

          {filteredMails.length === 0 ? (
            <div className="lp2-mail-list-empty">
              <Empty description={mails.length ? '当前筛选下没有邮件' : '未读取到邮件'}>
                <Button icon={<ReloadOutlined />} onClick={loadMails}>重新读取</Button>
              </Empty>
            </div>
          ) : (
            <div className="lp2-mail-table" role="table">
              <div className="lp2-mail-table-head" role="row">
                <span />
                <span>{folder === 'sent' || folder === 'drafts' ? '收件人' : '发件人'}</span>
                <span>主题</span>
                <span>日期</span>
                <span />
              </div>
              {filteredMails.map((mail) => (
                <div
                  key={mail.id}
                  className={`lp2-mail-table-row${!mail.read ? ' unread' : ''}`}
                  role="row"
                  tabIndex={0}
                  onClick={() => patchQuery({ mailId: mail.id, compose: null })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      patchQuery({ mailId: mail.id, compose: null })
                    }
                  }}
                >
                  <span className="lp2-mail-row-state" role="cell">
                    <i aria-hidden="true" />
                    <button
                      type="button"
                      aria-label={mail.starred ? '取消星标' : '添加星标'}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleStar(mail.id, mail.starred)
                      }}
                    >
                      {mail.starred ? <StarFilled /> : <StarOutlined />}
                    </button>
                  </span>
                  <span className="lp2-mail-counterparty" role="cell">
                    <strong>{displayCounterparty(mail, folder)}</strong>
                    <small>{folderLabel}</small>
                  </span>
                  <span className="lp2-mail-subject" role="cell">
                    <strong>{mail.subject || '(无主题)'}</strong>
                    <small>{mail.preview || '暂无预览内容'}</small>
                  </span>
                  <time role="cell">{mail.date}</time>
                  <span className="lp2-mail-open-cue" role="cell">›</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <article className="lp2-mail-detail-view">
          <header className="lp2-mail-read-toolbar">
            <Button icon={<RollbackOutlined />} onClick={() => patchQuery({ mailId: null })}>返回列表</Button>
            <div>
              {detailMail && (
                <>
                  <Button
                    icon={detailMail.starred ? <StarFilled /> : <StarOutlined />}
                    onClick={() => handleStar(detailMail.id, detailMail.starred)}
                  />
                  <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(detailMail.id)} />
                  <Button icon={<EditOutlined />} onClick={() => openCompose('reply')}>回复</Button>
                  <Button icon={<ShareAltOutlined />} onClick={() => openCompose('forward')}>转发</Button>
                  <Button icon={<ThunderboltOutlined />} onClick={handleConvertToFocus}>转为今日重点</Button>
                  <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary}>
                    甘蔗 Tutor 总结
                  </Button>
                </>
              )}
            </div>
          </header>

          {!detailMail ? (
            <div className="lp2-mail-detail-empty">
              <Empty description="未找到这封邮件">
                <Button onClick={() => patchQuery({ mailId: null })}>返回列表</Button>
              </Empty>
            </div>
          ) : (
            <>
              <section className="lp2-mail-read-header">
                <Tag color="purple">{folderLabel}</Tag>
                <h1>{detailMail.subject || '(无主题)'}</h1>
                <dl className="lp2-mail-read-meta">
                  <div><dt>发件人</dt><dd>{detailMail.from || '(未知发件人)'}</dd></div>
                  <div><dt>收件人</dt><dd>{detailMail.to || '(未读取到收件人)'}</dd></div>
                  <div><dt>日期</dt><dd>{detailMail.date || '(未读取到日期)'}</dd></div>
                </dl>
              </section>

              <section className="lp2-mail-read-body">
                {detailLoading ? (
                  <div className="lp2-mail-body-loading"><Spin /></div>
                ) : detail?.body ? (
                  <div
                    className="lp2-mail-html-body"
                    dangerouslySetInnerHTML={{ __html: detail.body }}
                  />
                ) : (
                  <p>{detailMail.preview || '正文暂时无法读取，请重新同步或检查 IMAP 连接。'}</p>
                )}

                {!!detail?.attachments?.length && (
                  <div className="lp2-mail-attachments">
                    {detail.attachments.map((attachment) => (
                      <span key={`${attachment.name}-${attachment.url}`}>{attachment.name}</span>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </article>
      )}

      <Modal
        title="甘蔗 Tutor 邮件总结"
        open={summaryOpen}
        onCancel={() => setSummaryOpen(false)}
        footer={null}
        width={640}
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
        title={composeMode === 'write' ? '写邮件' : composeMode === 'reply' ? '回复邮件' : '转发邮件'}
        open={composeOpen}
        onCancel={closeCompose}
        onOk={handleSendCompose}
        okText="发送"
        cancelText="取消"
        confirmLoading={composeSending}
        width={660}
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
            <Input.TextArea rows={10} placeholder="邮件正文..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
