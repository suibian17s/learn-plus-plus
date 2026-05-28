import fs from 'fs'
import { statsFile } from '../utils/paths'
import type { StatsSnapshot, StatsDailyRecord, CourseProgressItem, RecentUpdateItem, TodayFocusItem } from '../types'

let dailyMinutes: Record<string, number> = {}
let lastActiveDate = ''
let loginDays: string[] = []
let activeSince: number | null = null

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
  const key = todayKey()
  dailyMinutes[key] = (dailyMinutes[key] || 0) + elapsed
  lastActiveDate = key
  if (!loginDays.includes(key)) loginDays.push(key)
  activeSince += elapsed * 60000
}

export function stopTracking(): void {
  accrueActiveTime()
  activeSince = null
  saveDailyRecords()
}

export function pauseTracking(): void {
  // Background time counts as learning time, so hiding the window must not pause tracking.
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

  // Course progress (homework only)
  const courseProgress: CourseProgressItem[] = courses.map((c) => {
    const hws = homeworksByCourse.get(c.id) || []
    if (hws.length === 0) {
      // 无作业课程视为 100%，展示优先级低
      return { courseId: c.id, courseName: c.name, done: 0, total: 0, percent: 100 }
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

  const completedCourses = courseProgress.filter((cp) => cp.percent === 100).length

  // Today focus: homework only, sorted by deadline urgency.
  const now = new Date()
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const threeDaysLater = new Date(todayEnd.getTime() + 3 * 86400000)

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
      if (dl <= todayEnd) {
        item.priority = 'P0'
        item.tag = '今天截止'
        p0Items.push(item)
      } else if (dl <= threeDaysLater) {
        item.priority = 'P1'
        item.tag = '即将截止'
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

  return {
    todayMinutes: dailyMinutes[todayKey()] || 0,
    streakDays: computeStreakDays(),
    completedCourses,
    totalCourses: courses.length,
    weeklyMinutes: computeWeeklyMinutes(),
    todayFocus: [...p0Items, ...p1Items, ...p2Items],
    courseProgress,
    recentUpdates: updates.sort((a, b) =>
      new Date(b.time).getTime() - new Date(a.time).getTime()
    ).slice(0, 10),
  }
}
