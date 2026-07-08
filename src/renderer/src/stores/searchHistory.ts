import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX = 8

interface SearchHistoryState {
  terms: string[]
  add: (term: string) => void
  remove: (term: string) => void
  clear: () => void
}

export const useSearchHistory = create<SearchHistoryState>()(
  persist(
    (set) => ({
      terms: [],
      add: (term) =>
        set((s) => ({
          terms: [term, ...s.terms.filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(
            0,
            MAX
          )
        })),
      remove: (term) => set((s) => ({ terms: s.terms.filter((t) => t !== term) })),
      clear: () => set({ terms: [] })
    }),
    { name: 'photon.searchHistory' }
  )
)
