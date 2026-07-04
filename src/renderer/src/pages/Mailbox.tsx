import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Collapse, Dropdown, Empty, Form, Input, Modal, Spin, Switch, message } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  LoginOutlined,
  MailOutlined,
  MoreOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  RobotOutlined,
  RollbackOutlined,
  SendOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import DOMPurify from 'dompurify'
import TutorSummaryDrawer from '../components/TutorSummaryDrawer'

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
  htmlBody?: string
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

// 去掉地址串中显示名外侧的引号："李晶" <a@b> → 李晶 <a@b>
function formatAddressDisplay(value: string): string {
  return normalizeText(value).replace(/"([^"]*)"/g, '$1')
}

// 折叠 Word/Foxmail 风格邮件里的空段落（<p>&nbsp;</p> 链），消除巨大段间距
function collapseEmptyParagraphs(html: string): string {
  return html.replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<o:p>|<\/o:p>)*<\/p>/gi, '')
}

const MAIL_IFRAME_STYLE = `
  body{margin:0;padding:6px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:14px;line-height:1.7;color:#333;word-break:break-word}
  img{max-width:100%;height:auto}
  table{max-width:100% !important}
  p{margin:0 0 0.75em}
  a{color:#6B46C1}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-thumb{background:#E4DCF4;border-radius:8px}
  ::-webkit-scrollbar-track{background:transparent}
`.replace(/\n\s*/g, '')

function displayCounterparty(mail: MailItem, folder: string): string {
  const value = folder === 'sent' || folder === 'drafts' ? (mail.to || mail.from) : mail.from
  return normalizeText(value) || '(未知联系人)'
}

// 模块级列表缓存：重进邮箱页 / 切换文件夹时先用上次数据即时渲染，避免整页 spinner
const mailListMemory = new Map<string, MailItem[]>()

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

  const [mails, setMails] = useState<MailItem[]>(() => mailListMemory.get(folder) || [])
  const [loading, setLoading] = useState(() => !mailListMemory.has(folder))
  const [error, setError] = useState<string | null>(null)
  const [mailLoggedIn, setMailLoggedIn] = useState<boolean | null>(null)
  const [detail, setDetail] = useState<MailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [metaExpanded, setMetaExpanded] = useState(false)
  const [composeMode, setComposeMode] = useState<'write' | 'reply' | 'forward'>('write')
  const [composePrefill, setComposePrefill] = useState<{ to?: string; subject?: string; body?: string }>({})
  const [composeSending, setComposeSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [composeForm] = Form.useForm()
  const [imapForm] = Form.useForm<MailLoginValues>()
  const [imapConnecting, setImapConnecting] = useState(false)

  const folderLabel = FOLDER_LABELS[folder] || folder

  const loadMails = useCallback(async (force = false) => {
    // 有缓存先即时渲染，后台静默换新；无缓存才显示 spinner
    const cached = mailListMemory.get(folder)
    if (cached) {
      setMails(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const result = await window.learn.mail.list(folder, force)
      mailListMemory.set(folder, result.mails || [])
      setMails(result.mails || [])
    } catch (err: any) {
      if (!cached) {
        setError(err?.message || '加载邮件失败')
        setMails([])
      }
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

  const lastRefreshTokenRef = useRef('')
  useEffect(() => {
    if (mailLoggedIn === true) {
      setDetail(null)
      // 顶栏刷新按钮改变 refreshToken 时强制绕过缓存
      const force = !!refreshToken && refreshToken !== lastRefreshTokenRef.current
      lastRefreshTokenRef.current = refreshToken
      loadMails(force)
    }
    if (mailLoggedIn === false) setLoading(false)
  }, [folder, mailLoggedIn, refreshToken, loadMails])

  // 星标/删除等本地更新同步回模块缓存，避免重进页面看到旧状态
  useEffect(() => {
    if (!loading) mailListMemory.set(folder, mails)
  }, [mails, loading, folder])

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
  const hasActiveFilter = filter !== 'all' || !!searchText.trim()

  useEffect(() => {
    if (!activeMailId || !mailLoggedIn) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      setDetail(null)
      setMetaExpanded(false)
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
            htmlBody: result.htmlBody || undefined,
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
    if (composeOpen) return // 回复/转发已打开写信视图时不重置为空白写信
    setComposeMode('write')
    setComposePrefill({})
    setComposeOpen(true)
  }, [composeRequested, composeOpen])

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
    patchQuery({ compose: null })
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
      const result = await window.learn.mail.delete(mailId, folder)
      if (result.ok) {
        setMails((prev) => prev.filter((mail) => mail.id !== mailId))
        if (activeMailId === mailId) patchQuery({ mailId: null })
        message.success('已删除')
      }
    } catch {
      message.error('删除失败')
    }
  }

  function handleTutorSummary() {
    const subject = detail?.subject || selected?.subject || ''
    const body = detail?.body ? stripHtml(detail.body) : selected?.preview || ''
    if (!subject && !body) return
    setSummaryOpen(true)
  }

  function runMailSummary(sessionId: string) {
    const subject = detail?.subject || selected?.subject || ''
    const from = detail?.from || selected?.from || ''
    const body = detail?.body ? stripHtml(detail.body) : selected?.preview || ''
    const content = `发件人：${from}\n主题：${subject}\n\n${body}`
    return window.learn.hwai.tutorAsk(
      '__mail__',
      `请总结以下邮件内容，提取关键信息、待办事项和时间节点：\n${content.slice(0, 4000)}`,
      sessionId,
    )
  }

  async function handleConvertToFocus() {
    const mail = detail || selected
    if (!mail?.subject) return
    try {
      const result = await window.learn.focus.add({
        id: `mail-${mail.id}`,
        type: 'email',
        title: mail.subject,
        description: mail.from || '',
        createdAt: new Date().toISOString(),
        mailId: mail.id,
      })
      if (result.ok) message.success(`已将「${mail.subject}」加入今日重点`)
      else message.error('加入今日重点失败')
    } catch {
      message.error('加入今日重点失败')
    }
  }

  function openCompose(mode: 'reply' | 'forward') {
    if (!selected && !detail) return
    const subject = detail?.subject || selected?.subject || ''
    const from = detail?.from || selected?.from || ''
    const date = detail?.date || selected?.date || ''
    const plainBody = detail?.body ? stripHtml(detail.body) : selected?.preview || ''

    setComposeMode(mode)
    setComposePrefill({
      to: mode === 'reply' ? extractReplyAddress(from) : '',
      subject: `${mode === 'reply' ? 'Re: ' : 'Fwd: '}${subject}`,
      body: mode === 'forward'
        ? `\n\n---------- 转发的邮件 ----------\n发件人：${from}\n日期：${date}\n主题：${subject}\n\n${plainBody}`
        : '',
    })
    setComposeOpen(true)
    patchQuery({ compose: '1' })
  }

  async function handleDraftMail() {
    const values = composeForm.getFieldsValue()
    const points = String(values.body || '').trim()
    if (!points) {
      message.info('请先在正文里写下要点（例如：向张老师请假，周三有病假条），甘蔗会扩写成完整邮件')
      return
    }
    setDrafting(true)
    try {
      const result = await window.learn.hwai.draftMail({ purpose: points, subject: values.subject || '' })
      if (result.ok && result.draft) {
        composeForm.setFieldsValue({ body: result.draft })
        message.success('草稿已生成，请检查并修改后再发送')
      } else {
        message.error(result.error || '生成失败，请检查 AI 配置')
      }
    } catch (err: any) {
      message.error('生成失败：' + (err?.message || '未知错误'))
    } finally {
      setDrafting(false)
    }
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
          <span className="lp2-mail-login-icon"><MailOutlined /></span>
          <h2>登录清华邮箱</h2>
          <p className="lp2-mail-login-sub">使用邮箱账号与密码连接，Learn++ 像常规邮件客户端一样同步邮件</p>
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
            <Form.Item name="mailUsername" rules={[{ required: true, message: '请输入邮箱账号' }]}>
              <Input size="large" placeholder="邮箱账号（username@mails.tsinghua.edu.cn）" />
            </Form.Item>
            <Form.Item
              name="mailPassword"
              extra="开启两步验证的账号请使用客户端专用密码；留空则使用已保存的密码"
            >
              <Input.Password size="large" placeholder="邮箱密码" />
            </Form.Item>
            <Button
              type="primary"
              size="large"
              block
              icon={<LoginOutlined />}
              loading={imapConnecting}
              onClick={handleLogin}
              className="lp2-mail-login-submit"
            >
              登录邮箱
            </Button>
            <Collapse
              ghost
              className="lp2-imap-advanced"
              items={[{
                key: 'advanced',
                label: '高级设置（服务器与加密，默认适用于清华邮箱）',
                children: (
                  <>
                    <div className="lp2-imap-form-grid">
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
                    <Button onClick={handleTestImap} block>测试连接</Button>
                  </>
                ),
              }]}
            />
          </Form>
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
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => loadMails(true)}>重试</Button>
            <Button icon={<LoginOutlined />} onClick={() => setMailLoggedIn(false)}>重新配置 IMAP</Button>
          </div>
        </section>
      </div>
    )
  }

  const detailMail = detail || selected

  return (
    <div className="lp2-mail-page">
      {composeOpen ? (
        <article className="lp2-mail-compose-view">
          <header className="lp2-mail-read-toolbar">
            <Button icon={<RollbackOutlined />} onClick={closeCompose}>返回</Button>
            <div>
              <Button
                className="lp2-green-button"
                icon={<RobotOutlined />}
                loading={drafting}
                onClick={handleDraftMail}
                title="把正文里的要点交给甘蔗 Tutor，生成完整邮件草稿"
              >
                甘蔗代笔
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={composeSending}
                onClick={handleSendCompose}
              >
                发送
              </Button>
            </div>
          </header>
          <div className="lp2-mail-compose-body">
            <h1>{composeMode === 'write' ? '写邮件' : composeMode === 'reply' ? '回复邮件' : '转发邮件'}</h1>
            <Form form={composeForm} layout="vertical" className="lp2-mail-compose-form" initialValues={composePrefill}>
              <Form.Item name="to" label="收件人" rules={[{ required: true, message: '请输入收件人' }]}>
                <Input placeholder="收件人邮箱地址" />
              </Form.Item>
              <Form.Item name="subject" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
                <Input placeholder="邮件主题" />
              </Form.Item>
              <Form.Item name="body" label="正文">
                <Input.TextArea autoSize={{ minRows: 12, maxRows: 24 }} placeholder="邮件正文..." />
              </Form.Item>
            </Form>
          </div>
        </article>
      ) : !activeMailId ? (
        <section className="lp2-mail-list-view" aria-label={`${folderLabel}邮件列表`}>
          <header className="lp2-mail-list-summary">
            <div>
              <span className="lp2-mail-summary-icon"><InboxOutlined /></span>
              <strong>{folderLabel}</strong>
              <small>{hasActiveFilter ? `匹配 ${filteredMails.length} 封` : `${mails.length} 封 · ${unreadCount} 未读`}</small>
            </div>
          </header>

          {filteredMails.length === 0 ? (
            <div className="lp2-mail-list-empty">
              <Empty description={mails.length ? '当前筛选下没有邮件' : '未读取到邮件'}>
                <Button icon={<ReloadOutlined />} onClick={() => loadMails(true)}>重新读取</Button>
              </Empty>
            </div>
          ) : (
            <div className="lp2-mail-table" role="table">
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
                      className={mail.starred ? 'is-starred' : ''}
                      aria-label={mail.starred ? '取消星标' : '添加星标'}
                      title={mail.starred ? '取消星标' : '添加星标'}
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
                  </span>
                  <span className="lp2-mail-subject" role="cell">
                    <strong>{mail.subject || '(无主题)'}</strong>
                    {mail.preview ? <small>{mail.preview}</small> : null}
                  </span>
                  <time role="cell">{mail.date}</time>
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
                  <Button icon={<EditOutlined />} onClick={() => openCompose('reply')}>回复</Button>
                  <Button icon={<ShareAltOutlined />} onClick={() => openCompose('forward')}>转发</Button>
                  <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary}>
                    甘蔗 Tutor 总结
                  </Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'star',
                          icon: detailMail.starred ? <StarFilled /> : <StarOutlined />,
                          label: detailMail.starred ? '取消星标' : '添加星标',
                        },
                        {
                          key: 'focus',
                          icon: <ThunderboltOutlined />,
                          label: '转为今日重点',
                        },
                        { type: 'divider' },
                        {
                          key: 'delete',
                          icon: <DeleteOutlined />,
                          label: '删除邮件',
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'star') handleStar(detailMail.id, detailMail.starred)
                        if (key === 'focus') handleConvertToFocus()
                        if (key === 'delete') handleDelete(detailMail.id)
                      },
                    }}
                  >
                    <Button icon={<MoreOutlined />} aria-label="更多操作" title="更多操作" />
                  </Dropdown>
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
                <h1>{detailMail.subject || '(无主题)'}</h1>
                <div className="lp2-mail-meta-line">
                  <strong>{formatAddressDisplay(detailMail.from) || '(未知发件人)'}</strong>
                  {detailMail.date && <span className="lp2-mail-meta-sep">·</span>}
                  <time>{detailMail.date}</time>
                </div>
                {detailMail.to && (
                  <div
                    className={`lp2-mail-meta-line secondary${metaExpanded ? ' expanded' : ''}`}
                    title={metaExpanded ? '点击收起' : '点击展开全部收件人'}
                    onClick={() => setMetaExpanded((v) => !v)}
                  >
                    收件人：{formatAddressDisplay(detailMail.to)}
                  </div>
                )}
              </section>

              <section className="lp2-mail-read-body">
                {detailLoading ? (
                  <div className="lp2-mail-body-loading"><Spin /></div>
                ) : detail?.htmlBody ? (
                  <iframe sandbox="allow-popups allow-popups-to-escape-sandbox"
                    title="邮件正文"
                    srcDoc={`<base target="_blank"><style>${MAIL_IFRAME_STYLE}</style>${DOMPurify.sanitize(collapseEmptyParagraphs(detail.htmlBody))}`}
                    style={{ flex: 1, minHeight: 0, width: '100%', border: 'none' }} />
                ) : detail?.body ? (
                  <div
                    className="lp2-mail-html-body"
                    dangerouslySetInnerHTML={{ __html: detail.body }}
                  />
                ) : (
                  <p>{(detailMail?.preview) || '(无正文内容)'}</p>
                )}

                {!!detail?.attachments?.length && (
                  <div className="lp2-mail-attachments">
                    {detail.attachments.map((att: any) => (
                      <button
                        key={att.name}
                        type="button"
                        className="lp2-mail-attachment-chip"
                        title={`保存附件：${att.name}`}
                        onClick={() => window.learn.mail.saveAttachment(att.url, att.name)}
                      >
                        <PaperClipOutlined />
                        <span>{att.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </article>
      )}

      <TutorSummaryDrawer
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title={`邮件总结 · ${(detail?.subject || selected?.subject || '').slice(0, 20)}`}
        summaryKey={`mail:${detail?.id || selected?.id || ''}`}
        run={runMailSummary}
      />
    </div>
  )
}
