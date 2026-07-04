import { useState } from 'react'
import { useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { episodesQuery, itemQuery, nextUpQuery, seasonsQuery } from '../lib/queries'
import { backdropUrl, imageUrl, ticksToSeconds, type BaseItem } from '../lib/jellyfin'
import styles from './Details.module.css'

function EpisodeRow({ ep, onPlay }: { ep: BaseItem; onPlay: () => void }): React.JSX.Element {
  const pct = ep.UserData?.PlayedPercentage
  const img = imageUrl(ep, 320)
  return (
    <button onClick={onPlay} className={styles.episodeRow}>
      <div className={styles.episodeThumb}>
        {img && <img src={img} alt="" loading="lazy" />}
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className={styles.episodeProgress}>
            <div className={styles.episodeProgressFill} style={{ inlineSize: `${pct}%` }} />
          </div>
        )}
        {ep.UserData?.Played && (
          <div className={styles.watchedBadge}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
          </div>
        )}
      </div>
      <div className={styles.episodeNum}>{ep.IndexNumber ?? ''}</div>
      <div className={styles.episodeInfo}>
        <div className={styles.episodeTitle}>{ep.Name}</div>
        <p className={styles.episodeOverview}>{ep.Overview}</p>
      </div>
    </button>
  )
}

export function ShowDetails(): React.JSX.Element {
  const { seriesId } = useParams({ from: '/app/shell/shows/$seriesId' })
  const navigate = useNavigate()
  const router = useRouter()
  const series = useQuery(itemQuery(seriesId))
  const seasons = useQuery(seasonsQuery(seriesId))
  const nextUp = useQuery(nextUpQuery(seriesId))
  const [seasonId, setSeasonId] = useState<string | null>(null)

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
        {backdrop && <img src={backdrop} alt="" className={styles.heroImg} />}
        <div className={styles.heroScrim} />
        <button onClick={() => router.history.back()} className={styles.back}>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="12,4 5,10 12,16" />
          </svg>
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
            <h1 className={styles.title}>{item.Name}</h1>
            <div className={styles.meta}>
              {meta.map((m) => (
                <span key={String(m)}>{m}</span>
              ))}
            </div>
            <p className={styles.overview}>{item.Overview}</p>
            {next && (
              <div className={styles.actions}>
                <button onClick={() => play(next)} className={styles.playPrimary}>
                  <svg viewBox="0 0 16 16">
                    <polygon points="3,1.5 14,8 3,14.5" fill="currentColor" />
                  </svg>
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
