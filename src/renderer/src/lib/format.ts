// Shared duration formatting -- was five near-identical functions across
// TimelinePreview/PipOverlay/MovieDetails/EpisodeDetails/StatsSettings (#29).

// "1:23" / "1:02:03" -- player timeline, PiP overlay
export function hms(secondsInput: number): string {
  const seconds = Math.max(0, Math.round(secondsInput))
  if (!isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

// "2h 14m" / "45m" -- runtime badges, watch-stats summaries
export function humanDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
