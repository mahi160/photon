import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Per-item audio/subtitle pick, remembered across sessions, keyed by item Id.
// ponytail: no eviction -- few thousand entries is tiny localStorage payload, add LRU if a huge library ever needs it.
interface TrackChoice {
  audioStreamIndex?: number
  subtitleStreamIndex?: number // -1 = explicitly off
}

interface TrackMemoryState {
  byItem: Record<string, TrackChoice>
  remember: (itemId: string, choice: TrackChoice) => void
}

export const useTrackMemory = create<TrackMemoryState>()(
  persist(
    (set) => ({
      byItem: {},
      remember: (itemId, choice) =>
        set((s) => ({
          byItem: { ...s.byItem, [itemId]: { ...s.byItem[itemId], ...choice } }
        }))
    }),
    { name: 'photon.trackMemory' }
  )
)
