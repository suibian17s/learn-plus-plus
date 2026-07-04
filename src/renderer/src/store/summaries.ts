import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SummaryEntry {
  content: string
  createdAt: number
}

const MAX_ENTRIES = 60

interface SummariesState {
  entries: Record<string, SummaryEntry>
  save: (key: string, content: string) => void
  remove: (key: string) => void
}

/** 甘蔗 Tutor 总结结果持久化：同一对象的总结直接复用，不重新生成 */
export const useSummariesStore = create<SummariesState>()(
  persist(
    (set) => ({
      entries: {},
      save: (key, content) => set((state) => {
        const entries = { ...state.entries, [key]: { content, createdAt: Date.now() } }
        const keys = Object.keys(entries)
        if (keys.length > MAX_ENTRIES) {
          keys.sort((a, b) => entries[a].createdAt - entries[b].createdAt)
          for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[stale]
        }
        return { entries }
      }),
      remove: (key) => set((state) => {
        const entries = { ...state.entries }
        delete entries[key]
        return { entries }
      }),
    }),
    { name: 'learnpp-tutor-summaries' },
  ),
)
