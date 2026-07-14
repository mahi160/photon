import { useState } from 'react'
import { useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { CaretLeft, Check, Heart, Play } from 'reicon-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  episodesQuery,
  itemQuery,
  nextUpQuery,
  seasonsQuery,
  setFavorite,
  setPlayed
} from '../lib/queries'
import { queryKeys } from '../lib/queryKeys'
import { backdropUrl, imageUrl, ticksToSeconds, type BaseItem } from '../lib/jellyfin'
import { Tip } from '../components/Tip'
import { Ratings } from '../components/Ratings'
import styles from './Details.module.css'

function EpisodeRow({ ep, onPlay }: { ep: BaseItem; onPlay: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const pct = ep.UserData?.PlayedPercentage
  const played = ep.UserData?.Played ?? false
  const img = imageUrl(ep, 320)

  const toggleWatched = useMutation({
    mutationFn: (next: boolean) => setPlayed(ep.Id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPlay()
        }
      }}
      className={styles.episodeRow}
    >
      <div className={styles.episodeThumb}>
        {img && <img src={img} alt="" loading="lazy" />}
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className={styles.episodeProgress}>
            <div className={styles.episodeProgressFill} style={{ inlineSize: `${pct}%` }} />
          </div>
        )}
        <Tip label={played ? 'Mark unwatched' : 'Mark watched'}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleWatched.mutate(!played)
            }}
            aria-label={played ? 'Mark unwatched' : 'Mark watched'}
            className={`${styles.episodeWatchedToggle} ${played ? styles.episodeWatchedToggleActive : ''}`}
          >
            <Check />
          </button>
        </Tip>
      </div>
      <div className={styles.episodeNum}>{ep.IndexNumber ?? ''}</div>
      <div className={styles.episodeInfo}>
        <div className={styles.episodeTitle}>{ep.Name}</div>
        <p className={styles.episodeOverview}>{ep.Overview}</p>
      </div>
    </div>
  )
}

export function ShowDetails(): React.JSX.Element {
  const { seriesId } = useParams({ from: '/app/shell/shows/$seriesId' })
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const series = useQuery(itemQuery(seriesId))
  const seasons = useQuery(seasonsQuery(seriesId))
  const nextUp = useQuery(nextUpQuery(seriesId))
  const [seasonId, setSeasonId] = useState<string | null>(null)

  const toggleFavorite = useMutation({
    mutationFn: (next: boolean) => setFavorite(seriesId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

  const activeSeason = seasonId ?? seasons.data?.[0]?.Id ?? null
  const episodes = useQuery({
    ...episodesQuery(seriesId, activeSeason ?? ''),
    enabled: !!activeSeason
  })

  if (series.isPending) return <div className={styles.loading}>Loading…</div>
  if (series.isError || !series.data)
    return (
      <div className={styles.errorState}>
        Cannot reach server.{' '}
        <button onClick={() => series.refetch()} className={styles.playPrimary}>
          Retry
        </button>
      </div>
    )

  const item = series.data
  const poster = imageUrl(item, 480)
  const backdrop = backdropUrl(item, 1280)
  const next = nextUp.data
  const nextResumable = next && ticksToSeconds(next.UserData?.PlaybackPositionTicks) > 60

  const seasonCount = seasons.data?.length ?? 0
  const meta = [
    seasonCount ? `${seasonCount} ${seasonCount > 1 ? 'seasons' : 'season'}` : null,
    item.OfficialRating
  ].filter(Boolean)

  function play(ep: BaseItem, start?: number): void {
    navigate({
      to: '/player/$itemId',
      params: { itemId: ep.Id },
      ...(start !== undefined ? { search: { start } } : {})
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        {backdrop && <img src={backdrop} alt="" fetchPriority="high" className={styles.heroImg} />}
        <div className={styles.heroScrim} />
        <button onClick={() => router.history.back()} className={styles.back}>
          <CaretLeft />
          Back
        </button>
      </div>
      <div className={styles.content}>
        <div className={styles.top}>
          <div className={styles.poster}>
            {poster ? (
              <img src={poster} alt="" className={styles.posterImg} />
            ) : (
              <div className={styles.posterPlaceholder} />
            )}
          </div>
          <div className={styles.info}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{item.Name}</h1>
              <Tip label={item.UserData?.IsFavorite ? 'Remove from favorites' : 'Add to favorites'}>
                <button
                  onClick={() => toggleFavorite.mutate(!item.UserData?.IsFavorite)}
                  aria-label={
                    item.UserData?.IsFavorite ? 'Remove from favorites' : 'Add to favorites'
                  }
                  aria-pressed={!!item.UserData?.IsFavorite}
                  className={`${styles.favoriteBtn} ${item.UserData?.IsFavorite ? styles.favoriteBtnActive : ''}`}
                >
                  <Heart weight={item.UserData?.IsFavorite ? 'Filled' : 'Outline'} />
                </button>
              </Tip>
            </div>
            <div className={styles.meta}>
              {meta.map((m) => (
                <span key={String(m)}>{m}</span>
              ))}
              <Ratings item={item} />
            </div>
            <p className={styles.overview}>{item.Overview}</p>
            {next && (
              <div className={styles.actions}>
                <button onClick={() => play(next)} className={styles.playPrimary}>
                  <Play weight="Filled" />
                  {nextResumable ? 'Resume' : 'Play Next Episode'}
                </button>
                <span className={styles.nextLabel}>
                  S{next.ParentIndexNumber}E{next.IndexNumber} · {next.Name}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.epSection}>
          <div className={styles.epHead}>
            <h2 className={styles.epHeadTitle}>Episodes</h2>
            {seasonCount > 0 && (
              <div className={styles.seasons}>
                {seasons.data!.map((s) => (
                  <button
                    key={s.Id}
                    onClick={() => setSeasonId(s.Id)}
                    className={`${styles.seasonBtn} ${s.Id === activeSeason ? styles.seasonBtnActive : ''}`}
                  >
                    {s.Name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.episodes}>
            {episodes.data?.map((ep) => (
              <EpisodeRow key={ep.Id} ep={ep} onPlay={() => play(ep)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
