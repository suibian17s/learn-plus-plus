import { ipcMain } from 'electron'
import { computeDashboard } from '../services/stats'
import { query, indexItems } from '../services/search-index'

export function registerStatsIpc(): void {
  ipcMain.handle('stats:computeDashboard', async (_e, payload: {
    courses: { id: string; name: string; teacher: string }[]
    homeworksByCourse: Record<string, any[]>
    noticesByCourse: Record<string, any[]>
    discussionsByCourse: Record<string, any[]>
  }) => {
    const homeworksMap = new Map(Object.entries(payload.homeworksByCourse))
    const noticesMap = new Map(Object.entries(payload.noticesByCourse))
    const discussionsMap = new Map(Object.entries(payload.discussionsByCourse))
    return computeDashboard(payload.courses, homeworksMap, noticesMap, discussionsMap)
  })

  ipcMain.handle('search:query', async (_e, q: string, typeFilter?: string) => {
    return query(q, typeFilter)
  })

  ipcMain.handle('search:indexItems', async (_e, type: string, items: any[], targetTab: string) => {
    indexItems(type as any, items, targetTab)
    return { ok: true }
  })
}
