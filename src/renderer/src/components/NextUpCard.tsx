import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { useSettings } from '../stores/settings'
import styles from './PlayerControls.module.css'

export interface NextUpCardProps {
  nextEpisode: BaseItem
  remaining: number
  duration: number
  onPlay: () => void
  onDismiss: () => void
}

export function NextUpCard({
  nextEpisode,
  remaining,
  duration,
  onPlay,
  onDismiss
}: NextUpCardProps): React.JSX.Element | null {
  const autoplayNext = useSettings((s) => s.autoplayNext)

  // show only in final 30 seconds
  if (duration <= 0 || remaining > 30 || remaining <= 0) return null

  return (
    <div className={styles.nextUp}>
      {imageUrl(nextEpisode, 320) && (
        <img src={imageUrl(nextEpisode, 320)!} alt="" className={styles.nextUpThumb} />
      )}
      <div className={styles.nextUpInfo}>
        <div className={styles.nextUpEyebrow}>
          {autoplayNext ? `up next in ${Math.ceil(remaining)}s` : 'up next'}
        </div>
        <div className={styles.nextUpTitle}>
          S{String(nextEpisode.ParentIndexNumber ?? 0).padStart(2, '0')}E
          {String(nextEpisode.IndexNumber ?? 0).padStart(2, '0')} · {nextEpisode.Name}
        </div>
        <div className={styles.nextUpActions}>
          <button className={styles.nextUpPlay} onClick={onPlay}>
            Play now
          </button>
          <button className={styles.nextUpDismiss} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
