import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { noFocusOnClick } from '../lib/noFocusOnClick'
import { useSettings } from '../stores/settings'
import styles from './PlayerControls.module.css'

export interface NextUpCardProps {
  nextEpisode: BaseItem
  remaining: number
  duration: number
  onPlay: () => void
  onDismiss: () => void
}

// PlayerControls already gates rendering on this same condition (showNextUp) -- this
// component trusts that guard instead of re-checking it (#31)
export function NextUpCard({
  nextEpisode,
  remaining,
  onPlay,
  onDismiss
}: NextUpCardProps): React.JSX.Element {
  const autoplayNext = useSettings((s) => s.autoplayNext)

  return (
    <div className={styles.nextUp}>
      {imageUrl(nextEpisode, 320) && (
        <img
          src={imageUrl(nextEpisode, 320)!}
          alt=""
          decoding="async"
          className={styles.nextUpThumb}
        />
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
          <button className={styles.nextUpPlay} onClick={onPlay} onMouseDown={noFocusOnClick}>
            Play now
          </button>
          <button className={styles.nextUpDismiss} onClick={onDismiss} onMouseDown={noFocusOnClick}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
