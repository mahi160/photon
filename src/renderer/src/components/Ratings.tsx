import { Heart, Star } from 'reicon-react'
import type { BaseItem } from '../lib/jellyfin'
import styles from './Ratings.module.css'

// Star = community score, heart = critics %. Monochrome, sits in the meta
// row like any other entry. Data is the server's own metadata scrape — no
// external rating API involved.
export function Ratings({ item }: { item: BaseItem }): React.JSX.Element | null {
  const community = item.CommunityRating
  const critic = item.CriticRating
  if (!community && !critic) return null
  return (
    <>
      {!!community && (
        <span className={styles.rating} aria-label={`Community rating ${community.toFixed(1)}`}>
          <Star className={styles.icon} />
          {community.toFixed(1)}
        </span>
      )}
      {!!critic && (
        <span className={styles.rating} aria-label={`Critics ${Math.round(critic)}%`}>
          <Heart className={styles.icon} />
          {Math.round(critic)}%
        </span>
      )}
    </>
  )
}
