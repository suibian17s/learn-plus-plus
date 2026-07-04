import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { computeDashboard } from '../services/stats'
import { query, indexItems } from '../services/search-index'
import { withAuth } from '../services/learn'

// ── Shared helper: feed fetched data into the global search index ──
function feedSearchIndex(
  courses: { id: string; name: string; teacher: string }[],
  homeworksByCourse: Record<string, any[]>,
  noticesByCourse: Record<string, any[]>,
  discussionsByCourse: Record<string, any[]>,
): void {
  const courseMap = new Map(courses.map((c) => [c.id, c]))

  const allHomeworks: { id: string; title: string; courseName?: string; courseId?: string }[] = []
  for (const [courseId, hws] of Object.entries(homeworksByCourse || {})) {
    if (!Array.isArray(hws)) continue
    const course = courseMap.get(courseId)
    for (const hw of hws) {
      allHomeworks.push({ id: hw.studentHomeworkId || hw.id, title: hw.title || '', courseName: course?.name, courseId })
    }
  }
  if (allHomeworks.length > 0) indexItems('homework', allHomeworks, 'homework')

  const allNotices: { id: string; title: string; courseName?: string; courseId?: string }[] = []
  for (const [courseId, notices] of Object.entries(noticesByCourse || {})) {
    if (!Array.isArray(notices)) continue
    const course = courseMap.get(courseId)
    for (const n of notices) {
      allNotices.push({ id: n.id, title: n.title || '', courseName: course?.name, courseId })
    }
  }
  if (allNotices.length > 0) indexItems('notice', allNotices, 'notifications')

  const allDiscussions: { id: string; title: string; courseName?: string; courseId?: string }[] = []
  for (const [courseId, dcs] of Object.entries(discussionsByCourse || {})) {
    if (!Array.isArray(dcs)) continue
    const course = courseMap.get(courseId)
    for (const d of dcs) {
      allDiscussions.push({ id: d.id, title: d.title || '', courseName: course?.name, courseId })
    }
  }
  if (allDiscussions.length > 0) indexItems('discussion', allDiscussions, 'discussion')
}

// ── Dashboard cache for stats:refreshDashboard (B14 fix) ──
// SWR：内存 + 磁盘双层缓存。新鲜(<5min)直接返回；过期先返回旧数据、后台刷新完成后
// 通过 'stats:updated' 事件推给 renderer —— 首页任何时候都秒开。
let dashboardCache: { key: string; ts: number; data: any } | null = null
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const dashboardCacheFile = () => path.join(app.getPath('userData'), 'dashboard-cache.json')
let refreshInFlight: Promise<any> | null = null

function loadDashboardCacheFromDisk(): void {
  if (dashboardCache) return
  try {
    const raw = JSON.parse(fs.readFileSync(dashboardCacheFile(), 'utf-8'))
    if (raw && raw.key && raw.data) dashboardCache = raw
  } catch { /* no disk cache yet */ }
}

function saveDashboardCacheToDisk(): void {
  try {
    fs.writeFileSync(dashboardCacheFile(), JSON.stringify(dashboardCache))
  } catch { /* ignore */ }
}

export function registerStatsIpc(): void {
  // Existing handler — renderer sends pre-fetched data
  ipcMain.handle('stats:computeDashboard', async (_e, payload: {
    courses: { id: string; name: string; teacher: string }[]
    homeworksByCourse: Record<string, any[]>
    noticesByCourse: Record<string, any[]>
    discussionsByCourse: Record<string, any[]>
  }) => {
    const homeworksMap = new Map(Object.entries(payload.homeworksByCourse))
    const noticesMap = new Map(Object.entries(payload.noticesByCourse))
    const discussionsMap = new Map(Object.entries(payload.discussionsByCourse))

    feedSearchIndex(payload.courses, payload.homeworksByCourse, payload.noticesByCourse, payload.discussionsByCourse)

    return computeDashboard(payload.courses, homeworksMap, noticesMap, discussionsMap)
  })

  // B14 fix: Main-process fetch — renderer calls this once instead of N*3 serial calls
  ipcMain.handle('stats:refreshDashboard', async (event, payload: {
    courses: { id: string; name: string; teacher: string }[]
  }) => {
    const { courses } = payload
    const cacheKey = courses.map((c) => c.id).sort().join(',')
    const now = Date.now()
    loadDashboardCacheFromDisk()

    const doFullRefresh = async () => {
      if (refreshInFlight) return refreshInFlight
      refreshInFlight = withAuth(async (h) => {
        const homeworksMap = new Map<string, any[]>()
        const noticesMap = new Map<string, any[]>()
        const discussionsMap = new Map<string, any[]>()

        // Build tasks: 3 per course (homework, notices, discussions)
        const tasks: Array<() => Promise<void>> = []
        for (const c of courses) {
          tasks.push(async () => {
            try { homeworksMap.set(c.id, await h.getHomeworkList(c.id)) } catch { homeworksMap.set(c.id, []) }
          })
          tasks.push(async () => {
            try { noticesMap.set(c.id, await h.getNotificationList(c.id)) } catch { noticesMap.set(c.id, []) }
          })
          tasks.push(async () => {
            try { discussionsMap.set(c.id, await h.getDiscussionList(c.id)) } catch { discussionsMap.set(c.id, []) }
          })
        }

        // Execute with concurrency limit of 5 to avoid server throttle
        const limit = 5
        for (let i = 0; i < tasks.length; i += limit) {
          await Promise.all(tasks.slice(i, i + limit).map((fn) => fn()))
        }

        const result = computeDashboard(courses, homeworksMap, noticesMap, discussionsMap)

        dashboardCache = { key: cacheKey, ts: Date.now(), data: result }
        saveDashboardCacheToDisk()

        // Feed search index (benefits A1: index is now populated from dashboard data)
        const hwObj: Record<string, any[]> = {}
        const noticeObj: Record<string, any[]> = {}
        const discObj: Record<string, any[]> = {}
        for (const c of courses) {
          hwObj[c.id] = homeworksMap.get(c.id) || []
          noticeObj[c.id] = noticesMap.get(c.id) || []
          discObj[c.id] = discussionsMap.get(c.id) || []
        }
        feedSearchIndex(courses, hwObj, noticeObj, discObj)

        return result
      }).finally(() => { refreshInFlight = null })
      return refreshInFlight
    }

    // 新鲜缓存：直接返回
    if (dashboardCache && dashboardCache.key === cacheKey && (now - dashboardCache.ts) < DASHBOARD_CACHE_TTL) {
      return dashboardCache.data
    }

    // 过期缓存（含跨重启的磁盘缓存）：先返回旧数据秒开，后台刷新完推事件
    if (dashboardCache && dashboardCache.key === cacheKey) {
      const sender = event.sender
      doFullRefresh().then((fresh) => {
        if (!sender.isDestroyed()) sender.send('stats:updated', fresh)
      }).catch(() => { /* 后台刷新失败保持旧数据 */ })
      return dashboardCache.data
    }

    // 无缓存（真正的首次运行 / 课程列表变化）：只能等全量
    return doFullRefresh()
  })

  ipcMain.handle('search:query', async (_e, q: string, typeFilter?: string) => {
    return query(q, typeFilter)
  })

  ipcMain.handle('search:indexItems', async (_e, type: string, items: any[], targetTab: string) => {
    indexItems(type as any, items, targetTab)
    return { ok: true }
  })
}
