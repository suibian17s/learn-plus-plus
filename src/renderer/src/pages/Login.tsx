import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, message } from 'antd'
import { ChromeOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import TsinghuaLogo from '../components/TsinghuaLogo'

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

  return (
    <div className="login-gradient">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <TsinghuaLogo size={56} />
          <h1 style={{ marginTop: 16, fontSize: 24, fontWeight: 700, color: '#660874' }}>learn++</h1>
          <p style={{ color: '#888', marginTop: 4, fontSize: 14 }}>
            清华网络学堂桌面客户端
          </p>
        </div>

        <Button
          type="primary"
          icon={<ChromeOutlined />}
          loading={browserLoading}
          onClick={handleBrowserLogin}
          block
          size="large"
          style={{ height: 48, fontSize: 16, fontWeight: 500, marginBottom: 16 }}
        >
          通过清华网络学堂官方页面登录
        </Button>

        <p style={{ textAlign: 'center', color: '#999', fontSize: 12, marginBottom: 0, lineHeight: 1.7 }}>
          支持 WebVPN、校园网直连及二级验证。登录成功后会保存为账号档案，可在左上角 logo 中切换。
        </p>

        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 28 }}>
          将通过清华网络学堂官方认证页面完成登录
        </div>
      </div>
    </div>
  )
}
