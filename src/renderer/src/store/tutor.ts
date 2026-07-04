import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TutorNav {
  label: string
  courseId?: string
  tab: string
}

export interface TutorMessage {
  role: 'user' | 'assistant'
  content: string
  /** navigate_to 工具产生的跳转卡片 */
  nav?: TutorNav
  /** 用户随消息发送的图片（data URL）；持久化时剥离，避免撑爆 localStorage */
  images?: string[]
}

export interface TutorSession {
  id: string
  title: string
  messages: TutorMessage[]
  updatedAt: number
}

export interface TutorPageContext {
  label?: string
  courseId?: string
  courseName?: string
  itemTitle?: string
  itemExcerpt?: string
}

const MAX_SESSIONS = 10

function makeSession(): TutorSession {
  return { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: '新对话', messages: [], updatedAt: Date.now() }
}

interface TutorState {
  sessions: TutorSession[]
  currentId: string
  streaming: boolean
  style: 'cute' | 'serious'
  /** 从其他页面带入的上下文（不持久化） */
  context: TutorPageContext | null
  /** 进入 Tutor 页后自动发送的提示（如"今日简报"，不持久化） */
  pendingPrompt: string | null

  newSession: () => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  addMessage: (msg: TutorMessage) => void
  updateMessages: (fn: (msgs: TutorMessage[]) => TutorMessage[]) => void
  setStreaming: (v: boolean) => void
  setStyle: (s: 'cute' | 'serious') => void
  setContext: (ctx: TutorPageContext | null) => void
  setPendingPrompt: (p: string | null) => void
  /** 从其它页面带上下文进入：当前会话非空则开新会话，保证上下文与对话一致 */
  startFocused: (ctx: TutorPageContext | null, prompt?: string) => void
}

function touchCurrent(state: TutorState, fn: (msgs: TutorMessage[]) => TutorMessage[]): Partial<TutorState> {
  const sessions = state.sessions.map((s) => {
    if (s.id !== state.currentId) return s
    const messages = fn(s.messages)
    const firstUser = messages.find((m) => m.role === 'user')
    return {
      ...s,
      messages,
      title: firstUser ? firstUser.content.slice(0, 24) : s.title,
      updatedAt: Date.now(),
    }
  })
  return { sessions }
}

export const useTutorStore = create<TutorState>()(
  persist(
    (set) => {
      const first = makeSession()
      return {
        sessions: [first],
        currentId: first.id,
        streaming: false,
        style: 'cute' as const,
        context: null,
        pendingPrompt: null,

        newSession: () => set((state) => {
          const fresh = makeSession()
          const sessions = [fresh, ...state.sessions.filter((s) => s.messages.length > 0)].slice(0, MAX_SESSIONS)
          return { sessions, currentId: fresh.id }
        }),
        switchSession: (id) => set((state) => (
          state.sessions.some((s) => s.id === id) ? { currentId: id } : {}
        )),
        deleteSession: (id) => set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== id)
          if (sessions.length === 0) {
            const fresh = makeSession()
            return { sessions: [fresh], currentId: fresh.id }
          }
          return {
            sessions,
            currentId: state.currentId === id ? sessions[0].id : state.currentId,
          }
        }),
        addMessage: (msg) => set((state) => touchCurrent(state, (msgs) => [...msgs, msg])),
        updateMessages: (fn) => set((state) => touchCurrent(state, fn)),
        setStreaming: (streaming) => set({ streaming }),
        setStyle: (style) => set({ style }),
        setContext: (context) => set({ context }),
        setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),
        startFocused: (ctx, prompt) => set((state) => {
          const cur = state.sessions.find((s) => s.id === state.currentId)
          if (cur && cur.messages.length > 0) {
            const fresh = makeSession()
            const sessions = [fresh, ...state.sessions.filter((s) => s.messages.length > 0)].slice(0, MAX_SESSIONS)
            return { sessions, currentId: fresh.id, context: ctx, pendingPrompt: prompt ?? null }
          }
          return { context: ctx, pendingPrompt: prompt ?? null }
        }),
      }
    },
    {
      name: 'learnpp-tutor',
      partialize: (state) => ({
        // 持久化剥离图片 data URL（base64 很大，会撑爆 localStorage）——历史保留文字，图片仅当会话内存可见
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.map(({ images: _img, ...m }) => m),
        })),
        currentId: state.currentId,
        style: state.style,
      }),
    },
  ),
)

const EMPTY_MESSAGES: TutorMessage[] = []

export function useCurrentTutorMessages(): TutorMessage[] {
  return useTutorStore((s) => s.sessions.find((x) => x.id === s.currentId)?.messages ?? EMPTY_MESSAGES)
}
