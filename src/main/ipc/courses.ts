import { ipcMain } from 'electron'
import { withAuth } from '../services/learn'
import { formatError } from '../utils/errors'
import { indexCourses } from '../services/search-index'
import { CourseType } from 'thu-learn-lib'

/**
 * Convert semester IDs like "2024-2025-2" into readable Chinese names.
 * Format: YYYY-YYYY-N where N=1 (秋季), N=2 (春季), N=3 (夏季).
 */
function formatSemester(id: string): string {
  const m = id.match(/^(\d{4}-\d{4})-(\d)$/)
  if (m) {
    const terms: Record<string, string> = { '1': '秋季学期', '2': '春季学期', '3': '夏季学期' }
    return `${m[1]} ${terms[m[2]] || ''}`
  }
  return id
}

export function registerCoursesIpc(): void {
  ipcMain.handle('course:semesters', async () => {
    try {
      return await withAuth(async (h) => {
        const semesters = await h.getSemesterIdList()
        const current = await h.getCurrentSemester()
        return {
          semesters: semesters.map((id: string) => ({ id, name: formatSemester(id) })),
          current: { id: String(current.id), name: formatSemester(String(current.id)) },
        }
      })
    } catch (err) {
      return { error: formatError(err) }
    }
  })

  ipcMain.handle('course:list', async (_e, semesterId: string) => {
    try {
      return await withAuth(async (h) => {
        const courses = await h.getCourseList(semesterId, CourseType.STUDENT)
        const mapped = courses.map((c) => ({
          id: c.id,
          name: c.chineseName || c.name,
          teacher: c.teacherName || '',
          semester: semesterId,
        }))
        // Feed courses into the global search index
        if (mapped.length > 0) {
          indexCourses(mapped.map((c) => ({ id: c.id, name: c.name, teacher: c.teacher })))
        }
        return mapped
      })
    } catch (err) {
      return { error: formatError(err) }
    }
  })
}
