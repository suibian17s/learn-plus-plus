interface SearchEntry {
  type: 'course' | 'homework' | 'file' | 'notice' | 'discussion' | 'email'
  title: string
  subtitle: string
  courseId?: string
  courseName?: string
  targetTab?: string
  targetId?: string
  keywords: string[]
}

const index: Map<string, SearchEntry[]> = new Map()

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^一-龥a-z0-9]/g, ' ')
  const tokens: string[] = []
  const chinese = cleaned.replace(/\s/g, '')
  for (let i = 0; i < chinese.length; i++) {
    tokens.push(chinese.slice(i, i + 1))
    if (i + 1 < chinese.length) tokens.push(chinese.slice(i, i + 2))
  }
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1)
  tokens.push(...words)
  return [...new Set(tokens)]
}

/** Remove all entries of a given type from the inverted index (no full clear). */
function clearType(type: string): void {
  for (const [token, entries] of index) {
    const filtered = entries.filter((e) => e.type !== type)
    if (filtered.length === 0) {
      index.delete(token)
    } else {
      index.set(token, filtered)
    }
  }
}

function buildInvertedIndex(entries: SearchEntry[]): void {
  for (const entry of entries) {
    const tokens = tokenize(entry.title + ' ' + entry.subtitle)
    for (const token of tokens) {
      const existing = index.get(token) || []
      existing.push(entry)
      index.set(token, existing)
    }
  }
}

export function indexCourses(courses: { id: string; name: string; teacher: string }[]): void {
  clearType('course')
  const entries: SearchEntry[] = courses.map((c) => ({
    type: 'course', title: c.name, subtitle: c.teacher,
    courseId: c.id, courseName: c.name, targetTab: 'notifications',
    keywords: tokenize(c.name + ' ' + c.teacher),
  }))
  buildInvertedIndex(entries)
}

export function indexItems(
  type: SearchEntry['type'],
  items: { id: string; title: string; courseName?: string; courseId?: string }[],
  targetTab: string,
): void {
  clearType(type)
  const entries: SearchEntry[] = items.map((item) => ({
    type,
    title: item.title || '',
    subtitle: item.courseName || '',
    courseId: item.courseId,
    courseName: item.courseName,
    targetTab,
    targetId: item.id,
    keywords: tokenize((item.title || '') + ' ' + (item.courseName || '')),
  }))
  buildInvertedIndex(entries)
}

export function indexEmails(
  emails: { id: string; subject: string; from: string; preview?: string }[],
): void {
  clearType('email')
  const entries: SearchEntry[] = emails.map((e) => ({
    type: 'email',
    title: e.subject,
    subtitle: e.from + (e.preview ? ' ' + e.preview : ''),
    targetTab: 'mailbox',
    targetId: e.id,
    keywords: tokenize(e.subject + ' ' + e.from + (e.preview ? ' ' + e.preview : '')),
  }))
  buildInvertedIndex(entries)
}

export function query(q: string, typeFilter?: string): SearchEntry[] {
  const tokens = tokenize(q)
  if (tokens.length === 0) return []

  // Score entries: TF (term frequency) normalized by document length
  const scores = new Map<string, { entry: SearchEntry; score: number }>()
  for (const token of tokens) {
    const matches = index.get(token) || []
    for (const match of matches) {
      if (typeFilter && match.type !== typeFilter) continue
      const key = match.type + ':' + (match.targetId || match.title)
      const existing = scores.get(key)
      if (existing) {
        existing.score += 1
      } else {
        scores.set(key, { entry: match, score: 1 })
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => {
      // Normalize by combined title+subtitle length so short docs don't lose out
      const aNorm = a.score / Math.max(1, (a.entry.title + a.entry.subtitle).length)
      const bNorm = b.score / Math.max(1, (b.entry.title + b.entry.subtitle).length)
      return bNorm - aNorm
    })
    .map((x) => x.entry)
    .slice(0, 20)
}
