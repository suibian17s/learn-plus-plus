import { useState } from 'react'
import { Card, Tag, Button, Input, Space } from 'antd'
import { EditOutlined, RobotOutlined } from '@ant-design/icons'

interface Props {
  originalDescription: string
  aiDraft: string
  edited: boolean
  onEdit: (text: string) => void
  onRegenerate: () => void
  onAddInstruction: (instr: string) => void
  attachmentName?: string
  loading?: boolean
}

export default function HomeworkPreview({
  originalDescription,
  aiDraft,
  edited,
  onEdit,
  onRegenerate,
  onAddInstruction,
  attachmentName,
  loading,
}: Props) {
  const [extraInstr, setExtraInstr] = useState('')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, height: '100%' }}>
      {/* Left: Original */}
      <Card
        title="题目原文"
        size="small"
        bodyStyle={{ maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}
      >
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 14, color: '#555' }}>
          {originalDescription.replace(/<[^>]+>/g, '')}
        </div>
      </Card>

      {/* Right: tutor Draft */}
      <Card
        title={
          <Space>
            <span>甘蔗 tutor 草稿</span>
            <Tag className={`ai-draft-label ${edited ? 'edited' : 'unedited'}`}>
              <RobotOutlined style={{ fontSize: 10 }} />
              {edited ? 'tutor 生成 · 已编辑' : 'tutor 生成 · 未编辑'}
            </Tag>
          </Space>
        }
        size="small"
        extra={
          <Space size={8}>
            <Input.Search
              placeholder="追加要求..."
              size="small"
              value={extraInstr}
              onChange={(e) => setExtraInstr(e.target.value)}
              onSearch={(v) => { onAddInstruction(v); setExtraInstr('') }}
              enterButton="↻"
              style={{ width: 180 }}
            />
            <Button size="small" onClick={onRegenerate} loading={loading}>
              重新生成
            </Button>
          </Space>
        }
        bodyStyle={{ maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}
      >
        <Input.TextArea
          value={aiDraft}
          onChange={(e) => onEdit(e.target.value)}
          autoSize={{ minRows: 10 }}
          style={{
            fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
            fontSize: 14,
            lineHeight: 1.8,
            border: 'none',
            background: '#fafafa',
            resize: 'none',
          }}
        />
        {attachmentName && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#F6FFED', borderRadius: 6, fontSize: 13 }}>
            生成附件: <strong>{attachmentName}</strong>
          </div>
        )}
      </Card>
    </div>
  )
}
