import { useEffect, useState } from 'react'
import { Button, Card, Descriptions, Divider, message, Space, Tag, Typography } from 'antd'
import {
  GithubOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import TsinghuaLogo from '../components/TsinghuaLogo'

const { Title, Paragraph, Text, Link } = Typography
const GITHUB_URL = 'https://github.com/suibian17s/learn-plus-plus'

interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
}

export default function AboutPage() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.learn.app.info().then(setInfo).catch(() => {})
  }, [])

  async function handleCheckUpdates() {
    setChecking(true)
    try {
      const result = await window.learn.app.checkForUpdates()
      if (!result.ok) {
        message.error(`检测更新失败: ${result.error || '请稍后重试'}`)
        return
      }

      if (result.hasUpdate && result.latestVersion) {
        message.info(`发现新版本 v${result.latestVersion}`)
        if (result.releaseUrl) {
          await window.learn.openExternal(result.releaseUrl)
        }
        return
      }

      message.success(`当前已是最新版本 v${result.currentVersion}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24 }}>
          <TsinghuaLogo size={88} />
          <div>
            <Title level={2} style={{ margin: 0, color: '#660874' }}>learn++</Title>
            <Paragraph style={{ margin: '8px 0 0', color: '#666', fontSize: 15 }}>
              面向清华网络学堂的第三方桌面客户端，让公告、课件、作业、讨论与 AI 学习辅助回到一个安静顺手的工作台。
            </Paragraph>
            <Space style={{ marginTop: 12 }} wrap>
              <Tag color="purple">v{info?.version || '1.1.1'}</Tag>
              <Tag color="green">Windows x64</Tag>
              <Tag color="blue">Electron</Tag>
              <Tag color="cyan">React</Tag>
            </Space>
          </div>
        </div>

        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="版本号">v{info?.version || '1.1.1'}</Descriptions.Item>
          <Descriptions.Item label="许可证">MIT License</Descriptions.Item>
          <Descriptions.Item label="项目性质">第三方非官方客户端</Descriptions.Item>
          <Descriptions.Item label="开发工具">Claude Code、Codex</Descriptions.Item>
          <Descriptions.Item label="运行平台">
            {info ? `${info.platform} ${info.arch}` : 'Windows x64'}
          </Descriptions.Item>
          <Descriptions.Item label="Electron">v{info?.electron || '-'}</Descriptions.Item>
          <Descriptions.Item label="Chromium">v{info?.chrome || '-'}</Descriptions.Item>
          <Descriptions.Item label="Node.js">v{info?.node || '-'}</Descriptions.Item>
          <Descriptions.Item label="技术栈">Electron / React / TypeScript / Ant Design</Descriptions.Item>
          <Descriptions.Item label="GitHub" span={2}>
            <Space wrap>
              <Link href={GITHUB_URL} onClick={(e) => {
                e.preventDefault()
                window.learn.openExternal(GITHUB_URL)
              }}>
                {GITHUB_URL}
              </Link>
              <Button size="small" icon={<GithubOutlined />} onClick={() => window.learn.openExternal(GITHUB_URL)}>
                打开项目
              </Button>
              <Button size="small" icon={<SyncOutlined />} loading={checking} onClick={handleCheckUpdates}>
                手动检测更新
              </Button>
            </Space>
          </Descriptions.Item>
        </Descriptions>

        <Divider />

        <Title level={4}><RocketOutlined /> 功能介绍</Title>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            ['课程工作台', '自动加载学期课程，集中查看公告、课件、作业、讨论、答疑和问卷。'],
            ['下载管理', '保留原始文件格式，记录下载历史，支持课件、作业附件和公告附件。'],
            ['作业提交', '支持查看要求、老师留言、附件、提交记录、批阅结果，并可在截止前修改。'],
            ['多账号', '通过清华网络学堂官方页面登录，可保存多个账号并在左上角切换。'],
            ['后台常驻', '关闭窗口后进入后台，托盘图标可打开或退出，支持开机静默启动。'],
            ['甘蔗 tutor', '提供公告总结、课件总结、讨论总结、作业答疑和测试型作业辅助。'],
          ].map(([title, desc]) => (
            <div key={title} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 14, background: '#fafafa' }}>
              <Text strong>{title}</Text>
              <div style={{ color: '#666', fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>{desc}</div>
            </div>
          ))}
        </div>

        <Divider />

        <Title level={4}><ToolOutlined /> 技术栈</Title>
        <Space wrap>
          {['Electron 31', 'React 18', 'TypeScript 5', 'Ant Design 5', 'TanStack Query', 'Zustand', 'electron-builder', 'thu-learn-lib'].map((item) => (
            <Tag key={item}>{item}</Tag>
          ))}
        </Space>

        <Divider />

        <Title level={4}><SafetyCertificateOutlined /> 免责声明</Title>
        <Paragraph style={{ color: '#666', lineHeight: 1.8 }}>
          learn++ 是面向个人学习效率的第三方桌面客户端，不代表清华大学或清华网络学堂官方立场。
          使用本程序访问网络学堂时，请遵守学校相关规定、课程要求和学术诚信规范。
          甘蔗 tutor 生成内容仅供学习参考与测试验证，真实作业、讨论和提交内容应由用户自行审阅、修改并承担责任。
        </Paragraph>
      </Card>
    </div>
  )
}
