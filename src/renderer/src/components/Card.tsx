import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, HeartIcon, PlayIcon } from '@phosphor-icons/react'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { setFavorite, setPlayed } from '../lib/queries'
import { queryKeys } from '../lib/queryKeys'
import { Tip } from './Tip'
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
  const queryClient = useQueryClient()
  const img = imageUrl(item, wide ? 480 : 360)
  const pct = item.UserData?.PlayedPercentage
  const played = item.UserData?.Played ?? false
  const favorite = item.UserData?.IsFavorite ?? false
  // lazy initializer: the sanctioned place to read the wall clock during
  // render — a "new" badge doesn't need per-render freshness
  const [now] = useState(() => Date.now())
  const isNew = !!item.DateCreated && now - Date.parse(item.DateCreated) < 7 * 86_400_000

  const toggleWatched = useMutation({
    mutationFn: (next: boolean) => setPlayed(item.Id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

  const toggleFavorite = useMutation({
    mutationFn: (next: boolean) => setFavorite(item.Id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

  function play(): void {
    navigate({ to: '/player/$itemId', params: { itemId: item.Id } })
  }

  function toggleWatchedClick(e: React.MouseEvent): void {
    e.stopPropagation()
    toggleWatched.mutate(!played)
  }

  function toggleFavoriteClick(e: React.MouseEvent): void {
    e.stopPropagation()
    toggleFavorite.mutate(!favorite)
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
        {isNew && <span className={styles.newBadge}>NEW</span>}
      </button>
      <div className={styles.meta}>
        <button onClick={details} className={styles.title} title={item.Name}>
          {item.Name}
        </button>
        <div className={styles.quickActions}>
          <Tip label={favorite ? 'Remove from favorites' : 'Add to favorites'}>
            <button
              onClick={toggleFavoriteClick}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
              className={`${styles.actionBtn} ${favorite ? styles.actionBtnActive : ''}`}
            >
              <HeartIcon weight={favorite ? 'fill' : 'regular'} />
            </button>
          </Tip>
          <Tip label={played ? 'Mark unwatched' : 'Mark watched'}>
            <button
              onClick={toggleWatchedClick}
              aria-label={played ? 'Mark unwatched' : 'Mark watched'}
              className={`${styles.actionBtn} ${played ? styles.actionBtnActive : ''}`}
            >
              <CheckIcon weight="bold" />
            </button>
          </Tip>
        </div>
      </div>
      <div className={styles.subtitle}>{subtitle}</div>
    </div>
  )
}
