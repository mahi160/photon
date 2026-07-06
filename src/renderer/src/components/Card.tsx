import { useNavigate } from '@tanstack/react-router'
import { PlayIcon } from '@phosphor-icons/react'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import styles from './Card.module.css'

// Card semantics (CONTEXT.md): click card / hover play button = play,
// click title label = details. Same everywhere.
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

  function play(): void {
    navigate({ to: '/player/$itemId', params: { itemId: item.Id } })
  }

  function details(e: React.MouseEvent): void {
    e.stopPropagation()
    if (item.Type === 'Movie') navigate({ to: '/movies/$itemId', params: { itemId: item.Id } })
    else if (item.Type === 'Series')
      navigate({ to: '/shows/$seriesId', params: { seriesId: item.Id } })
    else if (item.SeriesId)
      navigate({ to: '/shows/$seriesId', params: { seriesId: item.SeriesId } })
  }

  const subtitle =
    item.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}E${item.IndexNumber ?? '?'}`
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
            <PlayIcon weight="fill" />
          </span>
        </div>
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className={styles.progress}>
            <div className={styles.progressFill} style={{ inlineSize: `${pct}%` }} />
          </div>
        )}
      </button>
      <button onClick={details} className={styles.title} title={item.Name}>
        {item.Name}
      </button>
      <div className={styles.subtitle}>{subtitle}</div>
    </div>
  )
}
