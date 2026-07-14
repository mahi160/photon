import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BaseItem } from '../lib/jellyfin'

// Photon-local watch time, fed by the players' existing progress ticks
// (10s built-in, 5s mpv) whenever playback is actually running — paused and
// buffering time never counts. Real minutes sat watching, not content minutes
// (2× speed for an hour records an hour). No server dependency; stats start
// at zero on the day this shipped — Jellyfin has no "watched via which app"
// history to backfill from.
export interface DayStats {
  movieSecs: number
  episodeSecs: number
  mpvSecs: number // subset of the above that mpv played
}

interface WatchStatsState {
  days: Record<string, DayStats> // key: 'YYYY-MM-DD' local time
  series: Record<string, { name: string; secs: number }> // key: SeriesId
  record: (item: BaseItem, seconds: number, viaMpv: boolean) => void
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const KEEP_DAYS = 400

export const useWatchStats = create<WatchStatsState>()(
  persist(
    (set) => ({
      days: {},
      series: {},
      record: (item, seconds, viaMpv) =>
        set((s) => {
          const key = dayKey()
          const day = s.days[key] ?? { movieSecs: 0, episodeSecs: 0, mpvSecs: 0 }
          const isMovie = item.Type === 'Movie'
          const days = {
            ...s.days,
            [key]: {
              movieSecs: day.movieSecs + (isMovie ? seconds : 0),
              episodeSecs: day.episodeSecs + (isMovie ? 0 : seconds),
              mpvSecs: day.mpvSecs + (viaMpv ? seconds : 0)
            }
          }
          // ponytail: prune on write — max 400 daily buckets, no timers needed
          const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 86_400_000))
          for (const k of Object.keys(days)) if (k < cutoff) delete days[k]
          const series = item.SeriesId
            ? {
                ...s.series,
                [item.SeriesId]: {
                  name: item.SeriesName ?? 'Unknown',
                  secs: (s.series[item.SeriesId]?.secs ?? 0) + seconds
                }
              }
            : s.series
          return { days, series }
        })
    }),
    { name: 'photon.watchStats' }
  )
)
