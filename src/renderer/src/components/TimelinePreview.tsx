import { useEffect, useState } from 'react'
import { ticksToSeconds, type BaseItem } from '../lib/jellyfin'
import styles from './PlayerControls.module.css'

interface Chapter {
  start: number
  name: string | undefined
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export interface TimelinePreviewProps {
  item: BaseItem
  duration: number
  currentTime: number
  bufferedEnd: number
  onSeek: (t: number) => void
  onPreviewChange?: (preview: { x: number; t: number } | null) => void
}

export function TimelinePreview({
  item,
  duration,
  currentTime,
  bufferedEnd,
  onSeek,
  onPreviewChange
}: TimelinePreviewProps): React.JSX.Element {
  const [preview, setPreview] = useState<{ x: number; t: number } | null>(null)
  const [showRemaining, setShowRemaining] = useState(false)

  const chapters: Chapter[] = (item.Chapters ?? [])
    .map((c) => ({ start: ticksToSeconds(c.StartPositionTicks), name: c.Name }))
    .filter((c) => c.start > 0 && c.start < duration)

  const previewChapter = preview
    ? [...chapters].reverse().find((c) => c.start <= preview.t)?.name
    : undefined

  const pct = duration ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%'
  const buf = duration ? `${Math.min(100, (bufferedEnd / duration) * 100)}%` : '0%'

  useEffect(() => {
    onPreviewChange?.(preview)
  }, [preview, onPreviewChange])

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
            {previewChapter && <span className={styles.previewChapter}>{previewChapter}</span>}
            {fmt(preview.t)}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className={styles.timeline}
          style={{ '--pct': pct, '--buf': buf } as React.CSSProperties}
          aria-label="Timeline"
        />
        {chapters.map((c) => (
          <span
            key={c.start}
            className={styles.chapterTick}
            style={{ '--x': `${(c.start / duration) * 100}%` } as React.CSSProperties}
          />
        ))}
      </div>
      <span
        className={styles.time}
        title="Right-click to toggle remaining"
        onContextMenu={(e) => {
          e.preventDefault()
          setShowRemaining((v) => !v)
        }}
      >
        {showRemaining ? `-${fmt(duration - currentTime)}` : fmt(duration)}
      </span>
    </div>
  )
}
