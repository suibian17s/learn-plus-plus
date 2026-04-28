/// <reference types="vite/client" />

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

interface LearnApi {
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
    selectDirectory: () => Promise<string | null>
    exists: (filePath: string) => Promise<boolean>
    downloadState: (fileName: string) => Promise<{ downloaded: boolean; destPath: string }>
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
    detail: (url: string) => Promise<any>
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
    onChunk: (cb: (data: { sessionId: string; delta: string }) => void) => () => void
    onEnd: (cb: (data: { sessionId: string }) => void) => () => void
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

export {}
