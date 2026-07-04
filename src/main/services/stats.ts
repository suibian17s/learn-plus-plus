import fs from 'fs'
import { powerMonitor } from 'electron'
import { statsFile } from '../utils/paths'
import type { StatsSnapshot, StatsDailyRecord, CourseProgressItem, RecentUpdateItem, TodayFocusItem } from '../types'
import { getFocusItems, convertToTodayFocus } from './focus-store'

let dailyMinutes: Record<string, number> = {}
let lastActiveDate = ''
let loginDays: string[] = []
let activeSince: number | null = null

// ── Idle / visibility tracking (B12 fix: real active time, not uptime) ──
let windowVisible = true
let windowHiddenSince: number | null = null
const IDLE_THRESHOLD_MS = 5 * 60 * 1000    // 5 minutes of no input = not studying
const HIDDEN_GRACE_MS = 30 * 60 * 1000      // 30 minutes hidden = not studying

export function setWindowVisible(visible: boolean): void {
  windowVisible = visible
  if (visible) {
    windowHiddenSince = null
  } else {
    windowHiddenSince = Date.now()
  }
}

function isUserActive(): boolean {
  // System idle check: if no keyboard/mouse input for >5 min, user is away
  try {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds * 1000 > IDLE_THRESHOLD_MS) return false
  } catch {
    // powerMonitor not available (unlikely in Electron, but guard)
  }

  // Window hidden check: if hidden >30 min, user is probably not studying
  if (!windowVisible && windowHiddenSince != null) {
    const hiddenDuration = Date.now() - windowHiddenSince
    if (hiddenDuration > HIDDEN_GRACE_MS) return false
  }

  return true
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadDailyRecords(): void {
  try {
    const raw = fs.readFileSync(statsFile, 'utf-8')
    const data: StatsDailyRecord = JSON.parse(raw)
    dailyMinutes = data.dailyMinutes || {}
    lastActiveDate = data.lastActiveDate || ''
    loginDays = Array.isArray(data.loginDays) ? data.loginDays : Object.keys(dailyMinutes)
  } catch {
    dailyMinutes = {}
    lastActiveDate = ''
    loginDays = []
  }
}

function saveDailyRecords(): void {
  const data: StatsDailyRecord = { dailyMinutes, lastActiveDate, loginDays: [...new Set(loginDays)].sort() }
  fs.writeFileSync(statsFile, JSON.stringify(data, null, 2))
}

export function startTracking(): void {
  loadDailyRecords()
  const key = todayKey()
  if (!loginDays.includes(key)) loginDays.push(key)
  lastActiveDate = key
  if (activeSince == null) activeSince = Date.now()
  saveDailyRecords()
}

function accrueActiveTime(): void {
  if (activeSince == null) return
  const now = Date.now()
  const elapsed = Math.floor((now - activeSince) / 60000)
  if (elapsed < 1) return

  if (isUserActive()) {
    const key = todayKey()
    dailyMinutes[key] = (dailyMinutes[key] || 0) + elapsed
    lastActiveDate = key
    if (!loginDays.includes(key)) loginDays.push(key)
  }
  // Always advance the start point — inactive time is simply not counted
  activeSince = now
}

export function stopTracking(): void {
  accrueActiveTime()
  activeSince = null
  saveDailyRecords()
}

export function pauseTracking(): void {
  accrueActiveTime()
  saveDailyRecords()
}

export function resumeTracking(): void {
  loadDailyRecords()
  if (activeSince == null) activeSince = Date.now()
}

function normalizeTime(raw: any): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return String(raw)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}:${sec}`
}

function computeStreakDays(): number {
  let streak = 0
  const d = new Date()
  const days = new Set(loginDays.length ? loginDays : Object.keys(dailyMinutes))
  for (let i = 0; i < 365; i++) {
    const key = d.toISOString().slice(0, 10)
    if (days.has(key)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

function computeWeeklyMinutes(): number {
  let total = 0
  const d = new Date()
  for (let i = 0; i < 7; i++) {
    const key = d.toISOString().slice(0, 10)
    total += dailyMinutes[key] || 0
    d.setDate(d.getDate() - 1)
  }
  return total
}

export function computeDashboard(
  courses: { id: string; name: string; teacher: string }[],
  homeworksByCourse: Map<string, any[]>,
  noticesByCourse: Map<string, any[]>,
  _discussionsByCourse: Map<string, any[]>,
): StatsSnapshot {
  loadDailyRecords()
  accrueActiveTime()
  saveDailyRecords()

  // Course progress (homework only).
  // B12 fix: courses with no homework get percent = -1 instead of 100.
  const courseProgress: CourseProgressItem[] = courses.map((c) => {
    const hws = homeworksByCourse.get(c.id) || []
    if (hws.length === 0) {
      return { courseId: c.id, courseName: c.name, done: 0, total: 0, percent: -1 }
    }
    const done = hws.filter((h: any) =>
      h.status === '已提交' || h.status === '已批阅' || h.submitted === true
    ).length
    const total = hws.length
    return { courseId: c.id, courseName: c.name, done, total, percent: Math.round((done / total) * 100) }
  })

  // Sort: courses with homework first (by name), then no-homework courses (by name)
  courseProgress.sort((a, b) => {
    const aHasHw = a.total > 0
    const bHasHw = b.total > 0
    if (aHasHw && !bHasHw) return -1
    if (!aHasHw && bHasHw) return 1
    return a.courseName.localeCompare(b.courseName, 'zh')
  })

  // B12 fix: completedCourses only counts courses that have homework AND are complete
  const completedCourses = courseProgress.filter((cp) => cp.percent === 100 && cp.total > 0).length
  const coursesWithHomework = courseProgress.filter((cp) => cp.total > 0).length

  // Today focus: homework only, sorted by deadline urgency.
  const now = new Date()
  const urgentMs = now.getTime() + 1 * 86400000
  const soonMs = now.getTime() + 3 * 86400000

  const p0Items: TodayFocusItem[] = []
  const p1Items: TodayFocusItem[] = []
  const p2Items: TodayFocusItem[] = []

  for (const c of courses) {
    const hws = homeworksByCourse.get(c.id) || []
    for (const hw of hws) {
      if (hw.status === '已提交' || hw.status === '已批阅') continue
      const dl = new Date(hw.deadline)
      if (isNaN(dl.getTime())) continue
      // 已过截止时间的作业不再列入今日重点
      if (dl < now) continue
      const item: TodayFocusItem = {
        priority: 'P0',
        courseName: c.name,
        courseId: c.id,
        title: hw.title,
        tag: '',
        deadline: hw.deadline,
        targetTab: 'homework',
        targetId: hw.studentHomeworkId || hw.id,
      }
      if (dl.getTime() <= urgentMs) {
        item.priority = 'P0'
        item.tag = '1天内截止'
        p0Items.push(item)
      } else if (dl.getTime() <= soonMs) {
        item.priority = 'P1'
        item.tag = '3天内截止'
        p1Items.push(item)
      } else {
        item.priority = 'P2'
        item.tag = '待完成'
        p2Items.push(item)
      }
    }
  }

  const sortByDeadline = (a: TodayFocusItem, b: TodayFocusItem) =>
    new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()
  p0Items.sort(sortByDeadline)
  p1Items.sort(sortByDeadline)
  p2Items.sort(sortByDeadline)

  // Recent updates
  const updates: RecentUpdateItem[] = []
  for (const c of courses) {
    const notices = noticesByCourse.get(c.id) || []
    const hws = homeworksByCourse.get(c.id) || []
    for (const notice of notices) {
      if (!notice.publishTime) continue
      updates.push({
        courseId: c.id, courseName: c.name,
        text: `新增公告：${notice.title}`, time: normalizeTime(notice.publishTime), kind: 'notice',
      })
    }
    for (const hw of hws) {
      const bestTime = hw.publishTime || hw.startTime || hw.createTime || ''
      if (!bestTime) continue
      updates.push({
        courseId: c.id, courseName: c.name,
        text: `作业：${hw.title}`, time: normalizeTime(bestTime), kind: 'homework',
      })
    }
  }

  const manualItems = convertToTodayFocus(getFocusItems())

  return {
    todayMinutes: dailyMinutes[todayKey()] || 0,
    streakDays: computeStreakDays(),
    completedCourses,
    totalCourses: courses.length,
    coursesWithHomework,
    weeklyMinutes: computeWeeklyMinutes(),
    todayFocus: [...manualItems, ...p0Items, ...p1Items, ...p2Items],
    courseProgress,
    // 返回 100 条供"全部记录"页复用同一份快照；首页卡片自行截取前 10 条
    recentUpdates: updates.sort((a, b) =>
      new Date(b.time).getTime() - new Date(a.time).getTime()
    ).slice(0, 100),
  }
}

// ── B12 fix: exported stats function for the Tutor agent get_stats tool ──
// Avoids the duplicate implementation in ipc/ai.ts
export function getStatsForAI(): {
  todayMinutes: number
  todayHours: string
  totalActiveDays: number
  streak: number
  lastActiveDate: string
} {
  loadDailyRecords()
  accrueActiveTime()
  saveDailyRecords()
  const today = todayKey()
  return {
    todayMinutes: dailyMinutes[today] || 0,
    todayHours: ((dailyMinutes[today] || 0) / 60).toFixed(1),
    totalActiveDays: Object.keys(dailyMinutes).length,
    streak: computeStreakDays(),
    lastActiveDate: lastActiveDate || today,
  }
}
