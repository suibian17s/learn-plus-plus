import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, Badge, Button, Dropdown, Input, Layout, message, Select, Tooltip } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import {
  BellOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOutlined,
  FormOutlined,
  HomeOutlined,
  LogoutOutlined,
  MailOutlined,
  MessageOutlined,
  MoreOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  StarOutlined,
  SwapOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import { useDownloadStore } from '../store/downloads'
import TsinghuaLogo from './TsinghuaLogo'
import WindowControls from './WindowControls'
import CourseIcon from './CourseIcon'

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
  const {
    courses,
    selectedCourseId,
    setCourses,
    setSelectedCourse,
    currentSemester,
    setSemesters,
    reset,
    bumpStatsVersion,
  } = useAuthStore()
  const [accountStore, setAccountStore] = useState<{ activeId?: string; accounts: any[] }>({ accounts: [] })
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null)
  const { downloads, addOrUpdate } = useDownloadStore()
  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [showResults, setShowResults] = useState(false)
  const [mailSubOpen, setMailSubOpen] = useState(false)

  const pathParts = location.pathname.split('/')
  const isCourseRoute = location.pathname.startsWith('/course/')
  const isHomeRoute = location.pathname === '/'
  const isMailboxRoute = location.pathname.startsWith('/mailbox')
  const currentTab = isCourseRoute ? pathParts[3] || 'files' : ''
  const isTutorRoute = location.pathname.startsWith('/tutor') || currentTab === 'tutor'
  const selectedCourse = courses.find((course) => course.id === courseId)
    || courses.find((course) => course.id === selectedCourseId)
    || courses[0]
  const primaryCourseId = courseId || selectedCourse?.id || courses[0]?.id
  const activeDownloadCount = downloads.filter((download) => download.status === 'downloading').length
  const topbarMode = isHomeRoute
    ? 'home'
    : isTutorRoute
      ? 'tutor'
      : isCourseRoute
        ? 'course'
        : isMailboxRoute
          ? 'mail'
          : 'context'

  const globalNav = [
    { key: 'home', label: '首页', path: '/', icon: <HomeOutlined /> },
    { key: 'mailbox', label: '邮箱', path: '/mailbox', icon: <MailOutlined /> },
    { key: 'tutor', label: '甘蔗 Tutor', path: '/tutor', icon: <RobotOutlined />, tutor: true },
  ]

  const tabs = [
    { key: 'notifications', label: '公告', icon: <BellOutlined /> },
    { key: 'files', label: '课件', icon: <FolderOutlined /> },
    { key: 'homework', label: '作业', icon: <FileTextOutlined /> },
    { key: 'discussion', label: '讨论', icon: <MessageOutlined /> },
    { key: 'questionnaire', label: '问卷', icon: <FormOutlined /> },
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
            <div style={{ color: '#9CA3AF', fontSize: 12 }}>{account.department}</div>
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

  async function loadCourses(forceFirstCourse = false, silent = false) {
    if (!silent) message.loading({ key: 'load-courses', content: '正在加载课程...', duration: 0 })
    try {
      const result: any = await window.learn.course.listSemesters()
      if (result.error) {
        if (isAuthErrorMessage(result.error)) {
          handleAuthError(result.error)
          message.destroy('load-courses')
          return
        }
        if (!silent) message.error({ key: 'load-courses', content: `课程加载失败: ${result.error}` })
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
            message.destroy('load-courses')
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
        message.error({ key: 'load-courses', content: `课程加载失败: ${lastError}` })
      }

      setSemesters(semestersData, loadedSemester)
      // Stable sort by name to prevent order shuffling on refresh
      coursesData.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'))
      setCourses(coursesData)

      const firstCourseId = coursesData[0]?.id
      const currentCourseStillVisible = !!courseId && coursesData.some((course) => course.id === courseId)
      if (firstCourseId && (!selectedCourseId || !coursesData.some((course) => course.id === selectedCourseId))) {
        setSelectedCourse(firstCourseId)
      }
      if (firstCourseId && (forceFirstCourse || (courseId && !currentCourseStillVisible))) {
        navigate(`/course/${firstCourseId}/files`, { replace: !forceFirstCourse })
      }

      if (!silent) message.destroy('load-courses')
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (isAuthErrorMessage(msg)) {
        reset()
        navigate('/login')
        message.destroy('load-courses')
      } else if (!silent) {
        message.error({ key: 'load-courses', content: `课程加载失败: ${msg}` })
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
    bumpStatsVersion()
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

  function handleCourseSelect(nextCourseId: string) {
    setSelectedCourse(nextCourseId)
    const nextTab = isCourseRoute && tabs.some((tab) => tab.key === currentTab) ? currentTab : 'files'
    navigate(`/course/${nextCourseId}/${nextTab}`)
  }

  async function handleSearch(value: string) {
    setSearchValue(value)
    if (!value.trim()) { setSearchResults([]); setShowResults(false); return }
    const results = await window.learn.search.query(value)
    setSearchResults(results)
    setShowResults(true)
  }

  function handleResultClick(result: any) {
    setShowResults(false)
    setSearchValue('')
    if (result.courseId) {
      navigate(`/course/${result.courseId}/${result.targetTab || 'notifications'}`)
    } else if (result.targetTab === 'mailbox') {
      navigate('/mailbox')
    }
  }

  function updateMailQuery(patch: Record<string, string>) {
    const params = new URLSearchParams(location.search)
    const folder = params.get('folder') || 'inbox'
    params.set('folder', folder)
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    navigate(`/mailbox?${params.toString()}`)
  }

  function renderTopbar() {
    if (isHomeRoute) {
      return (
        <>
          <div className="lp2-search-wrapper">
            <Input
              className="lp2-search lp2-home-search"
              prefix={<SearchOutlined />}
              placeholder="搜索课程、作业、资料、邮件、公告..."
              value={searchValue}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowResults(true) }}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
              allowClear
            />
            {showResults && (
              <div className="search-results-dropdown">
                {searchResults.length === 0 ? (
                  <div className="search-empty">无结果</div>
                ) : (
                  searchResults.map((r, i) => (
                    <div key={i} className="search-result-item" onMouseDown={() => handleResultClick(r)}>
                      <span className="search-result-type">{r.type}</span>
                      <span className="search-result-title">{r.title}</span>
                      <span className="search-result-sub">{r.subtitle}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="lp2-top-actions">
            <Tooltip title="刷新">
              <Button type="text" icon={<ReloadOutlined />} onClick={handleGlobalRefresh} />
            </Tooltip>
            <Badge count={activeDownloadCount} size="small">
              <Button icon={<DownloadOutlined />} onClick={() => navigate('/downloads')}>
                下载管理
              </Button>
            </Badge>
            <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
              设置
            </Button>
          </div>
        </>
      )
    }

    if (isTutorRoute) {
      return (
        <div className="lp2-context-head lp2-tutor-context-head">
          <RobotOutlined className="lp2-tutor-leaf-icon" />
          <div>
            <h1>甘蔗 Tutor</h1>
            <p>你的 AI 学习助手</p>
          </div>
          <span className="lp2-online-pill"><CheckCircleOutlined /> 在线</span>
        </div>
      )
    }

    if (isCourseRoute && selectedCourse) {
      return (
        <div className="lp2-context-head lp2-course-context-head">
          <div className="lp2-context-title">
            <h1>{selectedCourse.name}</h1>
            <p>{selectedCourse.teacher || '课程教师'} · {currentSemester?.name || '当前学期'}</p>
          </div>
          <div className="lp2-context-stats lp2-context-stats-placeholder" aria-hidden="true" />
          <nav className="lp2-course-tabs" aria-label="课程标签">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`lp2-course-tab${currentTab === tab.key ? ' active' : ''}`}
                type="button"
                onClick={() => navigate(`/course/${primaryCourseId}/${tab.key}`)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )
    }

    if (isMailboxRoute) {
      const params = new URLSearchParams(location.search)
      return (
        <div className="lp2-context-head lp2-mail-context-head">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索邮件"
            allowClear
            value={params.get('q') || ''}
            onChange={(e) => updateMailQuery({ q: e.target.value })}
          />
          <Select
            value={params.get('filter') || 'all'}
            onChange={(value) => updateMailQuery({ filter: value })}
            options={[{ value: 'all', label: '全部' }, { value: 'unread', label: '未读' }, { value: 'starred', label: '星标' }]}
          />
          <Select
            value={params.get('sort') || 'time'}
            onChange={(value) => updateMailQuery({ sort: value })}
            options={[{ value: 'time', label: '时间排序' }, { value: 'star', label: '星标优先' }]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => updateMailQuery({ refresh: String(Date.now()) })} />
          <Button icon={<StarOutlined />} onClick={() => updateMailQuery({ filter: 'starred' })} />
          <Button icon={<MoreOutlined />} onClick={() => window.learn.mail.show()} />
        </div>
      )
    }

    return <div className="lp2-context-head" />
  }

  return (
    <Layout className="lp2-shell">
      <WindowControls />
      <Sider width={284} collapsedWidth={0} breakpoint="lg" className="lp2-sidebar">
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
          <button className="lp2-brand" type="button">
            <TsinghuaLogo size={42} />
            <span>Learn++</span>
            <SwapOutlined className="lp2-brand-swap" />
          </button>
        </Dropdown>

        <nav className="lp2-primary-nav" aria-label="主导航">
          {globalNav.map((item) => {
            const active = item.path === '/'
              ? location.pathname === '/'
              : item.key === 'tutor'
                ? (location.pathname.startsWith(item.path) || currentTab === 'tutor')
                : item.key === 'mailbox'
                  ? (location.pathname.startsWith(item.path) && !mailSubOpen)
                  : location.pathname.startsWith(item.path)

            if (item.key === 'mailbox') {
              const isMailActive = location.pathname.startsWith('/mailbox')
              return (
                <div key="mailbox" className="lp2-mail-nav-group">
                  <button
                    className={`lp2-nav-item${isMailActive ? ' active' : ''}`}
                    type="button"
                    onClick={() => {
                      if (mailSubOpen) {
                        setMailSubOpen(false)
                      } else {
                        setMailSubOpen(true)
                        navigate('/mailbox?folder=inbox')
                      }
                    }}
                  >
                    <span className="lp2-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                  <div className={`mail-submenu${mailSubOpen ? ' open' : ''}`}>
                    {([
                      { key: 'inbox', label: '收件箱' },
                      { key: 'drafts', label: '草稿箱' },
                      { key: 'sent', label: '已发送' },
                      { key: 'trash', label: '已删除' },
                    ] as const).map((folder) => {
                      const params = new URLSearchParams(location.search)
                      const activeFolder = location.pathname.startsWith('/mailbox') && params.get('folder') === folder.key
                      return (
                        <button
                          key={folder.key}
                          className={`mail-submenu-item${activeFolder ? ' active' : ''}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/mailbox?folder=${folder.key}`)
                          }}
                        >
                          {folder.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }

            return (
              <button
                key={item.key}
                className={`lp2-nav-item${active ? ' active' : ''}${item.tutor ? ' tutor' : ''}`}
                type="button"
                onClick={() => {
                  if (item.key === 'mailbox') return
                  navigate(item.path)
                }}
              >
                <span className="lp2-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="lp2-course-section">
          <div className="lp2-section-label">我的课程</div>
          <div className="lp2-course-list">
            {courses.map((course) => {
              const active = isCourseRoute && course.id === courseId
              return (
                <button
                  key={course.id}
                  className={`lp2-course-item${active ? ' active' : ''}`}
                  type="button"
                  onClick={() => handleCourseSelect(course.id)}
                >
                  <CourseIcon courseName={course.name} size="sm" />
                  <span className="lp2-course-copy">
                    <span className="lp2-course-name">{course.name}</span>
                    <span className="lp2-course-meta">{course.teacher || '课程教师'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Sider>

      <Layout className="lp2-main">
        <Header className={`lp2-topbar ${topbarMode}`}>
          {renderTopbar()}
        </Header>

        <Content className="lp2-content">
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
          className="lp2-update-alert"
        />
      )}
    </Layout>
  )
}
