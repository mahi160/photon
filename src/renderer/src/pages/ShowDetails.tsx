import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Play } from 'reicon-react'
import { useQuery } from '@tanstack/react-query'
import { episodesQuery, itemQuery, nextUpQuery, seasonsQuery } from '../lib/queries'
import { backdropUrl, imageUrl, ticksToSeconds, type BaseItem } from '../lib/jellyfin'
import { WatchedButton } from '../components/WatchedButton'
import {
  DetailsError,
  DetailsHero,
  DetailsLoading,
  DetailsMeta,
  DetailsPoster,
  DetailsTitleRow
} from './DetailsShell'
import styles from './Details.module.css'

function EpisodeRow({ ep, onPlay }: { ep: BaseItem; onPlay: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const pct = ep.UserData?.PlayedPercentage
  const img = imageUrl(ep, 320)

  // two sibling buttons, not nested (Card convention, AGENTS.md): thumb
  // plays, title opens details. WatchedButton sits beside the thumb button
  // (not inside it) for the same reason -- a <button> can't nest a <button>.
  return (
    <div className={styles.episodeRow}>
      <div className={styles.episodeThumbWrap}>
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${ep.Name}`}
          className={styles.episodeThumb}
        >
          {img && <img src={img} alt="" loading="lazy" />}
          {pct !== undefined && pct > 0 && pct < 100 && (
            <div className={styles.episodeProgress}>
              <div className={styles.episodeProgressFill} style={{ inlineSize: `${pct}%` }} />
            </div>
          )}
        </button>
        <WatchedButton
          item={ep}
          className={styles.episodeWatchedToggle}
          activeClassName={styles.episodeWatchedToggleActive}
        />
      </div>
      <div className={styles.episodeNum}>{ep.IndexNumber ?? ''}</div>
      <div className={styles.episodeInfo}>
        <button
          type="button"
          className={styles.episodeTitle}
          onClick={() => navigate({ to: '/episode/$itemId', params: { itemId: ep.Id } })}
        >
          {ep.Name}
        </button>
        <p className={styles.episodeOverview}>{ep.Overview}</p>
      </div>
    </div>
  )
}

export function ShowDetails(): React.JSX.Element {
  const { seriesId } = useParams({ from: '/app/shell/shows/$seriesId' })
  const navigate = useNavigate()
  const series = useQuery(itemQuery(seriesId))
  const seasons = useQuery(seasonsQuery(seriesId))
  const nextUp = useQuery(nextUpQuery(seriesId))
  const [seasonId, setSeasonId] = useState<string | null>(null)

  const activeSeason = seasonId ?? seasons.data?.[0]?.Id ?? null
  const episodes = useQuery({
    ...episodesQuery(seriesId, activeSeason ?? ''),
    enabled: !!activeSeason
  })

  if (series.isPending) return <DetailsLoading />
  if (series.isError || !series.data) return <DetailsError onRetry={() => series.refetch()} />

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
      <DetailsHero backdrop={backdrop} />
      <div className={styles.content}>
        <div className={styles.top}>
          <DetailsPoster poster={poster} />
          <div className={styles.info}>
            <DetailsTitleRow item={item} />
            <DetailsMeta item={item} meta={meta} />
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
