import { useMemo, useState } from 'react'
import { ticksToSeconds, trickplayTile, trickplayUrl, type BaseItem } from '../lib/jellyfin'
import { hms as fmt } from '../lib/format'
import { Tip } from './Tip'
import styles from './PlayerControls.module.css'

interface Chapter {
  start: number
  name: string | undefined
}

export interface TimelinePreviewProps {
  item: BaseItem
  duration: number
  currentTime: number
  bufferedEnd: number
  onSeek: (t: number) => void
}

export function TimelinePreview({
  item,
  duration,
  currentTime,
  bufferedEnd,
  onSeek
}: TimelinePreviewProps): React.JSX.Element {
  const [preview, setPreview] = useState<{ x: number; t: number } | null>(null)
  const [showRemaining, setShowRemaining] = useState(false)
  // local override while dragging/keying the thumb -- controlled value={currentTime} otherwise
  // fights the drag: engine seek latency means the next render can still show the pre-seek
  // time, snapping the thumb backward mid-drag (#10). Committed (onSeek) only on release.
  const [scrub, setScrub] = useState<number | null>(null)
  const commitScrub = (): void => {
    if (scrub !== null) onSeek(scrub)
    setScrub(null)
  }

  // server trickplay thumbs (Jellyfin 10.9+), absent -> text-only bubble
  // ponytail: first media source, smallest width variant -- hover thumb doesn't need large tiles
  const tp = useMemo(() => {
    const [mediaSourceId, widths] = Object.entries(item.Trickplay ?? {})[0] ?? []
    const infos = Object.values(widths ?? {})
    if (!mediaSourceId || !infos.length) return null
    return { mediaSourceId, info: infos.reduce((a, b) => (a.Width <= b.Width ? a : b)) }
  }, [item])

  const chapters: Chapter[] = (item.Chapters ?? [])
    .map((c) => ({ start: ticksToSeconds(c.StartPositionTicks), name: c.Name }))
    .filter((c) => c.start > 0 && c.start < duration)

  const previewChapter = preview
    ? [...chapters].reverse().find((c) => c.start <= preview.t)?.name
    : undefined

  const pct = duration ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%'
  const buf = duration ? `${Math.min(100, (bufferedEnd / duration) * 100)}%` : '0%'

  return (
    <div className={styles.timelineRow}>
      <span className={styles.time}>{fmt(currentTime)}</span>
      <div
        className={styles.timelineWrap}
        onPointerMove={(e) => {
          if (!duration) return
          const rect = e.currentTarget.getBoundingClientRect()
          const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          setPreview({ x: e.clientX - rect.left, t: frac * duration })
        }}
        onPointerLeave={() => setPreview(null)}
      >
        {preview && (
          <div
            className={styles.previewBubble}
            style={{ '--x': `${preview.x}px` } as React.CSSProperties}
          >
            {tp &&
              (() => {
                const { tile, x, y } = trickplayTile(tp.info, preview.t)
                const url = trickplayUrl(item.Id, tp.info.Width, tile, tp.mediaSourceId)
                return url ? (
                  <div
                    className={styles.previewThumb}
                    style={{ inlineSize: tp.info.Width, blockSize: tp.info.Height }}
                  >
                    {/* <img> not background-image: load failures surface in console, not a silent empty box */}
                    <img
                      src={url}
                      alt=""
                      draggable={false}
                      style={{ transform: `translate(-${x}px, -${y}px)` }}
                      onError={() => console.error('[trickplay] tile failed to load', url)}
                    />
                  </div>
                ) : null
              })()}
            {previewChapter && <span className={styles.previewChapter}>{previewChapter}</span>}
            {fmt(preview.t)}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={scrub ?? Math.min(currentTime, duration || 0)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          className={styles.timeline}
          style={
            {
              '--pct': scrub !== null ? `${Math.min(100, (scrub / (duration || 1)) * 100)}%` : pct,
              '--buf': buf
            } as React.CSSProperties
          }
          aria-label="Timeline"
          tabIndex={-1}
        />
        {chapters.map((c) => (
          <span
            key={c.start}
            className={styles.chapterTick}
            style={{ '--x': `${(c.start / duration) * 100}%` } as React.CSSProperties}
          />
        ))}
      </div>
      <Tip label="Toggle remaining">
        <button className={styles.time} onClick={() => setShowRemaining((v) => !v)}>
          {showRemaining ? `-${fmt(duration - currentTime)}` : fmt(duration)}
        </button>
      </Tip>
    </div>
  )
}
