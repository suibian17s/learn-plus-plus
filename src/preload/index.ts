import { contextBridge, ipcRenderer } from 'electron'

const api = {
  auth: {
    login: (username: string, password: string, remember: boolean) =>
      ipcRenderer.invoke('auth:login', username, password, remember),
    loginBrowser: (loginUrl?: string) => ipcRenderer.invoke('auth:login-browser', loginUrl),
    addAccountBrowser: (loginUrl?: string) => ipcRenderer.invoke('auth:add-account-browser', loginUrl),
    listAccounts: () => ipcRenderer.invoke('auth:accounts'),
    switchAccount: (id: string) => ipcRenderer.invoke('auth:switch-account', id),
    logout: () => ipcRenderer.invoke('auth:logout'),
    status: () => ipcRenderer.invoke('auth:status'),
    hasStoredCredentials: () => ipcRenderer.invoke('auth:hasStoredCredentials'),
  },
  course: {
    listSemesters: () => ipcRenderer.invoke('course:semesters'),
    listCourses: (semesterId: string) => ipcRenderer.invoke('course:list', semesterId),
  },
  notice: {
    list: (courseId: string) => ipcRenderer.invoke('notice:list', courseId),
    get: (courseId: string, id: string) => ipcRenderer.invoke('notice:list', courseId).then((list: any[]) => list.find((n: any) => n.id === id)),
  },
  files: {
    list: (courseId: string) => ipcRenderer.invoke('files:list', courseId),
    download: (fileId: string, fileName: string, url: string) =>
      ipcRenderer.invoke('files:download', fileId, fileName, url),
    openFolder: (filePath: string) => ipcRenderer.invoke('files:openFolder', filePath),
    selectDirectory: () => ipcRenderer.invoke('files:selectDirectory'),
    exists: (filePath: string) => ipcRenderer.invoke('files:exists', filePath),
    downloadState: (fileName: string) => ipcRenderer.invoke('files:downloadState', fileName),
    onProgress: (cb: (data: any) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('files:progress', handler)
      return () => ipcRenderer.removeListener('files:progress', handler)
    },
  },
  hw: {
    list: (courseId: string) => ipcRenderer.invoke('hw:list', courseId),
    submit: (studentHomeworkId: string, content: string, attachmentPath?: string, removeOld?: boolean) =>
      ipcRenderer.invoke('hw:submit', studentHomeworkId, content, attachmentPath, removeOld),
    selectFile: () => ipcRenderer.invoke('hw:selectFile') as Promise<{ path: string; name: string; size: number; error?: string } | null>,
    downloadAttachment: (url: string, fileName: string) =>
      ipcRenderer.invoke('hw:downloadAttachment', url, fileName),
  },
  disc: {
    list: (courseId: string) => ipcRenderer.invoke('disc:list', courseId),
    detail: (url: string) => ipcRenderer.invoke('disc:detail', url),
    openWindow: (url: string) => ipcRenderer.invoke('disc:openWindow', url),
  },
  answering: {
    list: (courseId: string) => ipcRenderer.invoke('answering:list', courseId),
    detail: (url: string) => ipcRenderer.invoke('answering:detail', url),
  },
  questionnaire: {
    list: (courseId: string) => ipcRenderer.invoke('questionnaire:list', courseId),
  },
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  hwai: {
    scan: (courseId: string) => ipcRenderer.invoke('hwai:scan', courseId),
    analyze: (courseId: string, hwId: string) => ipcRenderer.invoke('hwai:analyze', courseId, hwId),
    generate: (params: any) => ipcRenderer.invoke('hwai:generate', params),
    buildAttachment: (spec: any, markdown: string) =>
      ipcRenderer.invoke('hwai:build-attachment', spec, markdown),
    tutorSummary: (courseId: string, kind: 'notifications' | 'files' | 'discussion') =>
      ipcRenderer.invoke('hwai:tutor-summary', courseId, kind),
    tutorAsk: (courseId: string, question: string) =>
      ipcRenderer.invoke('hwai:tutor-ask', courseId, question),
    abort: (sessionId: string) => ipcRenderer.invoke('hwai:abort', sessionId),
    hasAcknowledgedRisk: () => ipcRenderer.invoke('hwai:has-acknowledged-risk'),
    acknowledgeRisk: () => ipcRenderer.invoke('hwai:acknowledge-risk'),
    onChunk: (cb: (data: { sessionId: string; delta: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:generate-chunk', handler)
      return () => ipcRenderer.removeListener('hwai:generate-chunk', handler)
    },
    onEnd: (cb: (data: { sessionId: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:generate-end', handler)
      return () => ipcRenderer.removeListener('hwai:generate-end', handler)
    },
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get'),
    set: (partial: any) => ipcRenderer.invoke('settings:set', partial),
    setApiKey: (key: string, provider?: string) => ipcRenderer.invoke('settings:setApiKey', key, provider),
    hasApiKey: (provider?: string) => ipcRenderer.invoke('settings:hasApiKey', provider),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
    controlWindow: (command: 'minimize' | 'toggle-maximize' | 'close') =>
      ipcRenderer.send('window:command', command),
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    quitWindow: () => ipcRenderer.invoke('window:quit'),
    onResume: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('app:resume', handler)
      return () => ipcRenderer.removeListener('app:resume', handler)
    },
  },
  onAutoLoginResult: (cb: (loggedIn: boolean) => void) => {
    const handler = (_e: any, loggedIn: boolean) => cb(loggedIn)
    ipcRenderer.on('auto-login-result', handler)
    return () => ipcRenderer.removeListener('auto-login-result', handler)
  },
}

contextBridge.exposeInMainWorld('learn', api)

export type LearnApi = typeof api
