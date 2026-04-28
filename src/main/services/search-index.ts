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
  index.clear()
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

export function indexEmails(emails: { id: string; subject: string; from: string }[]): void {
  const entries: SearchEntry[] = emails.map((e) => ({
    type: 'email',
    title: e.subject,
    subtitle: e.from,
    targetTab: 'mailbox',
    targetId: e.id,
    keywords: tokenize(e.subject + ' ' + e.from),
  }))
  buildInvertedIndex(entries)
}

export function query(q: string, typeFilter?: string): SearchEntry[] {
  const tokens = tokenize(q)
  const results = new Map<string, SearchEntry>()
  for (const token of tokens) {
    const matches = index.get(token) || []
    for (const match of matches) {
      if (typeFilter && match.type !== typeFilter) continue
      results.set(match.type + ':' + (match.targetId || match.title), match)
    }
  }
  return Array.from(results.values()).slice(0, 20)
}
