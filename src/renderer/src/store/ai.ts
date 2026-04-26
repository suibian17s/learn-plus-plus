import { create } from 'zustand'

interface AiState {
  riskAcknowledged: boolean
  generating: boolean
  currentSessionId: string | null
  streamText: string

  setRiskAcknowledged: (v: boolean) => void
  setGenerating: (v: boolean) => void
  setCurrentSession: (id: string | null) => void
  appendStreamText: (delta: string) => void
  clearStreamText: () => void
}

export const useAiStore = create<AiState>((set) => ({
  riskAcknowledged: false,
  generating: false,
  currentSessionId: null,
  streamText: '',

  setRiskAcknowledged: (v) => set({ riskAcknowledged: v }),
  setGenerating: (v) => set({ generating: v }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  appendStreamText: (delta) => set((s) => ({ streamText: s.streamText + delta })),
  clearStreamText: () => set({ streamText: '' }),
}))
