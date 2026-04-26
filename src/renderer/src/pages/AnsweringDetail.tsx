import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Typography, Divider, Spin, Empty } from 'antd'
import {
  ArrowLeftOutlined, UserOutlined, ClockCircleOutlined,
  ExportOutlined, QuestionCircleOutlined,
} from '@ant-design/icons'
import DOMPurify from 'dompurify'

const { Title, Text } = Typography

export default function AnsweringDetailPage() {
  const { courseId, questionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const q = (location.state as any)?.question

  const url = q?.url || ''

  const { data, isLoading } = useQuery({
    queryKey: ['answer-detail', url],
    queryFn: () => window.learn.answering.detail(url),
    enabled: !!url,
  })

  if (!q) return <Empty description="答疑不存在" />
  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />
  if (data?.error) {
    return (
      <div style={{ maxWidth: 800 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}
          style={{ padding: 0, marginBottom: 16 }}>
          返回列表
        </Button>
        <Empty description={`加载失败: ${data.error}`}>
          {url && (
            <Button type="primary" icon={<ExportOutlined />}
              onClick={() => window.learn.openExternal(url)}>
              在浏览器中打开
            </Button>
          )}
        </Empty>
      </div>
    )
  }

  const sanitize = (html: string) => ({
    __html: DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'span', 'div',
        'img', 'a', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'font', 'hr'],
      ALLOWED_ATTR: ['href', 'src', 'style', 'color', 'class', 'width', 'height', 'align'],
    }),
  })

  return (
    <div style={{ maxWidth: 800 }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}
        style={{ padding: 0, marginBottom: 16 }}>
        返回列表
      </Button>

      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <QuestionCircleOutlined style={{ color: '#660874', fontSize: 18 }} />
          <Title level={4} style={{ margin: 0 }}>{data?.title || q.question}</Title>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, color: '#666', fontSize: 13 }}>
          {(data?.author || q.author) && (
            <span><UserOutlined style={{ marginRight: 4 }} />{data?.author || q.author}</span>
          )}
          <span><ClockCircleOutlined style={{ marginRight: 4 }} />提问: {data?.time || q.askTime}</span>
        </div>

        {data?.content ? (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <div
              style={{ fontSize: 14, lineHeight: 1.8, maxHeight: 400, overflow: 'auto' }}
              dangerouslySetInnerHTML={sanitize(data.content)}
            />
          </>
        ) : (
          <div style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: 24 }}>未能抓取到问题正文</div>
        )}

        {data?.answer && (
          <>
            <Divider style={{ margin: '16px 0 12px' }}>
              <Text type="secondary">老师回答</Text>
            </Divider>
            <div style={{
              background: '#f6ffed', border: '1px solid #d9f7be', borderRadius: 6,
              padding: 16, fontSize: 14, lineHeight: 1.8,
            }}>
              <div dangerouslySetInnerHTML={sanitize(data.answer)} />
              {(data.answerAuthor || data.answerTime) && (
                <div style={{ fontSize: 12, color: '#999', marginTop: 8, borderTop: '1px solid #d9f7be', paddingTop: 8 }}>
                  {data.answerAuthor && <span><UserOutlined style={{ marginRight: 4 }} />{data.answerAuthor}</span>}
                  {data.answerTime && <span style={{ marginLeft: 12 }}>{data.answerTime}</span>}
                </div>
              )}
            </div>
          </>
        )}

        {url && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button type="link" icon={<ExportOutlined />}
              onClick={() => window.learn.openExternal(url)}>
              在浏览器中查看完整页面
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
