import type { MediaSegment } from '../lib/jellyfin'
import { noFocusOnClick } from '../lib/noFocusOnClick'
import styles from './PlayerControls.module.css'

const labels: Record<MediaSegment['Type'], string> = {
  Intro: 'Skip Intro',
  Outro: 'Skip Credits',
  Recap: 'Skip Recap',
  Preview: 'Skip Preview',
  Commercial: 'Skip Ad',
  Unknown: 'Skip'
}

export function SkipSegmentButton({
  segment,
  onSkip
}: {
  segment: MediaSegment
  onSkip: () => void
}): React.JSX.Element {
  return (
    <button
      className={styles.skipSegment}
      onClick={onSkip}
      onMouseDown={noFocusOnClick}
      tabIndex={-1}
    >
      {labels[segment.Type]}
    </button>
  )
}
