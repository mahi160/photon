import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Per-item audio/subtitle pick, remembered across sessions so re-opening the
// same file resumes with the track you last chose for it. Keyed by item Id.
// ponytail: no eviction — a few thousand entries is still a tiny localStorage
// payload, not worth an LRU until someone's library makes that untrue.
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
