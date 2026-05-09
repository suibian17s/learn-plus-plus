export interface LearnApi {
  auth: {
    login: (username: string, password: string, remember: boolean) => Promise<{ ok: boolean; error?: string }>
    loginBrowser: (loginUrl?: string) => Promise<{ ok: boolean; error?: string }>
    addAccountBrowser: (loginUrl?: string) => Promise<{ ok: boolean; error?: string; account?: any }>
    listAccounts: () => Promise<{ activeId?: string; accounts: any[] }>
    switchAccount: (id: string) => Promise<{ ok: boolean; error?: string; account?: any }>
    logout: () => Promise<{ ok: boolean }>
    status: () => Promise<{ loggedIn: boolean; hasStoredCredentials: boolean }>
    hasStoredCredentials: () => Promise<boolean>
  }
  course: {
    listSemesters: () => Promise<{ semesters: { id: string; name: string }[]; current: { id: string; name: string } }>
    listCourses: (semesterId: string) => Promise<{ id: string; name: string; teacher: string }[]>
  }
  notice: {
    list: (courseId: string) => Promise<any[]>
    get: (courseId: string, id: string) => Promise<any>
  }
  files: {
    list: (courseId: string) => Promise<any[]>
    download: (fileId: string, fileName: string, url: string) => Promise<{ downloadId: string; destPath: string }>
    openFolder: (filePath: string) => Promise<void>
    openFile: (filePath: string) => Promise<void>
    previewWindow: (filePath: string, fileName: string) => Promise<void>
    selectDirectory: () => Promise<string | null>
    exists: (filePath: string) => Promise<boolean>
    downloadState: (fileName: string) => Promise<{ downloaded: boolean; destPath: string }>
    preview: (fileId: string, fileName: string, url: string) => Promise<{ tempPath: string; fileType: string }>
    previewOpen: (fileId: string, fileName: string, url: string) => Promise<{ method: string; content: string; fileName: string }>
    batchDownload: (items: { fileId: string; fileName: string; url: string }[]) => Promise<{ fileId: string; success: boolean; destPath?: string; error?: string }[]>
    onProgress: (cb: (data: any) => void) => () => void
  }
  hw: {
    list: (courseId: string) => Promise<any[]>
    submit: (studentHomeworkId: string, content: string, attachmentPath?: string, removeOld?: boolean) => Promise<{ ok: boolean; error?: string }>
    selectFile: () => Promise<{ path: string; name: string; size: number; error?: string } | null>
    downloadAttachment: (url: string, fileName: string) => Promise<{ downloadId: string; destPath: string }>
  }
  disc: {
    list: (courseId: string) => Promise<any[]>
    detail: (url: string) => Promise<any>
    openWindow: (url: string) => Promise<{ ok: boolean }>
  }
  answering: {
    list: (courseId: string) => Promise<any[]>
  }
  questionnaire: {
    list: (courseId: string) => Promise<any[]>
  }
  openExternal: (url: string) => Promise<void>
  hwai: {
    scan: (courseId: string) => Promise<any[]>
    analyze: (courseId: string, hwId: string) => Promise<any>
    generate: (params: any) => Promise<any>
    buildAttachment: (spec: any, markdown: string) => Promise<{ tempPath: string }>
    tutorSummary: (courseId: string, kind: 'notifications' | 'files' | 'discussion') => Promise<{ ok: boolean; content?: string; error?: string }>
    tutorAsk: (courseId: string, question: string) => Promise<{ ok: boolean; content?: string; error?: string }>
    abort: (sessionId: string) => Promise<void>
    hasAcknowledgedRisk: () => Promise<boolean>
    acknowledgeRisk: () => Promise<{ ok: boolean }>
    tutorChat: (params: { messages: { role: string; content: string }[]; courseId?: string; style?: 'cute' | 'serious'; sessionId: string }) => Promise<{ finishReason: string; error?: string; messageCount: number }>
    tutorAbort: (sessionId: string) => Promise<void>
    onChunk: (cb: (data: { sessionId: string; delta?: string; type?: string; call?: any; name?: string; result?: string }) => void) => () => void
    onEnd: (cb: (data: { sessionId: string }) => void) => () => void
    summarizeFile: (file: { name: string; url: string; fileType?: string }) => Promise<{ ok: boolean; content?: string; error?: string }>
    healthCheck: () => Promise<{ ok: boolean; error?: string }>
  }
  settings: {
    getAll: () => Promise<any>
    set: (partial: any) => Promise<any>
    setApiKey: (key: string, provider?: string) => Promise<{ ok: boolean }>
    hasApiKey: (provider?: string) => Promise<boolean>
  }
  stats: {
    computeDashboard: (payload: {
      courses: { id: string; name: string; teacher: string }[]
      homeworksByCourse: Record<string, any[]>
      noticesByCourse: Record<string, any[]>
      discussionsByCourse: Record<string, any[]>
    }) => Promise<any>
  }
  search: {
    query: (q: string, typeFilter?: string) => Promise<any[]>
    indexItems: (type: string, items: any[], targetTab: string) => Promise<{ ok: boolean }>
  }
  mail: {
    login: () => Promise<{ ok: boolean }>
    loginImap: (config: { imapHost: string; imapPort: number; imapTls: boolean; smtpHost: string; smtpPort: number; smtpTls: boolean; username: string; password: string }) => Promise<{ ok: boolean }>
    testConnection: (config: { imapHost: string; imapPort: number; imapTls: boolean; smtpHost: string; smtpPort: number; smtpTls: boolean; username: string; password: string }) => Promise<{ ok: boolean }>
    status: () => Promise<{ loggedIn: boolean }>
    list: (folder: string) => Promise<{ mails: { id: string; subject: string; from: string; to: string; date: string; preview: string; starred: boolean; read: boolean }[]; total: number }>
    get: (mailId: string) => Promise<{ id: string; subject: string; from: string; to: string; date: string; preview: string; starred: boolean; read: boolean; body: string; attachments: { name: string; url: string }[] } | null>
    star: (mailId: string, starred: boolean) => Promise<{ ok: boolean }>
    delete: (mailId: string) => Promise<{ ok: boolean }>
    logout: () => Promise<{ ok: boolean }>
    show: () => Promise<void>
    compose: (params: { to: string; subject: string; body: string }) => Promise<{ ok: boolean; error?: string }>
  }
  app: {
    info: () => Promise<{
      name: string
      version: string
      platform: string
      arch: string
      electron: string
      chrome: string
      node: string
    }>
    checkForUpdates: () => Promise<{
      ok: boolean
      currentVersion: string
      latestVersion?: string
      hasUpdate?: boolean
      releaseName?: string
      releaseUrl?: string
      releasesUrl?: string
      error?: string
    }>
    controlWindow: (command: 'minimize' | 'toggle-maximize' | 'close') => void
    minimizeWindow: () => Promise<void>
    toggleMaximizeWindow: () => Promise<void>
    closeWindow: () => Promise<void>
    quitWindow: () => Promise<void>
    onResume: (cb: () => void) => () => void
  }
  onAutoLoginResult: (cb: (loggedIn: boolean) => void) => () => void
}

declare global {
  interface Window {
    learn: LearnApi
  }
}
