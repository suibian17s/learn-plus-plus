import fs from 'fs'
import { statsFile } from '../utils/paths'
import type { StatsSnapshot, StatsDailyRecord, CourseProgressItem, RecentUpdateItem, TodayFocusItem } from '../types'

let dailyMinutes: Record<string, number> = {}
let lastActiveDate = ''
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
  } catch {
    dailyMinutes = {}
    lastActiveDate = ''
  }
}

function saveDailyRecords(): void {
  const data: StatsDailyRecord = { dailyMinutes, lastActiveDate }
  fs.writeFileSync(statsFile, JSON.stringify(data, null, 2))
}

export function startTracking(): void {
  loadDailyRecords()
  activeSince = Date.now()
}

export function stopTracking(): void {
  if (activeSince == null) return
  const elapsed = Math.round((Date.now() - activeSince) / 60000)
  activeSince = null
  if (elapsed < 1) return
  const key = todayKey()
  dailyMinutes[key] = (dailyMinutes[key] || 0) + elapsed
  lastActiveDate = key
  saveDailyRecords()
}

export function pauseTracking(): void {
  if (activeSince == null) return
  const elapsed = Math.round((Date.now() - activeSince) / 60000)
  if (elapsed < 1) return
  const key = todayKey()
  dailyMinutes[key] = (dailyMinutes[key] || 0) + elapsed
  lastActiveDate = key
  activeSince = null
  saveDailyRecords()
}

export function resumeTracking(): void {
  loadDailyRecords()
  activeSince = Date.now()
}

function computeStreakDays(): number {
  let streak = 0
  const d = new Date()
  for (let i = 0; i < 365; i++) {
    const key = d.toISOString().slice(0, 10)
    if ((dailyMinutes[key] || 0) >= 30) {
      streak++
      d.setDate(d.getDate() - 1)
    } else if (key === todayKey()) {
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
  discussionsByCourse: Map<string, any[]>,
): StatsSnapshot {
  loadDailyRecords()

  // Course progress (homework only)
  const courseProgress: CourseProgressItem[] = courses.map((c) => {
    const hws = homeworksByCourse.get(c.id) || []
    const done = hws.filter((h: any) =>
      h.status === '已提交' || h.status === '已批阅' || h.submitted === true
    ).length
    const total = hws.length || 1
    return { courseId: c.id, courseName: c.name, done, total, percent: Math.round((done / total) * 100) }
  })

  const completedCourses = courseProgress.filter((cp) => cp.percent === 100).length

  // Today focus - three tiers
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
      }
    }
  }

  // P2: recent notices and discussions (last 3 days)
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000)
  for (const c of courses) {
    const notices = noticesByCourse.get(c.id) || []
    for (const n of notices) {
      const pt = new Date(n.publishTime)
      if (!isNaN(pt.getTime()) && pt >= threeDaysAgo) {
        p2Items.push({
          priority: 'P2', courseName: c.name, courseId: c.id,
          title: n.title, tag: '新公告',
          targetTab: 'notifications', targetId: n.id,
        })
      }
    }
    const discs = discussionsByCourse.get(c.id) || []
    for (const d of discs) {
      const pt = new Date(d.publishTime)
      if (!isNaN(pt.getTime()) && pt >= threeDaysAgo) {
        p2Items.push({
          priority: 'P2', courseName: c.name, courseId: c.id,
          title: d.title, tag: '新讨论',
          targetTab: 'discussion', targetId: d.id,
        })
      }
    }
  }

  // Recent updates
  const updates: RecentUpdateItem[] = []
  for (const c of courses) {
    const notices = noticesByCourse.get(c.id) || []
    const hws = homeworksByCourse.get(c.id) || []
    if (notices.length) {
      const latest = notices.reduce((a: any, b: any) =>
        new Date(a.publishTime) > new Date(b.publishTime) ? a : b
      )
      updates.push({
        courseId: c.id, courseName: c.name,
        text: `新增公告：${latest.title}`, time: latest.publishTime, kind: 'notice',
      })
    }
    if (hws.length) {
      const latest = hws.reduce((a: any, b: any) =>
        new Date(a.deadline || 0) > new Date(b.deadline || 0) ? a : b
      )
      updates.push({
        courseId: c.id, courseName: c.name,
        text: `作业：${latest.title}`, time: latest.deadline || '', kind: 'homework',
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
