import { useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Play, Clapperboard } from 'reicon-react'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { FavoriteButton } from './FavoriteButton'
import { WatchedButton } from './WatchedButton'
import styles from './Card.module.css'

// Card semantics (CONTEXT.md): click card/hover-play = play, click title = details; episodes: title -> series, subtitle -> episode
export function Card({
  item,
  wide = false
}: {
  item: BaseItem
  wide?: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const router = useRouter()
  const img = imageUrl(item, wide ? 480 : 360)
  const pct = item.UserData?.PlayedPercentage
  const [now] = useState(() => Date.now()) // lazy init: "new" badge doesn't need per-render freshness
  const isNew = !!item.DateCreated && now - Date.parse(item.DateCreated) < 7 * 86_400_000
  const [loaded, setLoaded] = useState(false)

  function play(): void {
    navigate({ to: '/player/$itemId', params: { itemId: item.Id } })
  }

  const isEpisode = item.Type === 'Episode'
  // episodes: title links to series (browsing context), subtitle links to episode itself
  const titleTo =
    item.Type === 'Movie'
      ? { to: '/movies/$itemId' as const, params: { itemId: item.Id } }
      : { to: '/shows/$seriesId' as const, params: { seriesId: (item.SeriesId ?? item.Id)! } }
  const episodeTo = { to: '/episode/$itemId' as const, params: { itemId: item.Id } }

  const titleLabel = isEpisode ? (item.SeriesName ?? '') : item.Name
  const subtitle = isEpisode
    ? `S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} - ${item.Name}`
    : (item.ProductionYear ?? '')
  // shared-element transition: matches DetailsPoster's own view-transition-name for this item (#34)
  const vt = `poster-${item.Id}`

  return (
    <div className={`${styles.card} ${wide ? styles.wide : ''}`}>
      <button
        onClick={play}
        onPointerEnter={() => {
          // details fetch starts on hover, not mousedown -- router only auto-preloads
          // <Link>s (defaultPreload:'intent'), and this button plays rather than navigates
          void router.preloadRoute(titleTo)
        }}
        aria-label={`Play ${item.Name}`}
        className={`${styles.poster} ${wide ? styles.wide : ''}`}
        style={{ '--vt': vt } as React.CSSProperties}
      >
        {img ? (
          <img
            src={img}
            alt=""
            loading="lazy"
            decoding="async"
            className={`${styles.image} ${loaded ? styles.imageLoaded : ''}`}
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <Clapperboard className={styles.placeholderIcon} />
            <span className={styles.placeholderText}>{item.Name}</span>
          </div>
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
        <Link
          {...titleTo}
          className={styles.title}
          title={titleLabel}
          onClick={(e) => e.stopPropagation()}
        >
          {titleLabel}
        </Link>
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
        <Link
          {...episodeTo}
          className={styles.subtitleLink}
          title={item.Name}
          onClick={(e) => e.stopPropagation()}
        >
          {subtitle}
        </Link>
      ) : (
        <div className={styles.subtitle}>{subtitle}</div>
      )}
    </div>
  )
}
