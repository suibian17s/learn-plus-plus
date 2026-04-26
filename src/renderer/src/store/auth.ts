import { create } from 'zustand'

interface AuthState {
  loggedIn: boolean
  loading: boolean
  courses: { id: string; name: string; teacher: string }[]
  selectedCourseId: string | null
  semesters: { id: string; name: string }[]
  currentSemester: { id: string; name: string } | null

  setLoggedIn: (v: boolean) => void
  setLoading: (v: boolean) => void
  setCourses: (courses: { id: string; name: string; teacher: string }[]) => void
  setSelectedCourse: (id: string | null) => void
  setSemesters: (list: { id: string; name: string }[], current: { id: string; name: string }) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  loggedIn: false,
  loading: true,
  courses: [],
  selectedCourseId: null,
  semesters: [],
  currentSemester: null,

  setLoggedIn: (v) => set({ loggedIn: v }),
  setLoading: (v) => set({ loading: v }),
  setCourses: (courses) => set({ courses }),
  setSelectedCourse: (id) => set({ selectedCourseId: id }),
  setSemesters: (list, current) => set({ semesters: list, currentSemester: current }),
  reset: () => set({
    loggedIn: false,
    loading: false,
    courses: [],
    selectedCourseId: null,
  }),
}))
