import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useParams, useLocation } from 'react-router-dom'
import { Layout, Menu, Select, Button, Dropdown, theme, message, Alert } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import {
  BellOutlined,
  FolderOutlined,
  FileTextOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  FormOutlined,
  SettingOutlined,
  LogoutOutlined,
  RobotOutlined,
  SwapOutlined,
  DownloadOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import { useDownloadStore } from '../store/downloads'
import TsinghuaLogo from './TsinghuaLogo'

const { Sider, Header, Content } = Layout

interface SemesterOption {
  id: string
  name: string
}

interface UpdateNotice {
  type: 'info' | 'error'
  message: string
  description?: string
  releaseUrl?: string
}

const UPDATE_CHECK_STATE_KEY = 'learnpp:update-check'

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { courseId } = useParams()
  const { courses, setCourses, setSelectedCourse, semesters, currentSemester, setSemesters, reset } = useAuthStore()
  const [accountStore, setAccountStore] = useState<{ activeId?: string; accounts: any[] }>({ accounts: [] })
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null)
  const { token } = theme.useToken()
  const { downloads, addOrUpdate } = useDownloadStore()

  const pathParts = location.pathname.split('/')
  const currentTab = pathParts[3] || 'notifications'
  const selectedCourse = courses.find((c) => c.id === courseId)

  function isAuthErrorMessage(msg: string): boolean {
    const lower = msg.toLowerCase()
    return lower.includes('not logged in') || lower.includes('login timeout') || lower.includes('login')
  }

  function handleAuthError(msg: string): void {
    message.error(`登录已失效: ${msg}`)
    reset()
    navigate('/login')
  }

  function normalizeSemester(raw: any): SemesterOption {
    return {
      id: String(raw?.id || raw),
      name: String(raw?.name || raw),
    }
  }

  function uniqueSemesters(preferred: SemesterOption, list: SemesterOption[]): SemesterOption[] {
    const seen = new Set<string>()
    return [preferred, ...list].filter((semester) => {
      if (!semester.id || seen.has(semester.id)) return false
      seen.add(semester.id)
      return true
    })
  }

  useEffect(() => {
    loadCourses()
    loadAccounts()
    runAutoUpdateCheck()
  }, [])

  useEffect(() => {
    const unsub = window.learn.app.onResume(() => {
      runAutoUpdateCheck()
      queryClient.invalidateQueries()
      window.learn.auth.status().then((status) => {
        if (!status.loggedIn) {
          reset()
          navigate('/login')
          return
        }

        if (useAuthStore.getState().courses.length === 0) {
          loadCourses(false, true)
        }
      }).catch(() => {
        reset()
        navigate('/login')
      })
    })
    return () => { unsub() }
  }, [navigate, queryClient, reset])

  useEffect(() => {
    const unsub = window.learn.files.onProgress((data: any) => {
      addOrUpdate({
        id: data.id,
        fileName: data.fileName || '',
        loaded: data.loaded,
        total: data.total,
        status: data.status,
        destPath: data.destPath,
        time: Date.now(),
      })
    })
    return () => { unsub() }
  }, [addOrUpdate])

  async function loadCourses(forceFirstCourse = false, silent = false) {
    try {
      const result: any = await window.learn.course.listSemesters()
      if (result.error) {
        if (isAuthErrorMessage(result.error)) {
          handleAuthError(result.error)
          return
        }
        if (!silent) message.error(`加载课程失败: ${result.error}`)
        return
      }

      const semestersData = (result.semesters || []).map(normalizeSemester)
      const currentData = normalizeSemester(result.current || semestersData[0])
      const candidates = uniqueSemesters(currentData, semestersData)
      let loadedSemester = candidates[0] || currentData
      let coursesData: any[] = []
      let lastError = ''

      for (const candidate of candidates) {
        const coursesResult: any = await window.learn.course.listCourses(candidate.id)
        if (coursesResult?.error) {
          if (isAuthErrorMessage(coursesResult.error)) {
            handleAuthError(coursesResult.error)
            return
          }
          lastError = coursesResult.error
          continue
        }

        if (Array.isArray(coursesResult)) {
          loadedSemester = candidate
          coursesData = coursesResult
          if (coursesData.length > 0) break
        }
      }

      if (!coursesData.length && lastError && !silent) {
        message.error(`加载课程失败: ${lastError}`)
      }

      setSemesters(semestersData, loadedSemester)
      setCourses(coursesData)

      const currentCourseStillVisible = !!courseId && coursesData.some((c) => c.id === courseId)
      if (coursesData.length > 0 && (!courseId || forceFirstCourse || !currentCourseStillVisible)) {
        setSelectedCourse(coursesData[0].id)
        navigate(`/course/${coursesData[0].id}/notifications`, { replace: true })
      }
    } catch (err: any) {
      console.error('Failed to load courses:', err)
      const msg = err?.message || String(err)
      if (isAuthErrorMessage(msg)) {
        reset()
        navigate('/login')
      } else if (!silent) {
        message.error(`加载课程失败: ${msg}`)
      }
    }
  }

  async function loadAccounts() {
    try {
      const result = await window.learn.auth.listAccounts()
      setAccountStore(result)
    } catch {
      setAccountStore({ accounts: [] })
    }
  }

  async function handleLogout() {
    await window.learn.auth.logout()
    reset()
    navigate('/login')
  }

  async function refreshAfterAccountChange() {
    queryClient.clear()
    setCourses([])
    setSelectedCourse(null)
    await loadAccounts()
    await loadCourses(true)
  }

  async function handleGlobalRefresh() {
    message.loading({ key: 'global-refresh', content: '正在刷新...' })
    await loadAccounts()
    await loadCourses(false, true)
    await queryClient.invalidateQueries()
    message.success({ key: 'global-refresh', content: '已刷新' })
  }

  function todayKey(): string {
    return new Date().toISOString().slice(0, 10)
  }

  function readUpdateCheckState(): { date: string; failures: number } {
    try {
      const parsed = JSON.parse(localStorage.getItem(UPDATE_CHECK_STATE_KEY) || '{}')
      return {
        date: String(parsed.date || ''),
        failures: Number(parsed.failures || 0),
      }
    } catch {
      return { date: '', failures: 0 }
    }
  }

  function writeUpdateCheckState(state: { date: string; failures: number }): void {
    localStorage.setItem(UPDATE_CHECK_STATE_KEY, JSON.stringify(state))
  }

  async function runAutoUpdateCheck() {
    const today = todayKey()
    const state = readUpdateCheckState()
    if (state.date === today && state.failures >= 2) return

    const result = await window.learn.app.checkForUpdates()
    if (result.ok) {
      writeUpdateCheckState({ date: today, failures: 0 })
      if (result.hasUpdate && result.latestVersion) {
        setUpdateNotice({
          type: 'info',
          message: `发现新版本 v${result.latestVersion}`,
          description: `当前版本 v${result.currentVersion}，可前往 GitHub Releases 下载更新。`,
          releaseUrl: result.releaseUrl,
        })
      }
      return
    }

    const failures = state.date === today ? state.failures + 1 : 1
    writeUpdateCheckState({ date: today, failures })
    setUpdateNotice({
      type: 'error',
      message: '检测更新失败',
      description: failures >= 2
        ? `今天已连续 2 次检测失败，将暂时停止自动检测。${result.error || ''}`
        : result.error || '请稍后重试。',
    })
  }

  async function handleAddAccount() {
    const result = await window.learn.auth.addAccountBrowser('https://learn.tsinghua.edu.cn/')
    if (!result.ok) {
      message.error(result.error || '添加账号失败')
      return
    }
    message.success(`已添加并切换到账号: ${result.account?.name || '新账号'}`)
    await refreshAfterAccountChange()
  }

  async function handleSwitchAccount(id: string) {
    if (id === accountStore.activeId) return
    const result = await window.learn.auth.switchAccount(id)
    if (!result.ok) {
      message.error(result.error || '切换账号失败')
      return
    }
    message.success(`已切换到账号: ${result.account?.name || '已保存账号'}`)
    await refreshAfterAccountChange()
  }

  async function handleSemesterChange(value: string) {
    const selected = semesters.find((s) => s.id === value)
    if (selected) {
      setSemesters(semesters, selected)
    }

    const coursesData: any = await window.learn.course.listCourses(value)
    if (coursesData?.error) {
      if (isAuthErrorMessage(coursesData.error)) {
        handleAuthError(coursesData.error)
        return
      }
      message.error(`加载课程失败: ${coursesData.error}`)
      return
    }

    setCourses(coursesData)
    if (coursesData.length > 0) {
      setSelectedCourse(coursesData[0].id)
      navigate(`/course/${coursesData[0].id}/notifications`)
    }
  }

  function handleCourseSelect(nextCourseId: string) {
    setSelectedCourse(nextCourseId)
    navigate(`/course/${nextCourseId}/${currentTab}`)
  }

  const tabs = [
    { key: 'notifications', label: '公告', icon: <BellOutlined /> },
    { key: 'files', label: '课件', icon: <FolderOutlined /> },
    { key: 'homework', label: '作业', icon: <FileTextOutlined /> },
    { key: 'discussion', label: '讨论', icon: <MessageOutlined /> },
    { key: 'answering', label: '答疑', icon: <QuestionCircleOutlined /> },
    { key: 'questionnaire', label: '问卷', icon: <FormOutlined /> },
  ]

  const activeDownloadCount = downloads.filter((d) => d.status === 'downloading').length

  const userMenu = [
    { key: 'settings', label: '设置', icon: <SettingOutlined /> },
    { key: 'about', label: '关于 learn++', icon: <InfoCircleOutlined /> },
    { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true },
  ]

  const accountMenu = [
    ...accountStore.accounts.map((account) => ({
      key: `account:${account.id}`,
      label: (
        <div style={{ minWidth: 170 }}>
          <div style={{ fontWeight: account.id === accountStore.activeId ? 600 : 400 }}>
            {account.name}
          </div>
          {account.department && (
            <div style={{ color: '#999', fontSize: 12 }}>{account.department}</div>
          )}
        </div>
      ),
      icon: account.id === accountStore.activeId ? <CheckCircleOutlined /> : <SwapOutlined />,
      disabled: account.id === accountStore.activeId,
    })),
    accountStore.accounts.length ? { type: 'divider' as const } : null,
    { key: 'add-account', label: '添加账号', icon: <UserAddOutlined /> },
    { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true },
  ].filter(Boolean) as any[]

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={240}
        collapsedWidth={0}
        breakpoint="lg"
        style={{
          borderRight: '1px solid #f0f0f0',
          overflow: 'auto',
        }}
      >
        <Dropdown
          trigger={['click']}
          menu={{
            items: accountMenu,
            onClick: ({ key }) => {
              if (String(key).startsWith('account:')) handleSwitchAccount(String(key).slice('account:'.length))
              if (key === 'add-account') handleAddAccount()
              if (key === 'logout') handleLogout()
            },
          }}
        >
          <button className="sidebar-logo" type="button">
            <span className="sidebar-logo-icon-wrap">
              <TsinghuaLogo size={42} />
              <span className="sidebar-logo-swap">
                <SwapOutlined />
              </span>
            </span>
            <span className="sidebar-logo-text">learn++</span>
          </button>
        </Dropdown>

        {semesters.length > 0 && (
          <div style={{ padding: '8px 16px' }}>
            <Select
              value={currentSemester?.id}
              onChange={handleSemesterChange}
              size="small"
              style={{ width: '100%' }}
              options={semesters.map((s) => ({ value: s.id, label: s.name }))}
              prefix={<SwapOutlined />}
            />
          </div>
        )}

        <Menu
          mode="inline"
          className="sidebar-course-menu"
          selectedKeys={[courseId || '']}
          onClick={({ key }) => handleCourseSelect(key)}
          items={courses.map((c) => ({
            key: c.id,
            label: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                <span style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                }}>{c.name}</span>
                {c.teacher && (
                  <span style={{ fontSize: 11, color: '#999', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {c.teacher}
                  </span>
                )}
              </div>
            ),
          }))}
          style={{ borderRight: 0, marginTop: 4 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            height: 56,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#660874' }}>
              {selectedCourse?.name || 'learn++'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button type="text" icon={<ReloadOutlined />} onClick={handleGlobalRefresh}>
              刷新
            </Button>
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => navigate('/downloads')}
              style={{ position: 'relative' }}
            >
              下载
              {activeDownloadCount > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  background: '#1890FF', color: '#fff', borderRadius: '50%',
                  width: 16, height: 16, fontSize: 10, lineHeight: '16px', textAlign: 'center',
                }}>
                  {activeDownloadCount}
                </span>
              )}
            </Button>
            <Button
              icon={<RobotOutlined />}
              onClick={() => navigate(`/course/${courseId || courses[0]?.id}/homework/auto`)}
              style={{
                color: '#237804',
                background: '#F6FFED',
                borderColor: '#B7EB8F',
                fontWeight: 600,
              }}
            >
              甘蔗 tutor
            </Button>
            <Dropdown
              menu={{
                items: userMenu,
                onClick: ({ key }) => {
                  if (key === 'logout') handleLogout()
                  if (key === 'settings') navigate('/settings')
                  if (key === 'about') navigate('/about')
                },
              }}
            >
              <Button type="text" icon={<SettingOutlined />} />
            </Dropdown>
          </div>
        </Header>

        <div style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          padding: '0 24px',
          height: 44,
          alignItems: 'center',
          gap: 0,
        }}>
          {tabs.map((tab) => {
            const active = currentTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => navigate(`/course/${courseId || courses[0]?.id}/${tab.key}`)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                  color: active ? token.colorPrimary : '#666',
                  padding: '10px 16px',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ marginRight: 6 }}>{tab.icon}</span>
                {tab.label}
              </button>
            )
          })}
        </div>

        <Content style={{ padding: 24, overflow: 'auto', flex: 1 }}>
          <Outlet />
        </Content>
      </Layout>
      {updateNotice && (
        <Alert
          type={updateNotice.type}
          showIcon
          closable
          message={updateNotice.message}
          description={updateNotice.description}
          onClose={() => setUpdateNotice(null)}
          action={updateNotice.releaseUrl ? (
            <Button size="small" type="link" onClick={() => window.learn.openExternal(updateNotice.releaseUrl!)}>
              查看更新
            </Button>
          ) : undefined}
          style={{
            position: 'fixed',
            left: 260,
            right: 24,
            bottom: 18,
            zIndex: 1000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        />
      )}
    </Layout>
  )
}
