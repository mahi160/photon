import { Pip } from 'reicon-react'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { noFocusOnClick } from '../lib/noFocusOnClick'
import styles from './PipOverlay.module.css'

export interface PipOverlayProps {
  item: BaseItem
  time: number
  duration: number
  onBack: () => void
  onEndPiP: () => void
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h > 0
    ? `${h}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${mm}:${String(s % 60).padStart(2, '0')}`
}

// Shown over the (paused, handed-off) in-process player while PiP owns
// playback in its own spawned mpv window (ADR-0006) -- that window has no
// Photon UI of its own to carry a title/progress/back button, so this is
// the calm "it's playing elsewhere" stand-in for the normal controls.
// Anchored to the same bottom-right corner `pip_start` actually spawns mpv
// into (`--geometry=-24-24`), not centered -- the one thing this card can
// say truthfully is which way the video went.
export function PipOverlay(p: PipOverlayProps): React.JSX.Element {
  const poster = imageUrl(p.item, 320)
  const pct = p.duration > 0 ? `${Math.min(100, (p.time / p.duration) * 100)}%` : '0%'
  return (
    <div className={styles.layer}>
      <div className={styles.card} style={{ '--pct': pct } as React.CSSProperties}>
        <div className={styles.rule} />
        {poster && <img src={poster} alt="" className={styles.poster} />}
        <div className={styles.info}>
          <div className={styles.eyebrow}>
            <Pip className={styles.eyebrowIcon} />
            Picture-in-Picture
          </div>
          <div className={styles.title}>
            {p.item.Type === 'Episode' ? (p.item.SeriesName ?? p.item.Name) : p.item.Name}
          </div>
          {p.item.Type === 'Episode' && (
            <div className={styles.subtitle}>
              S{String(p.item.ParentIndexNumber ?? 0).padStart(2, '0')}E
              {String(p.item.IndexNumber ?? 0).padStart(2, '0')} · {p.item.Name}
            </div>
          )}
          {p.duration > 0 && (
            <div className={styles.progressRow}>
              <div className={styles.progressTrack} />
              <span className={styles.time}>
                {fmt(p.time)} / {fmt(p.duration)}
              </span>
            </div>
          )}
          <div className={styles.actions}>
            <button className={styles.endPip} onClick={p.onEndPiP} onMouseDown={noFocusOnClick}>
              End Picture-in-Picture
            </button>
            <button className={styles.back} onClick={p.onBack} onMouseDown={noFocusOnClick}>
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
