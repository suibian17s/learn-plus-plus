import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DownloadItem {
  id: string
  fileName: string
  loaded: number
  total: number
  status: 'downloading' | 'completed' | 'error'
  destPath?: string
  time: number
}

interface DownloadStore {
  downloads: DownloadItem[]
  addOrUpdate: (d: DownloadItem) => void
  remove: (id: string) => void
  clearAll: () => void
}

export const useDownloadStore = create<DownloadStore>()(
  persist(
    (set) => ({
      downloads: [],
      addOrUpdate: (entry) =>
        set((s) => {
          const idx = s.downloads.findIndex((d) => d.id === entry.id)
          if (idx >= 0) {
            const updated = [...s.downloads]
            updated[idx] = {
              ...s.downloads[idx],
              ...entry,
              destPath: entry.destPath || s.downloads[idx].destPath,
              time: s.downloads[idx].time,
            }
            return { downloads: updated }
          }
          return { downloads: [...s.downloads, { ...entry, time: entry.time || Date.now() }] }
        }),
      remove: (id) => set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) })),
      clearAll: () => set({ downloads: [] }),
    }),
    {
      name: 'learnpp-download-history',
      partialize: (state) => ({
        downloads: state.downloads.map((item) => ({
          ...item,
          status: item.status === 'downloading' ? 'error' : item.status,
        })),
      }),
    },
  ),
)
