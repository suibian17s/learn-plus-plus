import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { useAiStore } from './store/ai'
import AppShell from './components/AppShell'
import LoginPage from './pages/Login'
import Dashboard from './pages/Dashboard'
import MailboxPage from './pages/Mailbox'
import TutorPage from './pages/Tutor'
import NotificationsPage from './pages/Notifications'
import FilesPage from './pages/Files'
import HomeworkPage from './pages/Homework'
import HomeworkDetailPage from './pages/HomeworkDetail'
import HomeworkAutoComplete from './pages/HomeworkAutoComplete'
import DiscussionPage from './pages/Discussion'
import DiscussionDetailPage from './pages/DiscussionDetail'
import AnsweringPage from './pages/Answering'
import AnsweringDetailPage from './pages/AnsweringDetail'
import QuestionnairePage from './pages/Questionnaire'
import SettingsPage from './pages/Settings'
import DownloadsPage from './pages/Downloads'
import AboutPage from './pages/About'
import AllTasksPage from './pages/AllTasks'
import AllCoursesPage from './pages/AllCourses'
import AllUpdatesPage from './pages/AllUpdates'

export default function App() {
  const { loggedIn, loading, setLoggedIn, setLoading } = useAuthStore()
  const { setRiskAcknowledged } = useAiStore()

  useEffect(() => {
    // Check login status and auto-login on mount
    async function init() {
      try {
        // Listen for auto-login result from main process
        const unsub = window.learn.onAutoLoginResult((autoLoggedIn: boolean) => {
          setLoggedIn(autoLoggedIn)
          setLoading(false)
        })

        // Also check risk acknowledgement
        window.learn.hwai.hasAcknowledgedRisk().then((ack: boolean) => {
          setRiskAcknowledged(ack)
        })

        // Fallback: check status after timeout
        setTimeout(() => {
          if (useAuthStore.getState().loading) {
            window.learn.auth.status().then((s) => {
              setLoggedIn(s.loggedIn)
              setLoading(false)
            })
          }
        }, 3000)

        return () => unsub()
      } catch {
        setLoading(false)
      }
    }
    init()
  }, [])

  if (loading) return null

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={loggedIn ? <Navigate to="/" /> : <LoginPage />} />
        <Route path="/" element={loggedIn ? <AppShell /> : <Navigate to="/login" />}>
          <Route index element={<Dashboard />} />
          <Route path="mailbox" element={<MailboxPage />} />
          <Route path="tutor" element={<TutorPage />} />
          <Route path="course/:courseId/notifications" element={<NotificationsPage />} />
          <Route path="course/:courseId/files" element={<FilesPage />} />
          <Route path="course/:courseId/homework" element={<HomeworkPage />} />
          <Route path="course/:courseId/homework/detail/:homeworkId" element={<HomeworkDetailPage />} />
          <Route path="course/:courseId/homework/auto" element={<HomeworkAutoComplete />} />
          <Route path="course/:courseId/discussion" element={<DiscussionPage />} />
          <Route path="course/:courseId/discussion/detail/:discussionId" element={<DiscussionDetailPage />} />
          <Route path="course/:courseId/answering" element={<AnsweringPage />} />
          <Route path="course/:courseId/answering/detail/:questionId" element={<AnsweringDetailPage />} />
          <Route path="course/:courseId/questionnaire" element={<QuestionnairePage />} />
          <Route path="course/:courseId/tutor" element={<TutorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="all-tasks" element={<AllTasksPage />} />
          <Route path="all-courses" element={<AllCoursesPage />} />
          <Route path="all-updates" element={<AllUpdatesPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
