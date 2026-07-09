import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Check, Heart, Play } from 'reicon-react'
import { imageUrl, type BaseItem, type UserData } from '../lib/jellyfin'
import { setFavorite, setPlayed } from '../lib/queries'
import { queryKeys } from '../lib/queryKeys'
import { Tip } from './Tip'
import styles from './Card.module.css'

// Patch the toggled item's UserData in every cached query instead of
// invalidating queryKeys.all() — that refetched the entire library (and the
// staleTime:Infinity search index) on a single heart/check click.
function patchUserData(qc: QueryClient, itemId: string, patch: Partial<UserData>): void {
  const patchOne = (it: BaseItem): BaseItem =>
    it.Id === itemId ? { ...it, UserData: { ...it.UserData, ...patch } } : it
  qc.setQueriesData({ queryKey: queryKeys.all() }, (data: unknown) => {
    if (Array.isArray(data)) return data.map(patchOne)
    if (data && typeof data === 'object' && 'Id' in data) return patchOne(data as BaseItem)
    return data
  })
}

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
    onSuccess: (_data, next) => {
      patchUserData(queryClient, item.Id, {
        Played: next,
        PlayedPercentage: undefined,
        PlaybackPositionTicks: 0
      })
      // membership of these rows actually changes when watched state flips
      queryClient.invalidateQueries({ queryKey: queryKeys.resume() })
      queryClient.invalidateQueries({ queryKey: queryKeys.nextUp.all() })
    }
  })

  const toggleFavorite = useMutation({
    mutationFn: (next: boolean) => setFavorite(item.Id, next),
    onSuccess: (_data, next) => patchUserData(queryClient, item.Id, { IsFavorite: next })
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
              <Heart weight={favorite ? 'Filled' : 'Outline'} />
            </button>
          </Tip>
          <Tip label={played ? 'Mark unwatched' : 'Mark watched'}>
            <button
              onClick={toggleWatchedClick}
              aria-label={played ? 'Mark unwatched' : 'Mark watched'}
              className={`${styles.actionBtn} ${played ? styles.actionBtnActive : ''}`}
            >
              <Check />
            </button>
          </Tip>
        </div>
      </div>
      <div className={styles.subtitle}>{subtitle}</div>
    </div>
  )
}
