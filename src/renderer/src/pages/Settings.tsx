import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Select, Button, Switch, Space, Divider, message, Popconfirm, Tag, Alert, Typography } from 'antd'
import { CalendarOutlined, FolderOpenOutlined, LoginOutlined, LogoutOutlined, KeyOutlined, RobotOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from '../../../shared/aiProviders'

const { Text } = Typography

export default function SettingsPage() {
  const navigate = useNavigate()
  const { reset, semesters, currentSemester, setSemesters, setCourses, setSelectedCourse } = useAuthStore()
  const [form] = Form.useForm()
  const [settings, setSettings] = useState<any>({})
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [localSemesters, setLocalSemesters] = useState<{ id: string; name: string }[]>([])
  const [selectedSemesterId, setSelectedSemesterId] = useState('')

  useEffect(() => {
    window.learn.course.listSemesters().then((r: any) => {
      setLocalSemesters(r.semesters || [])
      // Prefer persisted lastSemesterId, fall back to current semester from API
      const savedId = settings.lastSemesterId
      if (savedId && (r.semesters || []).some((s: any) => s.id === savedId)) {
        setSelectedSemesterId(savedId)
      } else {
        setSelectedSemesterId(r.current?.id || '')
      }
    })
  }, [settings.lastSemesterId])
  const selectedProvider = Form.useWatch('aiProvider', form) || settings.aiProvider || 'anthropic'
  const providerPreset = getAiProviderPreset(selectedProvider)
  const modelOptions = providerPreset.models

  async function refreshProviderKeyState(provider: string) {
    const hasKey = await window.learn.settings.hasApiKey(provider)
    setSettings((s: any) => ({ ...s, hasApiKey: hasKey }))
  }

  useEffect(() => {
    window.learn.settings.getAll().then((loaded) => {
      setSettings(loaded)
      form.setFieldsValue({
        mailImapHost: 'mails.tsinghua.edu.cn',
        mailImapPort: 993,
        mailImapTls: true,
        mailSmtpHost: 'mails.tsinghua.edu.cn',
        mailSmtpPort: 465,
        mailSmtpTls: true,
        ...loaded,
        mailMode: 'imap',
      })
    })
  }, [form])

  async function handleSave(values: any) {
    setLoading(true)
    try {
      const updated = await window.learn.settings.set({ ...values, mailMode: 'imap' })
      setSettings((s: any) => ({ ...s, ...updated }))
      await refreshProviderKeyState(values.aiProvider || selectedProvider)
      message.success('设置已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectDownloadDir() {
    const dir = await window.learn.files.selectDirectory()
    if (dir) {
      await window.learn.settings.set({ downloadDir: dir })
      setSettings((s: any) => ({ ...s, downloadDir: dir }))
      message.success(`下载目录已改为: ${dir}`)
    }
  }

  async function handleSetApiKey() {
    if (!apiKeyInput.trim()) return
    await window.learn.settings.setApiKey(apiKeyInput, selectedProvider)
    setApiKeyInput('')
    setSettings((s: any) => ({ ...s, hasApiKey: true }))
    message.success(`${providerPreset.label} API Key 已加密保存`)
  }

  async function handleProviderChange(provider: string) {
    const preset = getAiProviderPreset(provider)
    form.setFieldsValue({
      aiProvider: provider,
      aiModel: preset.defaultModel,
      aiBaseUrl: provider === 'custom' ? settings.aiBaseUrl || '' : '',
      aiApiFormat: preset.apiFormat,
    })
    await refreshProviderKeyState(provider)
  }

  async function handleLogout() {
    await window.learn.auth.logout()
    reset()
    navigate('/login')
  }

  const [mailPasswordInput, setMailPasswordInput] = useState('')

  async function handleSaveMailPassword() {
    if (!mailPasswordInput.trim()) return
    await window.learn.settings.setApiKey(mailPasswordInput, 'mail')
    setMailPasswordInput('')
    message.success('邮箱密码已加密保存')
  }

  async function handleTestMailConnection() {
    const values = form.getFieldsValue()
    if (!values.mailUsername || !values.mailImapHost) {
      message.error('请先填写邮箱账号和 IMAP 服务器')
      return
    }
    message.loading({ key: 'mail-test', content: '正在测试连接...' })
    const ok = await window.learn.mail.testConnection({
      imapHost: values.mailImapHost || 'mails.tsinghua.edu.cn',
      imapPort: values.mailImapPort || 993,
      imapTls: values.mailImapTls !== false,
      smtpHost: values.mailSmtpHost || values.mailImapHost || 'mails.tsinghua.edu.cn',
      smtpPort: values.mailSmtpPort || 465,
      smtpTls: values.mailSmtpTls !== false,
      username: values.mailUsername,
      password: mailPasswordInput,
    })
    message.destroy('mail-test')
    if (ok) message.success('连接成功！IMAP 服务器可达')
    else message.error('连接失败，请检查服务器地址、端口和密码')
  }

  async function handleLoginImap() {
    const values = form.getFieldsValue()
    if (!values.mailUsername) { message.error('请填写邮箱账号'); return }
    message.loading({ key: 'mail-imap', content: '正在连接...' })
    await window.learn.settings.set({
      ...values,
      mailMode: 'imap',
      mailImapPort: Number(values.mailImapPort || 993),
      mailSmtpPort: Number(values.mailSmtpPort || 465),
      mailImapTls: values.mailImapTls !== false,
      mailSmtpTls: values.mailSmtpTls !== false,
    })
    if (mailPasswordInput.trim()) {
      await window.learn.settings.setApiKey(mailPasswordInput, 'mail')
    }
    const ok = await window.learn.mail.loginImap({
      imapHost: values.mailImapHost || 'mails.tsinghua.edu.cn',
      imapPort: values.mailImapPort || 993,
      imapTls: values.mailImapTls !== false,
      smtpHost: values.mailSmtpHost || values.mailImapHost || 'mails.tsinghua.edu.cn',
      smtpPort: values.mailSmtpPort || 465,
      smtpTls: values.mailSmtpTls !== false,
      username: values.mailUsername,
      password: mailPasswordInput,
    })
    message.destroy('mail-imap')
    if (ok) message.success('邮箱已连接')
    else message.error('连接失败')
  }

  async function handleResetRisk() {
    await window.learn.settings.set({ aiAutoCompleteAcknowledged: false })
    message.success('甘蔗 tutor 承诺书已重置')
  }

  async function handleSemesterChange(value: string) {
    setSelectedSemesterId(value)
    await window.learn.settings.set({ lastSemesterId: value })

    const selected = semesters.find((s) => s.id === value)
    if (selected) setSemesters(semesters, selected)

    const coursesData: any = await window.learn.course.listCourses(value)
    if (coursesData?.error) {
      message.error(`加载课程失败: ${coursesData.error}`)
      return
    }

    setCourses(coursesData)
    setSelectedCourse(coursesData[0]?.id || null)
    message.success('学期已切换')
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>设置</h2>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={settings}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <Card title="系统设置" size="small">
          <Form.Item name="launchAtStartup" label="开机自启动" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 13 }}>
            开机自启动会默认在后台运行，可从 Windows 右下角托盘图标打开或退出。
          </div>
        </Card>

        <Card title={<Space><CalendarOutlined /> 学期设置</Space>} size="small">
          <Form.Item label="当前学期" style={{ marginBottom: 8 }}>
            <Select
              value={selectedSemesterId || currentSemester?.id}
              onChange={handleSemesterChange}
              placeholder="选择学期"
              style={{ maxWidth: 320 }}
              options={(localSemesters.length ? localSemesters : semesters).map((s) => ({ value: s.id, label: s.name }))}
            />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 13 }}>
            学期切换会重新加载左侧课程列表。
          </div>
        </Card>

        <Card title="下载设置" size="small">
          <Form.Item label="课件与附件下载目录" style={{ marginBottom: 8 }}>
            <Space>
              <span style={{ color: '#666', fontSize: 13 }}>{settings.downloadDir || '(默认)'}</span>
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectDownloadDir} size="small">
                更改目录
              </Button>
            </Space>
          </Form.Item>
        </Card>

        <Card
          title={<Space><LoginOutlined /> 邮箱配置</Space>}
          size="small"
        >
          <Alert
            type="info"
            showIcon
            message="邮箱功能现在仅使用 IMAP/SMTP。网页登录抓取已隐藏，以避免页面结构导致的显示错乱。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="mailMode" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="mailImapHost" label="IMAP 服务器">
            <Input placeholder="mails.tsinghua.edu.cn" />
          </Form.Item>
          <Form.Item label="IMAP 端口 / 加密">
            <Space>
              <Form.Item name="mailImapPort" noStyle><Input placeholder="993" style={{ width: 100 }} /></Form.Item>
              <Form.Item name="mailImapTls" noStyle valuePropName="checked"><Switch checkedChildren="SSL" unCheckedChildren="无" /></Form.Item>
            </Space>
          </Form.Item>
          <Form.Item name="mailSmtpHost" label="SMTP 服务器">
            <Input placeholder="mails.tsinghua.edu.cn" />
          </Form.Item>
          <Form.Item label="SMTP 端口 / 加密">
            <Space>
              <Form.Item name="mailSmtpPort" noStyle><Input placeholder="465" style={{ width: 100 }} /></Form.Item>
              <Form.Item name="mailSmtpTls" noStyle valuePropName="checked"><Switch checkedChildren="SSL" unCheckedChildren="STARTTLS" /></Form.Item>
            </Space>
          </Form.Item>
          <Form.Item name="mailUsername" label="邮箱账号">
            <Input placeholder="username@mails.tsinghua.edu.cn" />
          </Form.Item>
          <Form.Item label="密码 / 专用密码">
            <Space>
              <Input.Password
                placeholder="两步验证用户请使用客户端专用密码"
                value={mailPasswordInput}
                onChange={(e) => setMailPasswordInput(e.target.value)}
                style={{ width: 280 }}
              />
              <Button onClick={handleSaveMailPassword}>保存密码</Button>
            </Space>
          </Form.Item>
          <Form.Item>
            <Button onClick={handleTestMailConnection}>测试连接</Button>
            <Button type="primary" onClick={handleLoginImap} style={{ marginLeft: 8 }}>登录邮箱</Button>
          </Form.Item>
        </Card>

        <Card
          title={<Space><RobotOutlined /> 甘蔗 tutor 配置</Space>}
          size="small"
        >
          <Alert
            type="success"
            showIcon
            message="甘蔗 tutor 是全栈式 AI 辅助学习助手"
            description="每个服务商单独保存 API Key。预设服务通常只需选择模型并填写 Key，自定义接口才需要填写 Endpoint。"
            style={{ marginBottom: 16 }}
          />

          <Form.Item name="aiProvider" label="模型服务">
            <Select
              onChange={handleProviderChange}
              options={AI_PROVIDER_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
            />
          </Form.Item>

          <Form.Item name="aiModel" label="模型">
            {selectedProvider === 'custom' ? (
              <Input placeholder="输入模型名，例如 gpt-4o-mini / claude-sonnet-4-6" />
            ) : (
              <Select
                showSearch
                placeholder="选择模型"
                options={modelOptions}
              />
            )}
          </Form.Item>

          {selectedProvider === 'custom' ? (
            <>
              <Form.Item name="aiApiFormat" label="接口格式">
                <Select
                  options={[
                    { value: 'openai', label: 'OpenAI 兼容 /v1/chat/completions' },
                    { value: 'anthropic', label: 'Anthropic /v1/messages' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="aiBaseUrl" label="自定义 Endpoint">
                <Input placeholder="https://api.example.com/v1 或完整 chat/completions 地址" />
              </Form.Item>
            </>
          ) : (
            <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
              <div>接口格式：{providerPreset.apiFormat === 'anthropic' ? 'Anthropic Messages' : 'OpenAI 兼容'}</div>
              <div style={{ wordBreak: 'break-all' }}>Endpoint：{providerPreset.endpoint}</div>
            </div>
          )}

          <Form.Item name="tutorStyle" label="甘蔗 Tutor 风格">
            <Select
              options={[
                { value: 'cute', label: '可爱风 — 正太语气，俏皮活泼' },
                { value: 'serious', label: '正经风 — 专业学术助手，简洁直接' },
              ]}
            />
          </Form.Item>

          {providerPreset.note && (
            <Alert type="info" showIcon message={providerPreset.note} style={{ marginBottom: 16 }} />
          )}

          <Form.Item label={`${providerPreset.label} API Key`}>
            <Space wrap>
              <Input.Password
                placeholder={settings.hasApiKey ? '已配置，输入新 Key 可替换' : '输入 API Key'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={{ width: 320 }}
              />
              <Button icon={<KeyOutlined />} onClick={handleSetApiKey}>保存 Key</Button>
              {settings.hasApiKey ? (
                <Tag color="green">当前服务已保存 Key</Tag>
              ) : (
                <Text type="secondary">当前服务未保存 Key</Text>
              )}
            </Space>
          </Form.Item>
        </Card>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            保存设置
          </Button>
        </Form.Item>
      </Form>

      <Divider />

      <Card title="风险操作" size="small">
        <Space direction="vertical" size={12}>
          <Popconfirm
            title="确定要退出登录吗？下次需要重新登录。"
            onConfirm={handleLogout}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<LogoutOutlined />}>退出登录</Button>
          </Popconfirm>

          <Popconfirm
            title="重置后，下次使用甘蔗 tutor 自动完成作业功能时需要重新确认学术诚信承诺书。"
            onConfirm={handleResetRisk}
            okText="确定"
            cancelText="取消"
          >
            <Button>重置甘蔗 tutor 承诺书</Button>
          </Popconfirm>
        </Space>
      </Card>
    </div>
  )
}
