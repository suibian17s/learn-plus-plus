export interface Credentials {
  username: string
  password: string
}

export interface AuthStatus {
  loggedIn: boolean
  user?: { name: string; id: string }
  hasStoredCredentials: boolean
}

export interface CourseInfo {
  id: string
  name: string
  teacher: string
  semester: string
}

export interface Semester {
  id: string
  name: string
}

export interface NotificationItem {
  id: string
  title: string
  content: string
  htmlContent: string
  publishTime: string
  publisher: string
  courseName: string
  courseId: string
}

export interface FileItem {
  id: string
  name: string
  size: number
  downloadUrl: string
  uploadTime: string
  courseId: string
}

export interface DownloadProgress {
  id: string
  fileName: string
  loaded: number
  total: number
  status: 'downloading' | 'completed' | 'error'
}

export interface HomeworkItem {
  id: string
  studentHomeworkId: string
  title: string
  deadline: string
  status: '未提交' | '已提交' | '已批阅'
  score?: string
  gradeLevel?: string
  courseId: string
  courseName: string
  description?: string
  teacherMessage?: string
  attachments?: { name: string; url: string }[]
}

export interface DiscussionItem {
  id: string
  title: string
  content: string
  author: string
  publishTime: string
  replyCount: number
  courseId: string
}

export interface AnsweringItem {
  id: string
  question: string
  answer: string
  askTime: string
  answerTime: string
  courseId: string
}

export interface QuestionnaireItem {
  id: string
  title: string
  deadline: string
  status: string
  url: string
  courseId: string
}

export interface AppSettings {
  downloadDir: string
  aiProvider: string
  aiModel: string
  aiBaseUrl?: string
  aiApiFormat?: 'openai' | 'anthropic'
  apiKey: string
  hasApiKey?: boolean
  launchAtStartup?: boolean
  aiAutoCompleteAcknowledged: boolean
}

// AI homework types
export type HomeworkType = 'text' | 'report' | 'ppt' | 'code' | 'lab' | 'unknown'

export interface HomeworkSummary {
  homeworkId: string
  studentHomeworkId: string
  title: string
  deadline: string
  type: HomeworkType
  confidence: number
  courseId: string
  courseName: string
  status: string
}

export interface ParsedAttachment {
  name: string
  text: string
  tokenEstimate: number
}

export interface AnalyzedHomework {
  hw: {
    id: string
    studentHomeworkId: string
    title: string
    description: string
    deadline: string
    courseId: string
    courseName: string
  }
  type: HomeworkType
  confidence: number
  parsedAttachments: ParsedAttachment[]
  suggestedOutputs: ('content' | 'docx' | 'pdf' | 'code')[]
  warnings: string[]
}

export interface GenerateRequestParams {
  analyzed: AnalyzedHomework
  userInstruction?: string
  sessionId: string
}

export interface GenerateResult {
  contentMarkdown: string
  attachmentSpec?: { kind: 'docx' | 'pdf'; filename: string; buffer: number[] }
  meta: { tokensUsed: number; modelId: string }
}

export interface StatsSnapshot {
  todayMinutes: number
  streakDays: number
  completedCourses: number
  totalCourses: number
  weeklyMinutes: number
  todayFocus: TodayFocusItem[]
  courseProgress: CourseProgressItem[]
  recentUpdates: RecentUpdateItem[]
}

export interface TodayFocusItem {
  priority: 'P0' | 'P1' | 'P2'
  courseName: string
  courseId: string
  title: string
  tag: string
  deadline?: string
  targetTab: 'homework' | 'notifications' | 'discussion' | 'files'
  targetId?: string
}

export interface CourseProgressItem {
  courseId: string
  courseName: string
  done: number
  total: number
  percent: number
}

export interface RecentUpdateItem {
  courseId: string
  courseName: string
  text: string
  time: string
  kind: 'notice' | 'file' | 'homework' | 'discussion'
}

export interface StatsDailyRecord {
  dailyMinutes: Record<string, number>
  lastActiveDate: string
}
