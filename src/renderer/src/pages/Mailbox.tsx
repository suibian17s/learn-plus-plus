import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Tag, Input, Select, Spin, Empty, message } from 'antd'
import {
  RollbackOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
  LoginOutlined,
  DeleteOutlined,
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

const MAIL_FOLDER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'starred', label: '星标' },
]

const SORT_OPTIONS = [
  { value: 'time', label: '时间排序' },
  { value: 'star', label: '星标优先' },
]

export default function MailboxPage() {
  const [searchParams] = useSearchParams()
  const folder = searchParams.get('folder') || 'inbox'

  const [mails, setMails] = useState<MailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mailLoggedIn, setMailLoggedIn] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('time')
  const [searchText, setSearchText] = useState('')

  // Check mail login status
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

  // Load mail list
  const loadMails = useCallback(async () => {
    if (!mailLoggedIn) return
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
  }, [folder, mailLoggedIn, selectedId])

  useEffect(() => {
    if (mailLoggedIn) loadMails()
  }, [mailLoggedIn, loadMails])

  // Reload when folder changes
  useEffect(() => {
    if (mailLoggedIn) {
      setSelectedId(null)
      loadMails()
    }
  }, [folder])

  // Filtered & sorted mail list
  const filteredMails = useMemo(() => {
    let list = [...mails]

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      list = list.filter(
        (m) =>
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
    // Default is time sort (kept as loaded)

    return list
  }, [mails, searchText, filter, sortBy])

  const selected = filteredMails.find((m) => m.id === selectedId) || filteredMails[0]

  async function handleLogin() {
    try {
      const r = await window.learn.mail.login()
      if (r.ok) {
        setMailLoggedIn(true)
        message.success('邮箱登录成功')
      } else {
        message.error('邮箱登录超时，请重试')
      }
    } catch {
      message.error('邮箱登录失败')
    }
  }

  async function handleStar(mailId: string, starred: boolean) {
    try {
      const r = await window.learn.mail.star(mailId, !starred)
      if (r.ok) {
        setMails((prev) =>
          prev.map((m) => (m.id === mailId ? { ...m, starred: !starred } : m)),
        )
      }
    } catch {
      message.error('操作失败')
    }
  }

  async function handleDelete(mailId: string) {
    try {
      const r = await window.learn.mail.delete(mailId)
      if (r.ok) {
        setMails((prev) => prev.filter((m) => m.id !== mailId))
        if (selectedId === mailId) setSelectedId(null)
        message.success('已删除')
      }
    } catch {
      message.error('删除失败')
    }
  }

  function planned(label: string) {
    message.info(`${label} 将在 v2.0 后续开发中接入`)
  }

  // ── Login prompt ──
  if (mailLoggedIn === false) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty
          image={<LoginOutlined style={{ fontSize: 64, color: '#BDB0D5' }} />}
          description="尚未登录清华邮箱"
        >
          <Button type="primary" size="large" icon={<LoginOutlined />} onClick={handleLogin}>
            登录清华邮箱
          </Button>
        </Empty>
      </div>
    )
  }

  // ── Loading ──
  if (mailLoggedIn === null || loading) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <div className="lp2-mail-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description={error}>
          <Button onClick={loadMails}>重试</Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="lp2-mail-page">
      <div className="lp2-mail-layout">
        <section className="lp2-mail-list">
          {filteredMails.length === 0 ? (
            <Empty description="暂无邮件" style={{ padding: 40 }} />
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
                    <strong>{mail.from || '(未知发件人)'}</strong>
                    <time>{mail.date}</time>
                  </span>
                  <small>{mail.subject}</small>
                  <em>{mail.preview}</em>
                </span>
                <span className="lp2-mail-row-meta">
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStar(mail.id, mail.starred)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
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
              <div>
                <Tag color="purple">{folder === 'inbox' ? '收件箱' : folder === 'drafts' ? '草稿箱' : folder === 'sent' ? '已发送' : folder === 'trash' ? '已删除' : folder}</Tag>
                <h2>{selected.subject}</h2>
                <p>{selected.from} · {selected.date}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  icon={selected.starred ? <StarFilled /> : <StarOutlined />}
                  onClick={() => handleStar(selected.id, selected.starred)}
                />
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(selected.id)}
                />
              </div>
            </div>

            <div className="lp2-mail-body">
              <p>{selected.preview || '暂无预览内容。点击邮件标题可查看详情。'}</p>
            </div>

            <div className="lp2-mail-detail-actions">
              <Button icon={<RollbackOutlined />} onClick={() => planned('回复邮件')}>回复</Button>
              <Button icon={<ShareAltOutlined />} onClick={() => planned('转发邮件')}>转发</Button>
              <Button type="primary" onClick={() => planned('转为今日重点')}>转为今日重点</Button>
            </div>
          </article>
        ) : (
          <div className="lp2-mail-detail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="请选择一封邮件" />
          </div>
        )}
      </div>
    </div>
  )
}
