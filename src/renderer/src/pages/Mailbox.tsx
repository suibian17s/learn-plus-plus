import { useState } from 'react'
import { Button, Tag, message } from 'antd'
import {
  RollbackOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons'

const mails = [
  {
    id: 'mail-1',
    sender: '赵老师',
    email: 'zhao_laoshi@tsinghua.edu.cn',
    subject: '第3章讨论区优秀回复公布',
    summary: '同学们好，大家在第3章讨论区的积极参与和精彩分享...',
    time: '10:30',
    unread: true,
    starred: true,
  },
  {
    id: 'mail-2',
    sender: '系统通知',
    email: 'learn@tsinghua.edu.cn',
    subject: '作业提交成功通知',
    summary: '你的作业《心理学导论 第2章作业》已成功提交。',
    time: '昨天',
    unread: true,
    starred: false,
  },
  {
    id: 'mail-3',
    sender: '教务处',
    email: 'jwc@tsinghua.edu.cn',
    subject: '关于2025-2026学年选课安排的通知',
    summary: '各位同学：现将本学年选课事项通知如下...',
    time: '昨天',
    unread: false,
    starred: false,
  },
  {
    id: 'mail-4',
    sender: '李助教',
    email: 'assistant@tsinghua.edu.cn',
    subject: '实验报告格式说明',
    summary: '同学们好，实验报告请按照附件格式提交...',
    time: '05-25',
    unread: false,
    starred: false,
  },
]

export default function MailboxPage() {
  const [selectedId, setSelectedId] = useState(mails[0].id)
  const selected = mails.find((mail) => mail.id === selectedId) || mails[0]

  function planned(label: string) {
    message.info(`${label} 将在 v2.0 后续开发中接入`)
  }

  return (
    <div className="lp2-mail-page">
      <div className="lp2-mail-layout">
        <section className="lp2-mail-list">
          {mails.map((mail) => (
            <button
              key={mail.id}
              type="button"
              className={`lp2-mail-row${mail.id === selectedId ? ' active' : ''}${mail.unread ? ' unread' : ''}`}
              onClick={() => setSelectedId(mail.id)}
            >
              <span className="lp2-mail-row-main">
                <span className="lp2-mail-row-top">
                  <strong>{mail.sender}</strong>
                  <time>{mail.time}</time>
                </span>
                <small>{mail.subject}</small>
                <em>{mail.summary}</em>
              </span>
              <span className="lp2-mail-row-meta">
                {mail.starred ? <StarFilled /> : <StarOutlined />}
              </span>
            </button>
          ))}
        </section>

        <article className="lp2-mail-detail">
          <div className="lp2-mail-detail-title">
            <div>
              <Tag color="purple">课程通知</Tag>
              <h2>{selected.subject}</h2>
              <p>{selected.sender} &lt;{selected.email}&gt; · {selected.time}</p>
            </div>
            <Button icon={selected.starred ? <StarFilled /> : <StarOutlined />} onClick={() => planned('星标邮件')} />
          </div>

          <div className="lp2-mail-body">
            <p>同学们好，</p>
            <p>感谢大家在第3章讨论区的积极参与和精彩分享！</p>
            <p>经过评选，以下同学的回复被评为优秀回复：</p>
            <ul>
              <li>甘蔗同学：视角独特，分析深入</li>
              <li>小明同学：结合案例，论证充分</li>
              <li>小红同学：逻辑清晰，表达流畅</li>
            </ul>
            <p>请大家继续保持积极思考，踊跃参与讨论！</p>
            <p>赵老师<br />2026年5月26日</p>
          </div>

          <div className="lp2-mail-detail-actions">
            <Button icon={<RollbackOutlined />} onClick={() => planned('回复邮件')}>回复</Button>
            <Button icon={<ShareAltOutlined />} onClick={() => planned('转发邮件')}>转发</Button>
            <Button type="primary" onClick={() => planned('转为今日重点')}>转为今日重点</Button>
          </div>
        </article>
      </div>
    </div>
  )
}
