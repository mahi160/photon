import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Play } from 'reicon-react'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { FavoriteButton } from './FavoriteButton'
import { WatchedButton } from './WatchedButton'
import styles from './Card.module.css'

// Card semantics (CONTEXT.md): click card / hover play button = play,
// click title label = details. For episodes specifically: title links to
// the series (what you're browsing), subtitle links to the episode itself.
export function Card({
  item,
  wide = false
}: {
  item: BaseItem
  wide?: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const img = imageUrl(item, wide ? 480 : 360)
  const pct = item.UserData?.PlayedPercentage
  // lazy initializer: the sanctioned place to read the wall clock during
  // render — a "new" badge doesn't need per-render freshness
  const [now] = useState(() => Date.now())
  const isNew = !!item.DateCreated && now - Date.parse(item.DateCreated) < 7 * 86_400_000

  function play(): void {
    navigate({ to: '/player/$itemId', params: { itemId: item.Id } })
  }

  // episodes: title row links to the *series* (what you're actually
  // browsing for), subtitle links to the episode itself -- movies/shows
  // keep the plain title-links-to-itself behavior
  function openTitle(e: React.MouseEvent): void {
    e.stopPropagation()
    if (item.Type === 'Movie') navigate({ to: '/movies/$itemId', params: { itemId: item.Id } })
    else if (item.Type === 'Series' || item.Type === 'Episode')
      navigate({ to: '/shows/$seriesId', params: { seriesId: (item.SeriesId ?? item.Id)! } })
  }

  function openEpisode(e: React.MouseEvent): void {
    e.stopPropagation()
    navigate({ to: '/episode/$itemId', params: { itemId: item.Id } })
  }

  const isEpisode = item.Type === 'Episode'
  const titleLabel = isEpisode ? (item.SeriesName ?? '') : item.Name
  const subtitle = isEpisode
    ? `S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} - ${item.Name}`
    : (item.ProductionYear ?? '')

  return (
    <div className={`${styles.card} ${wide ? styles.wide : ''}`}>
      <button
        onClick={play}
        aria-label={`Play ${item.Name}`}
        className={`${styles.poster} ${wide ? styles.wide : ''}`}
      >
        {img ? (
          <img src={img} alt="" loading="lazy" className={styles.image} />
        ) : (
          <div className={styles.placeholder}>{item.Name}</div>
        )}
        <div className={styles.playScrim}>
          <span className={styles.playButton}>
            <Play weight="Filled" />
          </span>
        </div>
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className={styles.progress}>
            <div className={styles.progressFill} style={{ inlineSize: `${pct}%` }} />
          </div>
        )}
        {isNew && <span className={styles.newBadge}>NEW</span>}
      </button>
      <div className={styles.meta}>
        <button onClick={openTitle} className={styles.title} title={titleLabel}>
          {titleLabel}
        </button>
        <div className={styles.quickActions}>
          <FavoriteButton
            item={item}
            className={styles.actionBtn}
            activeClassName={styles.actionBtnActive}
            stopPropagation
          />
          <WatchedButton
            item={item}
            className={styles.actionBtn}
            activeClassName={styles.actionBtnActive}
            stopPropagation
          />
        </div>
      </div>
      {isEpisode ? (
        <button onClick={openEpisode} className={styles.subtitleLink} title={item.Name}>
          {subtitle}
        </button>
      ) : (
        <div className={styles.subtitle}>{subtitle}</div>
      )}
    </div>
  )
}
