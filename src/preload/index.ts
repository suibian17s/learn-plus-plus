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
    download: (courseId: string, fileId: string, fileName: string, url: string) =>
      ipcRenderer.invoke('files:download', courseId, fileId, fileName, url),
    openFolder: (filePath: string) => ipcRenderer.invoke('files:openFolder', filePath),
    openFile: (filePath: string) => ipcRenderer.invoke('files:openFile', filePath),
    previewWindow: (filePath: string, fileName: string) =>
      ipcRenderer.invoke('files:previewWindow', filePath, fileName),
    selectDirectory: () => ipcRenderer.invoke('files:selectDirectory'),
    exists: (filePath: string) => ipcRenderer.invoke('files:exists', filePath),
    downloadState: (arg1: string, arg2?: string, arg3?: string) =>
      ipcRenderer.invoke('files:downloadState', arg1, arg2, arg3),
    preview: (fileId: string, fileName: string, url: string) =>
      ipcRenderer.invoke('files:preview', fileId, fileName, url),
    previewOpen: (fileId: string, fileName: string, url: string) =>
      ipcRenderer.invoke('files:previewOpen', fileId, fileName, url),
    batchDownload: (items: { courseId: string; fileId: string; fileName: string; url: string }[]) =>
      ipcRenderer.invoke('files:batchDownload', items),
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
    downloadAttachment: (url: string, fileName: string, courseId?: string) =>
      ipcRenderer.invoke('hw:downloadAttachment', url, fileName, courseId),
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
    tutorSummary: (courseId: string, kind: 'notifications' | 'files' | 'discussion', sessionId?: string) =>
      ipcRenderer.invoke('hwai:tutor-summary', courseId, kind, sessionId),
    tutorAsk: (courseId: string, question: string, sessionId?: string) =>
      ipcRenderer.invoke('hwai:tutor-ask', courseId, question, sessionId),
    abort: (sessionId: string) => ipcRenderer.invoke('hwai:abort', sessionId),
    hasAcknowledgedRisk: () => ipcRenderer.invoke('hwai:has-acknowledged-risk'),
    acknowledgeRisk: () => ipcRenderer.invoke('hwai:acknowledge-risk'),
    tutorChat: (params: { messages: { role: string; content: string; images?: string[] }[]; courseId?: string; style?: 'cute' | 'serious'; sessionId: string; pageContext?: { label?: string; courseId?: string; courseName?: string; itemTitle?: string; itemExcerpt?: string } }) =>
      ipcRenderer.invoke('tutor:chat', params),
    tutorAbort: (sessionId: string) => ipcRenderer.invoke('tutor:abort', sessionId),
    draftMail: (params: { purpose: string; subject?: string }) => ipcRenderer.invoke('hwai:draft-mail', params),
    onChunk: (cb: (data: { sessionId: string; delta?: string; type?: string; call?: any; name?: string; result?: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:generate-chunk', handler)
      return () => ipcRenderer.removeListener('hwai:generate-chunk', handler)
    },
    onEnd: (cb: (data: { sessionId: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:generate-end', handler)
      return () => ipcRenderer.removeListener('hwai:generate-end', handler)
    },
    summarizeFile: (file: { name: string; url: string; fileType?: string }) =>
      ipcRenderer.invoke('hwai:summarize-file', file),
    fileChat: (req: { file: { name: string; url: string; fileType?: string }; question: string; history: { role: 'user' | 'assistant'; content: string }[]; sessionId?: string }) =>
      ipcRenderer.invoke('hwai:file-chat', req),
    healthCheck: () => ipcRenderer.invoke('hwai:health-check'),
    orchestrate: (params: any) => ipcRenderer.invoke('hwai:orchestrate', params),
    onOrchestrateChunk: (cb: any) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:orchestrate-chunk', handler)
      return () => ipcRenderer.removeListener('hwai:orchestrate-chunk', handler)
    },
    onOrchestrateEnd: (cb: any) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('hwai:orchestrate-end', handler)
      return () => ipcRenderer.removeListener('hwai:orchestrate-end', handler)
    },
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get'),
    set: (partial: any) => ipcRenderer.invoke('settings:set', partial),
    setApiKey: (key: string, provider?: string) => ipcRenderer.invoke('settings:setApiKey', key, provider),
    hasApiKey: (provider?: string) => ipcRenderer.invoke('settings:hasApiKey', provider),
  },
  stats: {
    computeDashboard: (payload: any) => ipcRenderer.invoke('stats:computeDashboard', payload),
    refreshDashboard: (payload: any) => ipcRenderer.invoke('stats:refreshDashboard', payload),
    onUpdated: (cb: (data: any) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on('stats:updated', handler)
      return () => ipcRenderer.removeListener('stats:updated', handler)
    },
  },
  focus: {
    add: (item: { id: string; type: 'email'; title: string; description: string; createdAt: string; mailId: string }) =>
      ipcRenderer.invoke('focus:add', item),
    remove: (id: string) => ipcRenderer.invoke('focus:remove', id),
    list: () => ipcRenderer.invoke('focus:list'),
  },
  search: {
    query: (q: string, typeFilter?: string) => ipcRenderer.invoke('search:query', q, typeFilter),
    indexItems: (type: string, items: any[], targetTab: string) =>
      ipcRenderer.invoke('search:indexItems', type, items, targetTab),
  },
  mail: {
    loginImap: (config: any) => ipcRenderer.invoke('mail:login-imap', config),
    testConnection: (config: any) => ipcRenderer.invoke('mail:test-connection', config),
    status: () => ipcRenderer.invoke('mail:status'),
    check: () => ipcRenderer.invoke('mail:check'),
    list: (folder: string, force?: boolean) => ipcRenderer.invoke('mail:list', folder, force),
    search: (query: string, folder?: string) =>
      ipcRenderer.invoke('mail:search', query, folder),
    get: (mailId: string, folder?: string) => ipcRenderer.invoke('mail:get', mailId, folder),
    star: (mailId: string, starred: boolean) =>
      ipcRenderer.invoke('mail:star', mailId, starred),
    delete: (mailId: string, currentFolder?: string) =>
      ipcRenderer.invoke('mail:delete', mailId, currentFolder),
    logout: () => ipcRenderer.invoke('mail:logout'),
    compose: (params: { to: string; subject: string; body: string }) =>
      ipcRenderer.invoke('mail:compose', params),
    saveAttachment: (tempPath: string, fileName: string) =>
      ipcRenderer.invoke('mail:save-attachment', tempPath, fileName),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
    controlWindow: (command: 'minimize' | 'toggle-maximize' | 'close' | 'quit') =>
      ipcRenderer.send('window:command', command),
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
