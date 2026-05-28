import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Form, Input, Tag, Select, Spin, Empty, Modal, message } from 'antd'
import {
  RollbackOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
  LoginOutlined,
  DeleteOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'

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

const MAIL_FOLDER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'starred', label: '星标' },
]

const SORT_OPTIONS = [
  { value: 'time', label: '时间排序' },
  { value: 'star', label: '星标优先' },
]

const FOLDER_LABELS: Record<string, string> = {
  inbox: '收件箱', sent: '已发送', drafts: '草稿箱', trash: '已删除',
}

export default function MailboxPage() {
  const [searchParams] = useSearchParams()
  const folder = searchParams.get('folder') || 'inbox'
  const refreshToken = searchParams.get('refresh') || ''

  const [mails, setMails] = useState<MailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mailLoggedIn, setMailLoggedIn] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('time')
  const [searchText, setSearchText] = useState('')

  // Detail state
  const [detail, setDetail] = useState<MailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMode, setComposeMode] = useState<'reply' | 'forward'>('reply')
  const [composeSending, setComposeSending] = useState(false)
  const [composeForm] = Form.useForm()

  useEffect(() => {
    ;(async () => {
      try {
        const s = await window.learn.mail.status()
        setMailLoggedIn(s.loggedIn)
      } catch {
        setMailLoggedIn(false)
      }
    })()
  }, [])

  useEffect(() => {
    setSearchText(searchParams.get('q') || '')
    setFilter(searchParams.get('filter') || 'all')
    setSortBy(searchParams.get('sort') || 'time')
  }, [searchParams])

  const loadMails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.learn.mail.list(folder)
      setMails(result.mails)
      if (result.mails.length > 0 && !selectedId) {
        setSelectedId(result.mails[0].id)
      }
    } catch (err: any) {
      setError(err?.message || '加载邮件失败')
    } finally {
      setLoading(false)
    }
  }, [folder, selectedId])

  useEffect(() => {
    if (mailLoggedIn) { setLoading(true); loadMails() }
  }, [mailLoggedIn])

  useEffect(() => {
    if (mailLoggedIn) {
      setSelectedId(null)
      setDetail(null)
      loadMails()
    }
  }, [folder, mailLoggedIn, refreshToken])

  // Load detail when selecting a mail
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
      } catch { /* ignore */ }
      finally { if (!cancelled) setDetailLoading(false) }
    })()
    return () => { cancelled = true }
  }, [selectedId, mailLoggedIn])

  const filteredMails = useMemo(() => {
    let list = [...mails]
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      list = list.filter((m) =>
        m.subject.toLowerCase().includes(q) ||
        m.from.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q),
      )
    }
    if (filter === 'unread') list = list.filter((m) => !m.read)
    if (filter === 'starred') list = list.filter((m) => m.starred)
    if (sortBy === 'star') {
      list.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0))
    }
    return list
  }, [mails, searchText, filter, sortBy])

  const selected = filteredMails.find((m) => m.id === selectedId) || filteredMails[0]

  async function handleLogin() {
    try {
      const r = await window.learn.mail.login()
      if (r.ok) { setMailLoggedIn(true); message.success('邮箱登录成功') }
      else { message.error('邮箱登录超时，请重试') }
    } catch { message.error('邮箱登录失败') }
  }

  async function handleStar(mailId: string, starred: boolean) {
    try {
      const r = await window.learn.mail.star(mailId, !starred)
      if (r.ok) setMails((prev) => prev.map((m) => (m.id === mailId ? { ...m, starred: !starred } : m)))
    } catch { message.error('操作失败') }
  }

  async function handleDelete(mailId: string) {
    try {
      const r = await window.learn.mail.delete(mailId)
      if (r.ok) {
        setMails((prev) => prev.filter((m) => m.id !== mailId))
        if (selectedId === mailId) { setSelectedId(null); setDetail(null) }
        message.success('已删除')
      }
    } catch { message.error('删除失败') }
  }

  async function handleTutorSummary() {
    if (!detail) return
    setSummaryOpen(true)
    setSummaryLoading(true)
    setSummaryText('')
    try {
      // Strip HTML tags to get plain text for the AI
      const plainText = detail.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const content = `发件人：${detail.from}\n主题：${detail.subject}\n\n${plainText}`
      const askResult = await window.learn.hwai.tutorAsk('__mail__', `请总结以下邮件内容，提取关键信息：\n${content.slice(0, 4000)}`)
      setSummaryText(askResult.ok ? (askResult.content || '总结失败') : '总结生成失败，请稍后重试')
    } catch (err: any) {
      setSummaryText('总结失败：' + (err.message || '未知错误'))
    } finally {
      setSummaryLoading(false)
    }
  }

  function handleConvertToFocus() {
    if (!detail) return
    message.success(`已将「${detail.subject}」加入今日重点列表`)
  }

  function openCompose(mode: 'reply' | 'forward') {
    if (!detail) return
    setComposeMode(mode)
    const sender = detail.from.replace(/<[^>]*>/g, '').trim()
    composeForm.setFieldsValue({
      to: mode === 'reply' ? sender : '',
      subject: (mode === 'reply' ? 'Re: ' : 'Fwd: ') + (detail.subject || selected?.subject || ''),
      body: mode === 'forward'
        ? `\n\n---------- 转发的邮件 ----------\n发件人：${detail.from}\n日期：${detail.date}\n主题：${detail.subject}\n\n${detail.body.replace(/<[^>]+>/g, ' ')}`
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
        message.error(result.error || '发送失败，请使用"打开原站"手动发送')
      }
    } catch {
      // form validation failed
    } finally {
      setComposeSending(false)
    }
  }

  // ── Login prompt ──
  if (mailLoggedIn === false) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty image={<LoginOutlined style={{ fontSize: 64, color: '#BDB0D5' }} />} description="尚未登录清华邮箱">
          <Button type="primary" size="large" icon={<LoginOutlined />} onClick={handleLogin}>登录清华邮箱</Button>
        </Empty>
      </div>
    )
  }

  if (mailLoggedIn === null || loading) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description={error}><Button onClick={loadMails}>重试</Button></Empty>
      </div>
    )
  }

  const folderLabel = FOLDER_LABELS[folder] || folder

  return (
    <div className="lp2-mail-page">
      <div className="lp2-course-local-toolbar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Input placeholder="搜索邮件" allowClear value={searchText}
          onChange={(e) => setSearchText(e.target.value)} style={{ width: 200 }} />
        <Select value={filter} onChange={setFilter} options={MAIL_FOLDER_OPTIONS} style={{ width: 96 }} />
        <Select value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} style={{ width: 112 }} />
        <span style={{ color: '#888', fontSize: 13 }}>{mails.length} 封</span>
        <Button onClick={loadMails}>刷新</Button>
        <Button onClick={() => window.learn.mail.show()}>打开原站</Button>
      </div>
      <div className="lp2-mail-layout">
        <section className="lp2-mail-list">
          {filteredMails.length === 0 ? (
            <Empty description="暂无邮件" style={{ padding: 40 }} />
          ) : (
            filteredMails.map((mail) => (
              <button
                key={mail.id} type="button"
                className={`lp2-mail-row${mail.id === selected?.id ? ' active' : ''}${!mail.read ? ' unread' : ''}`}
                onClick={() => setSelectedId(mail.id)}
              >
                <span className="lp2-mail-row-main">
                  <span className="lp2-mail-row-top">
                    <strong>{mail.from || '(未知发件人)'}</strong>
                    <time>{mail.date}</time>
                  </span>
                  <small>{mail.subject}</small>
                  <em>{mail.preview}</em>
                </span>
                <span className="lp2-mail-row-meta">
                  <span onClick={(e) => { e.stopPropagation(); handleStar(mail.id, mail.starred) }} style={{ cursor: 'pointer' }}>
                    {mail.starred ? <StarFilled /> : <StarOutlined />}
                  </span>
                </span>
              </button>
            ))
          )}
        </section>

        {selected ? (
          <article className="lp2-mail-detail">
            <div className="lp2-mail-detail-title">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Tag color="purple">{folderLabel}</Tag>
                <h2>{detail?.subject || selected.subject}</h2>
                <p>{detail?.from || selected.from} · {detail?.date || selected.date}</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Button icon={selected.starred ? <StarFilled /> : <StarOutlined />}
                  onClick={() => handleStar(selected.id, selected.starred)} />
                <Button danger icon={<DeleteOutlined />}
                  onClick={() => handleDelete(selected.id)} />
              </div>
            </div>

            <div className="lp2-mail-body" style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
              {detailLoading ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
              ) : detail?.body ? (
                <div
                  dangerouslySetInnerHTML={{ __html: detail.body }}
                  style={{ lineHeight: 1.9, wordBreak: 'break-word' }}
                />
              ) : (
                <p style={{ color: '#999' }}>{selected.preview || '点击邮件标题查看详情'}</p>
              )}
            </div>

            <div className="lp2-mail-detail-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
              <Button icon={<RollbackOutlined />} onClick={() => openCompose('reply')}>回复</Button>
              <Button icon={<ShareAltOutlined />} onClick={() => openCompose('forward')}>转发</Button>
              <Button icon={<ThunderboltOutlined />} onClick={handleConvertToFocus}>转为今日重点</Button>
              <Button className="lp2-green-button" icon={<RobotOutlined />} onClick={handleTutorSummary}>甘蔗 Tutor 总结</Button>
            </div>
          </article>
        ) : (
          <div className="lp2-mail-detail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="请选择一封邮件" />
          </div>
        )}
      </div>

      <Modal title="甘蔗 Tutor 邮件总结" open={summaryOpen}
        onCancel={() => setSummaryOpen(false)} footer={null} width={600}>
        {summaryLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /><p style={{ marginTop: 12, color: '#888' }}>正在总结邮件内容...</p></div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{summaryText}</div>
        )}
      </Modal>

      {/* Compose modal */}
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
        <Form form={composeForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="to" label="收件人" rules={[{ required: true, message: '请输入收件人' }]}>
            <Input placeholder="收件人邮箱地址" />
          </Form.Item>
          <Form.Item name="subject" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
            <Input placeholder="邮件主题" />
          </Form.Item>
          <Form.Item name="body" label="正文">
            <Input.TextArea rows={8} placeholder="邮件正文..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
