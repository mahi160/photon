import { useState } from 'react'
import { useWatchStats, dayKey, type DayStats } from '../stores/watchStats'
import styles from './Settings.module.css'

// Photon-local watch stats (see stores/watchStats.ts for what counts).
// Read-only dashboard — no server round trips, everything is in localStorage.

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function sum(days: DayStats[]): number {
  return days.reduce((t, d) => t + d.movieSecs + d.episodeSecs, 0)
}

function lastNDays(days: Record<string, DayStats>, n: number, now: number): DayStats[] {
  const cutoff = dayKey(new Date(now - n * 86_400_000))
  return Object.entries(days)
    .filter(([k]) => k >= cutoff)
    .map(([, v]) => v)
}

export function StatsSettings(): React.JSX.Element {
  const days = useWatchStats((s) => s.days)
  const series = useWatchStats((s) => s.series)
  // lazy initializer: the sanctioned place to read the wall clock during
  // render — a stats snapshot doesn't need per-render freshness
  const [now] = useState(() => Date.now())

  const all = Object.values(days)
  const total = sum(all)
  const movieTotal = all.reduce((t, d) => t + d.movieSecs, 0)
  const episodeTotal = all.reduce((t, d) => t + d.episodeSecs, 0)
  const topShows = Object.values(series)
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 3)

  // last 30 days, oldest → newest, zero-filled for the bar strip
  const bars = Array.from({ length: 30 }, (_, i) => {
    const d = days[dayKey(new Date(now - (29 - i) * 86_400_000))]
    return d ? d.movieSecs + d.episodeSecs : 0
  })
  const barMax = Math.max(...bars, 1)

  if (total === 0)
    return (
      <>
        <h1 className={styles.pageTitle}>Stats</h1>
        <p className={styles.statsEmpty}>
          Nothing yet — stats count watch time in Photon from here on. Go watch something.
        </p>
      </>
    )

  return (
    <>
      <h1 className={styles.pageTitle}>Stats</h1>
      <div className={styles.stats}>
        <div className={styles.statCards}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{fmtDur(total)}</span>
            <span className={styles.statLabel}>all time</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{fmtDur(sum(lastNDays(days, 7, now)))}</span>
            <span className={styles.statLabel}>last 7 days</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{fmtDur(sum(lastNDays(days, 30, now)))}</span>
            <span className={styles.statLabel}>last 30 days</span>
          </div>
        </div>

        <div className={styles.statBars} aria-label="Watch time per day, last 30 days">
          {bars.map((b, i) => (
            <span
              key={i}
              className={styles.statBar}
              style={{ blockSize: `${Math.max(4, (b / barMax) * 100)}%` }}
              data-empty={b === 0 || undefined}
            />
          ))}
        </div>

        <div className={styles.statRows}>
          <div className={styles.statRow}>
            <span>Movies</span>
            <span className={styles.statRowValue}>{fmtDur(movieTotal)}</span>
          </div>
          <div className={styles.statRow}>
            <span>Episodes</span>
            <span className={styles.statRowValue}>{fmtDur(episodeTotal)}</span>
          </div>
        </div>

        {topShows.length > 0 && (
          <div>
            <h2 className={styles.sectionTitle}>Top shows</h2>
            <div className={styles.statRows}>
              {topShows.map((s, i) => (
                <div key={s.name} className={styles.statRow}>
                  <span>
                    <span className={styles.statRank}>#{i + 1}</span> {s.name}
                  </span>
                  <span className={styles.statRowValue}>{fmtDur(s.secs)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className={styles.statsNote}>
          Counted locally, only while actually playing in Photon. History before this feature
          shipped isn’t available.
        </p>
      </div>
    </>
  )
}
