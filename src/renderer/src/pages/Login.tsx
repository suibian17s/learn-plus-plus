import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, message } from 'antd'
import {
  ArrowRightOutlined,
  FileDoneOutlined,
  MessageOutlined,
  PieChartOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import TsinghuaLogo from '../components/TsinghuaLogo'
import WindowControls from '../components/WindowControls'
import loginHeroIcon from '../assets/login-hero-icon.png'

const LOGIN_URL = 'https://learn.tsinghua.edu.cn/'

export default function LoginPage() {
  const [browserLoading, setBrowserLoading] = useState(false)
  const { setLoggedIn } = useAuthStore()
  const navigate = useNavigate()

  async function handleBrowserLogin() {
    setBrowserLoading(true)
    try {
      const result = await window.learn.auth.loginBrowser(LOGIN_URL)
      if (result.ok) {
        setLoggedIn(true)
        navigate('/')
        message.success('登录成功')
      } else {
        message.error(result.error || '登录失败')
      }
    } catch {
      message.error('登录失败，请检查网络连接')
    } finally {
      setBrowserLoading(false)
    }
  }

  const features = [
    { icon: <RobotOutlined />, title: '甘蔗 Tutor', desc: '全栈式 AI 辅助学习' },
    { icon: <PieChartOutlined />, title: '全局学习管理', desc: '一目了然，掌握学习进度' },
    { icon: <MessageOutlined />, title: '高效与成长', desc: '智能规划学习，让成长更有温度' },
    { icon: <FileDoneOutlined />, title: '一键自动完成作业', desc: '高效完成任务，节省学习时间' },
  ]

  return (
    <div className="login-v2">
      <WindowControls quitOnClose />
      <main className="login-v2-frame">
        <section className="login-v2-brand-panel">
          <div className="login-v2-title">
            <TsinghuaLogo size={76} />
            <div>
              <h1>
                <span className="login-v2-product">Learn++</span>
                <span className="login-v2-version">2.0</span>
                <span className="login-v2-ai-badge">全面融合 AI</span>
              </h1>
              <p>你的清华网络学堂 <span className="login-v2-client-word">桌面客户端</span></p>
            </div>
          </div>

          <div className="login-v2-feature-list">
            {features.map((feature) => (
              <div className={`login-v2-feature${feature.title === '甘蔗 Tutor' ? ' tutor' : ''}`} key={feature.title}>
                <span>{feature.icon}</span>
                <div>
                  <strong>{feature.title}</strong>
                  <small>{feature.desc}</small>
                </div>
              </div>
            ))}
          </div>

          <p className="login-v2-risk">
            学术诚信风险提示：请合理使用，确保遵守学术诚信规范，避免违规行为。
          </p>

          <div className="login-v2-campus" aria-hidden="true">
            <span className="login-v2-gate" />
            <span className="login-v2-hill one" />
            <span className="login-v2-hill two" />
          </div>
        </section>

        <section className="login-v2-card">
          <img className="login-v2-hero-icon" src={loginHeroIcon} alt="" aria-hidden="true" />
          <h2>欢迎使用 Learn++ <span>2.0</span></h2>
          <p>为保障账户安全，请使用清华大学统一身份认证登录</p>

          <Button
            type="primary"
            loading={browserLoading}
            onClick={handleBrowserLogin}
            block
            size="large"
            className="login-v2-button"
          >
            前往清华大学统一认证登录
            <ArrowRightOutlined />
          </Button>

          <div className="login-v2-safe">
            <SafetyCertificateOutlined />
            校园网内外均可登录
          </div>

          <div className="login-v2-terms">
            登录即代表你已同意清华大学网络学堂《用户协议》和《隐私政策》
          </div>
        </section>
      </main>
    </div>
  )
}
