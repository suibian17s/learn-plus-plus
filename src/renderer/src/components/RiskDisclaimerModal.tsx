import { useState } from 'react'
import { Modal, Checkbox, Space, Alert } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'

interface Props {
  open: boolean
  onConfirm: () => void
}

export default function RiskDisclaimerModal({ open, onConfirm }: Props) {
  const [checked1, setChecked1] = useState(false)
  const [checked2, setChecked2] = useState(false)
  const [checked3, setChecked3] = useState(false)

  const allChecked = checked1 && checked2 && checked3

  async function handleConfirm() {
    if (!allChecked) return
    await window.learn.hwai.acknowledgeRisk()
    onConfirm()
  }

  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#CF1322', fontSize: 20 }} />
          <span style={{ color: '#CF1322' }}>甘蔗 tutor 高风险测试承诺书</span>
        </Space>
      }
      open={open}
      closable={false}
      maskClosable={false}
      footer={[
        <button
          key="confirm"
          onClick={handleConfirm}
          disabled={!allChecked}
          style={{
            background: allChecked ? '#660874' : '#d9d9d9',
            color: '#fff',
            border: 'none',
            padding: '8px 24px',
            borderRadius: 6,
            cursor: allChecked ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          我已理解，继续使用
        </button>,
      ]}
      width={560}
    >
      <Alert
        type="error"
        message="一键自动完成作业属于高风险测试能力。请务必阅读并签署以下学术诚信承诺："
        style={{ marginBottom: 20 }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Checkbox checked={checked1} onChange={(e) => setChecked1(e.target.checked)}>
          <strong>我理解甘蔗 tutor 生成的内容由我提交即视为我本人作品。</strong>
          <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
            提交到清华网络学堂的作业将以你的身份记录，甘蔗 tutor 仅提供测试性学习辅助。
          </div>
        </Checkbox>

        <Checkbox checked={checked2} onChange={(e) => setChecked2(e.target.checked)}>
          <strong>我会在提交前审阅并修改内容，对最终结果负责。</strong>
          <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
            你需要通读全文、修正错误、替换占位、补充个性化内容。
          </div>
        </Checkbox>

        <Checkbox checked={checked3} onChange={(e) => setChecked3(e.target.checked)}>
          <strong>我了解清华大学学生纪律相关规定，使用本功能造成的后果由我承担。</strong>
          <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
            学术诚信是清华学生的基本要求。该能力仅供测试和辅助学习，不能替代独立思考。
          </div>
        </Checkbox>
      </div>
    </Modal>
  )
}
