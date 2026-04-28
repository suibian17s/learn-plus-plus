import { create } from 'zustand'

interface TutorMessage { role: 'user' | 'assistant'; content: string }
interface TutorState {
  messages: TutorMessage[]
  streaming: boolean
  style: 'cute' | 'serious'
  addMessage: (msg: TutorMessage) => void
  setStreaming: (v: boolean) => void
  setStyle: (s: 'cute' | 'serious') => void
  clearMessages: () => void
}
export const useTutorStore = create<TutorState>((set) => ({
  messages: [], streaming: false, style: 'cute',
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setStreaming: (v) => set({ streaming: v }),
  setStyle: (style) => set({ style }),
  clearMessages: () => set({ messages: [] }),
}))
