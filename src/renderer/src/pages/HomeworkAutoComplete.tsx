import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, Button, Tag, Spin, Alert, Modal, message, Space } from 'antd'
import {
  RobotOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAiStore } from '../store/ai'
import RiskDisclaimerModal from '../components/RiskDisclaimerModal'
import HomeworkPreview from '../components/HomeworkPreview'
import EmptyState from '../components/EmptyState'

const TYPE_LABELS: Record<string, { text: string; color: string }> = {
  text: { text: '文本简答', color: 'blue' },
  report: { text: '报告/论文', color: 'purple' },
  code: { text: '代码作业', color: 'cyan' },
  lab: { text: '实验报告', color: 'geekblue' },
  ppt: { text: 'PPT 汇报', color: 'orange' },
  unknown: { text: '未识别', color: 'default' },
}

interface ScanItem {
  homeworkId: string
  studentHomeworkId: string
  title: string
  deadline: string
  type: string
  confidence: number
  courseId: string
  courseName: string
}

type View = 'scan' | 'review'

export default function HomeworkAutoComplete() {
  const { courseId } = useParams()
  const { riskAcknowledged, setRiskAcknowledged, generating, setGenerating, streamText, appendStreamText, clearStreamText } = useAiStore()

  const [showRiskModal, setShowRiskModal] = useState(false)
  const [view, setView] = useState<View>('scan')
  const [selectedHw, setSelectedHw] = useState<ScanItem | null>(null)
  const [analyzed, setAnalyzed] = useState<any>(null)
  const [draft, setDraft] = useState('')
  const [edited, setEdited] = useState(false)
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null)
  const [userInstruction, setUserInstruction] = useState('')
  const [sessionId] = useState(() => `session-${Date.now()}`)
  const [submitModal, setSubmitModal] = useState(false)
  const [codeVerified, setCodeVerified] = useState(false)
  const [orchestratePhase, setOrchestratePhase] = useState<string>('')
  const [reviewOutput, setReviewOutput] = useState<any>(null)
  const [styleProfile, setStyleProfile] = useState<any>(null)
  const [styleFallback, setStyleFallback] = useState(false)

  // Check risk acknowledgement
  useEffect(() => {
    window.learn.hwai.hasAcknowledgedRisk().then((ack: boolean) => {
      setRiskAcknowledged(ack)
      if (!ack) setShowRiskModal(true)
    })
  }, [])

  // Listen for stream chunks
  useEffect(() => {
    const unsubChunk = window.learn.hwai.onChunk(({ sessionId: sid, delta }) => {
      if (sid === sessionId && delta) {
        appendStreamText(delta)
      }
    })
    const unsubEnd = window.learn.hwai.onEnd(({ sessionId: sid }) => {
      if (sid === sessionId) {
        setDraft(useAiStore.getState().streamText)
        setGenerating(false)
      }
    })
    return () => { unsubChunk(); unsubEnd() }
  }, [sessionId])

  const { data: scanList, isLoading } = useQuery({
    queryKey: ['hwai-scan', courseId],
    queryFn: () => window.learn.hwai.scan(courseId!),
    enabled: !!courseId && riskAcknowledged,
  })

  async function handleSelect(hw: ScanItem) {
    setSelectedHw(hw)
    setView('review')

    try {
      const analysis = await window.learn.hwai.analyze(courseId!, hw.homeworkId)
      setAnalyzed(analysis)

      // Use new orchestrate pipeline
      setGenerating(true)
      clearStreamText()
      setOrchestratePhase('analyzing')
      setStyleFallback(false)

      const result = await window.learn.hwai.orchestrate({
        analyzed: analysis,
        sessionId: `orch-${Date.now()}`,
      })

      if (!result.ok) {
        message.error(result.error || '生成失败')
        setGenerating(false)
        return
      }

      const orchResult = result.result
      setDraft(orchResult.contentMarkdown)
      setReviewOutput(orchResult.review)
      setStyleProfile(orchResult.styleProfile)

      if (!orchResult.styleProfile) {
        setStyleFallback(true)
      }

      // 附件优先：除代码作业外一律生成 DOCX 附件（提交时以附件为主体，不再把全文塞进文本框）
      if (analysis.type !== 'code') {
        const ar = await window.learn.hwai.buildAttachment(
          { kind: 'docx', filename: `${hw.title || 'homework'}.docx` },
          orchResult.contentMarkdown,
        )
        if (ar.tempPath) setAttachmentPath(ar.tempPath)
      }

      setGenerating(false)
    } catch (err) {
      message.error(`AI 处理失败: ${err}`)
      setGenerating(false)
    }
  }

  async function handleRegenerate() {
    if (!analyzed) return
    setGenerating(true)
    clearStreamText()
    setOrchestratePhase('analyzing')
    setStyleFallback(false)
    try {
      const result = await window.learn.hwai.orchestrate({
        analyzed,
        sessionId: `orch-${Date.now()}`,
        outputFormat: undefined,
      })
      if (result.ok && result.result) {
        setDraft(result.result.contentMarkdown)
        setReviewOutput(result.result.review)
        setStyleProfile(result.result.styleProfile)
        if (!result.result.styleProfile) {
          setStyleFallback(true)
        }
      } else if (result.error) {
        message.error(result.error)
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleRegenerateWithFormat(format: string) {
    if (!analyzed) return
    setGenerating(true)
    clearStreamText()
    setStyleFallback(false)
    try {
      const result = await window.learn.hwai.orchestrate({
        analyzed,
        sessionId: `orch-${Date.now()}`,
        outputFormat: format,
      })
      if (result.ok && result.result) {
        setDraft(result.result.contentMarkdown)
        setReviewOutput(result.result.review)
        setStyleProfile(result.result.styleProfile)
      }
    } catch (err) {
      message.error(`重新生成失败: ${err}`)
    }
    setGenerating(false)
  }

  async function handleSubmit() {
    if (!selectedHw || !draft) return
    try {
      // 附件优先提交：正文编辑过或附件缺失时，用最新草稿重建 DOCX
      let attach = attachmentPath
      if (analyzed?.type !== 'code' && (edited || !attach)) {
        try {
          const ar = await window.learn.hwai.buildAttachment(
            { kind: 'docx', filename: `${selectedHw.title || 'homework'}.docx` },
            draft,
          )
          if (ar.tempPath) {
            attach = ar.tempPath
            setAttachmentPath(ar.tempPath)
          }
        } catch { /* 附件构建失败则退回文本提交 */ }
      }
      // 有附件时文本框只留说明，作业主体在附件里（符合常规提交习惯）
      const contentText = attach ? '详见附件。' : draft
      const result = await window.learn.hw.submit(selectedHw.studentHomeworkId, contentText, attach || undefined)
      if (!result.ok) {
        message.error(`提交失败: ${result.error || '未知错误'}`)
        return
      }
      message.success(attach ? '已提交（正文为 DOCX 附件）。建议到网页学堂确认。' : '提交成功！建议到网页学堂确认提交内容。')
      setSubmitModal(false)
      setView('scan')
    } catch (err) {
      message.error(`提交失败: ${err}`)
    }
  }

  function checkPlaceholders(text: string): boolean {
    return /\[需要学生补充:[^\]]*\]/.test(text)
  }

  if (isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />

  return (
    <div>
      {/* Risk Disclaimer Modal */}
      <RiskDisclaimerModal
        open={showRiskModal}
        onConfirm={() => { setRiskAcknowledged(true); setShowRiskModal(false) }}
      />

      {!riskAcknowledged && !showRiskModal ? (
        <Alert
          type="warning"
          message="请先完成学术诚信承诺书才能使用甘蔗 tutor 的一键自动完成作业能力"
          action={
            <Button size="small" onClick={() => setShowRiskModal(true)}>签署承诺书</Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {/* Warning banner */}
      {view === 'review' && (
        <Alert
          type="warning"
          message="甘蔗 tutor 草稿仅供参考，提交前请审阅。学术诚信由你本人负责。"
          className="risk-banner"
          showIcon
          icon={<WarningOutlined />}
        />
      )}

      {view === 'scan' && (
        <>
          <div className="lp2-hwauto-head">
            <h3>选择要自动生成草稿的作业</h3>
            <p>高风险能力 · 仅显示未提交作业 · 草稿会生成 DOCX 附件，提交前请务必通读并修改</p>
          </div>

          {!scanList?.length ? (
            <EmptyState description="所有作业已提交，没有需要 AI 协助的" />
          ) : (
            <div className="lp2-hwauto-grid">
              {(scanList || []).map((hw: ScanItem) => {
                const typeInfo = TYPE_LABELS[hw.type] || TYPE_LABELS.unknown
                const isManual = hw.type === 'ppt' || hw.type === 'unknown'
                const daysLeft = hw.deadline ? dayjs(hw.deadline).diff(dayjs(), 'day') : null
                const overdue = daysLeft !== null && daysLeft < 0
                const urgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 2

                return (
                  <div key={hw.homeworkId} className={`lp2-hwauto-card${isManual ? ' manual' : ''}`}>
                    <strong className="lp2-hwauto-title">{hw.title}</strong>
                    <div className="lp2-hwauto-meta">
                      <Tag color={typeInfo.color}>{typeInfo.text}</Tag>
                      {hw.deadline && (
                        <span className={`lp2-hwauto-deadline${urgent ? ' urgent' : ''}`}>
                          {dayjs(hw.deadline).format('M月D日 HH:mm')} 截止
                          {overdue ? ' · 已逾期' : daysLeft !== null ? ` · 剩余 ${daysLeft} 天` : ''}
                        </span>
                      )}
                    </div>
                    {isManual && (
                      <p className="lp2-hwauto-manual-note">
                        {hw.type === 'ppt' ? 'PPT 汇报不自动生成，仅提供大纲建议' : '无法识别作业类型，建议手动完成'}
                      </p>
                    )}
                    <div className="lp2-hwauto-actions">
                      <Button
                        type="primary"
                        icon={<RobotOutlined />}
                        disabled={isManual}
                        onClick={() => handleSelect(hw)}
                      >
                        自动生成
                      </Button>
                      <Button
                        type="text"
                        onClick={() => window.learn.openExternal(
                          `https://learn.tsinghua.edu.cn/f/wlxt/homework/detail/${hw.homeworkId}`
                        )}
                      >
                        打开原页面
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {view === 'review' && (
        <div>
          <Button size="small" onClick={() => setView('scan')} style={{ marginBottom: 12 }}>
            ← 返回扫描列表
          </Button>

          {generating ? (
            <Card style={{ textAlign: 'center', padding: 60 }}>
              <Spin size="large" />
              <div style={{ marginTop: 20 }}>
                <RobotOutlined style={{ fontSize: 36, color: '#52C41A' }} />
                <div style={{ marginTop: 16, fontSize: 15, fontWeight: 500, color: '#333' }}>
                  {orchestratePhase === 'analyzing' && '正在扫描课件和课程资料...'}
                  {orchestratePhase === 'learning-style' && '正在学习往期作业风格...'}
                  {orchestratePhase === 'decomposing' && '正在分析题目结构...'}
                  {orchestratePhase === 'assembling' && '正在组装答案...'}
                  {orchestratePhase === 'reviewing' && '甘蔗 Tutor 正在审查草稿...'}
                  {orchestratePhase === 'done' && '完成！'}
                </div>
                {orchestratePhase === 'done' && (
                  <Button onClick={() => setGenerating(false)} style={{ marginTop: 12 }}>
                    查看草稿
                  </Button>
                )}
              </div>
              {streamText && (
                <div style={{
                  marginTop: 20,
                  maxWidth: 640,
                  margin: '20px auto',
                  textAlign: 'left',
                  whiteSpace: 'pre-wrap',
                  background: '#f9f9f9',
                  padding: 16,
                  borderRadius: 8,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: 14,
                }}>
                  {streamText}
                </div>
              )}
              <Button onClick={() => window.learn.hwai.abort(sessionId)} style={{ marginTop: 16 }}>
                取消生成
              </Button>
            </Card>
          ) : (
            <>
              <HomeworkPreview
                originalDescription={analyzed?.hw?.description || ''}
                aiDraft={draft}
                edited={edited}
                onEdit={(text) => { setDraft(text); setEdited(true) }}
                onRegenerate={handleRegenerate}
                onAddInstruction={(instr) => {
                  setUserInstruction(instr)
                  handleRegenerate()
                }}
                attachmentName={attachmentPath ? attachmentPath.split(/[/\\]/).pop() : undefined}
              />

              {/* Style fallback alert */}
              {styleFallback && !generating && (
                <Alert
                  type="info"
                  showIcon
                  message="无法识别该课程往期作业风格（可能首次提交或历史作业不可访问），已使用标准学术格式生成。"
                  style={{ marginBottom: 16 }}
                  action={
                    <Space>
                      <Button size="small" onClick={() => handleRegenerateWithFormat('latex')}>LaTeX 格式</Button>
                      <Button size="small" onClick={() => handleRegenerateWithFormat('docx')}>DOCX 格式</Button>
                      <Button size="small" onClick={() => handleRegenerateWithFormat('pdf')}>PDF 格式</Button>
                    </Space>
                  }
                />
              )}

              {/* Code homework guard */}
              {analyzed?.type === 'code' && (
                <Alert
                  type="warning"
                  message="代码作业"
                  description="甘蔗 tutor 生成的代码不一定能运行。强烈建议本地运行验证后再提交。"
                  style={{ marginTop: 16 }}
                  showIcon
                />
              )}

              {/* Placeholder check */}
              {checkPlaceholders(draft) && (
                <Alert
                  type="error"
                  message="草稿包含占位标记 [需要学生补充: ...]，请替换后再提交"
                  style={{ marginTop: 16 }}
                  showIcon
                />
              )}

              {/* Review results card */}
              {reviewOutput && !generating && (
                <Card
                  size="small"
                  title={<Space><RobotOutlined style={{ color: '#52C41A' }} />甘蔗 Tutor 审查结果</Space>}
                  style={{ marginTop: 16 }}
                  extra={reviewOutput.passed
                    ? <Tag color="green">通过</Tag>
                    : <Tag color="orange">需关注</Tag>
                  }
                >
                  {reviewOutput.issues?.length > 0 && (
                    <div>
                      {reviewOutput.issues.map((issue: any, i: number) => (
                        <Alert
                          key={i}
                          type={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                          message={issue.description}
                          style={{ marginBottom: 8 }}
                          showIcon
                        />
                      ))}
                    </div>
                  )}
                  {reviewOutput.needsManualReview?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <strong>需人工复核：</strong>
                      <ul>
                        {reviewOutput.needsManualReview.map((item: string, i: number) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              )}

              {/* Action bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <Button onClick={() => setView('scan')}>放弃</Button>
                <Button onClick={() => window.learn.openExternal(
                  `https://learn.tsinghua.edu.cn/f/wlxt/homework/detail/${selectedHw?.homeworkId}`
                )}>
                  打开原网页对照
                </Button>
                {analyzed?.type === 'code' && (
                  <Button onClick={() => setCodeVerified(!codeVerified)}
                    type={codeVerified ? 'primary' : 'default'}
                    icon={codeVerified ? <CheckCircleOutlined /> : undefined}
                  >
                    {codeVerified ? '已确认运行验证' : '我已本地运行验证'}
                  </Button>
                )}
                <Button
                  type="primary"
                  danger
                  onClick={() => setSubmitModal(true)}
                  disabled={
                    checkPlaceholders(draft) ||
                    (analyzed?.type === 'code' && !codeVerified) ||
                    !draft.trim()
                  }
                >
                  提交...
                </Button>
              </div>

              {/* Submit confirmation modal */}
              <Modal
                title={<span style={{ color: '#CF1322' }}>确认提交</span>}
                open={submitModal}
                onOk={handleSubmit}
                onCancel={() => setSubmitModal(false)}
                okText="确认提交"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                className="submit-confirm-modal"
              >
                <div style={{ lineHeight: 1.8 }}>
                  <p className="submit-warning-text">
                    <ExclamationCircleOutlined style={{ marginRight: 6, fontSize: 18 }} />
                    你将以你的身份提交以下内容到 <strong>{selectedHw?.courseName}</strong> · <strong>{selectedHw?.title}</strong>。
                  </p>
                  <p style={{ color: '#666' }}>提交后无法撤回。请最后确认你已通读并对内容负责。</p>
                </div>
              </Modal>
            </>
          )}
        </div>
      )}

    </div>
  )
}
