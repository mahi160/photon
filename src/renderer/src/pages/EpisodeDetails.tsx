import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Play } from 'reicon-react'
import { useQuery } from '@tanstack/react-query'
import { episodesQuery, itemQuery, seasonsQuery } from '../lib/queries'
import { backdropUrl, imageUrl, mediaBadges, ticksToSeconds } from '../lib/jellyfin'
import { WatchedButton } from '../components/WatchedButton'
import { Card } from '../components/Card'
import {
  DetailsError,
  DetailsHero,
  DetailsLoading,
  DetailsMeta,
  DetailsTitleRow
} from './DetailsShell'
import styles from './Details.module.css'

function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSeconds(ticks) / 60)
  return min ? `${Math.floor(min / 60)}h ${min % 60}m` : ''
}

export function EpisodeDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/episode/$itemId' })
  const navigate = useNavigate()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()

  // next episode: same season's next index, or next season's first --
  // conditional queries (react-query's own `enabled` pattern, not a
  // conditional hook call) since item/its season aren't known until loaded
  const seriesId = item?.SeriesId
  const seasonId = item?.SeasonId
  const seasons = useQuery({ ...seasonsQuery(seriesId ?? ''), enabled: !!seriesId })
  const seasonEpisodes = useQuery({
    ...episodesQuery(seriesId ?? '', seasonId ?? ''),
    enabled: !!seriesId && !!seasonId
  })
  // defensive: array position determines "next season", don't trust the
  // server to have already returned them in index order
  const sortedSeasons = seasons.data
    ? [...seasons.data].sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
    : undefined
  const seasonIdx = sortedSeasons?.findIndex((s) => s.Id === seasonId) ?? -1
  const nextSeasonId = seasonIdx >= 0 ? sortedSeasons?.[seasonIdx + 1]?.Id : undefined
  const nextSeasonEpisodes = useQuery({
    ...episodesQuery(seriesId ?? '', nextSeasonId ?? ''),
    enabled: !!nextSeasonId
  })

  if (isPending) return <DetailsLoading />
  if (isError || !item) return <DetailsError onRetry={() => refetch()} />

  const byIndexNumber = (a: { IndexNumber?: number }, b: { IndexNumber?: number }): number =>
    (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0)
  const sortedEpisodes = seasonEpisodes.data
    ? [...seasonEpisodes.data].sort(byIndexNumber)
    : undefined
  const sortedNextSeasonEpisodes = nextSeasonEpisodes.data
    ? [...nextSeasonEpisodes.data].sort(byIndexNumber)
    : undefined
  const episodeIdx = sortedEpisodes?.findIndex((e) => e.Id === item.Id) ?? -1
  const nextEpisode =
    episodeIdx >= 0 && sortedEpisodes && episodeIdx + 1 < sortedEpisodes.length
      ? sortedEpisodes[episodeIdx + 1]
      : sortedNextSeasonEpisodes?.[0]

  // episodes rarely have their own backdrop -- the wide episode thumb reads
  // fine as a hero image too, and beats an empty scrim
  const hero = backdropUrl(item, 1280) ?? imageUrl(item, 1280)
  const thumb = imageUrl(item, 640)
  const position = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const streams = item.MediaSources?.[0]?.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle')

  const meta = [
    item.ProductionYear,
    item.RunTimeTicks ? fmtRuntime(item.RunTimeTicks) : null,
    item.OfficialRating
  ].filter(Boolean)
  const badges = mediaBadges(streams)

  function play(start: number): void {
    navigate({
      to: '/player/$itemId',
      params: { itemId: item!.Id },
      search: {
        start,
        ...(audio !== undefined ? { audio } : {}),
        ...(sub !== undefined ? { sub } : {})
      }
    })
  }

  return (
    <div className={styles.page}>
      <DetailsHero backdrop={hero} />
      <div className={styles.content}>
        <div className={styles.top}>
          <div className={styles.episodePoster}>
            {thumb ? (
              <img src={thumb} alt="" className={styles.episodePosterImg} />
            ) : (
              <div className={styles.episodePosterPlaceholder} />
            )}
          </div>
          <div className={styles.info}>
            {item.SeriesId && (
              <button
                className={styles.epSeriesLink}
                onClick={() =>
                  navigate({ to: '/shows/$seriesId', params: { seriesId: item.SeriesId! } })
                }
              >
                {item.SeriesName ?? ''}
              </button>
            )}
            <div className={styles.epNumberLine}>
              Season {item.ParentIndexNumber ?? '?'} · Episode {item.IndexNumber ?? '?'}
            </div>
            <DetailsTitleRow item={item} />
            <DetailsMeta item={item} meta={meta} />
            {badges.length > 0 && (
              <div className={styles.badges}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>
                    {b}
                  </span>
                ))}
              </div>
            )}
            <p className={styles.overview}>{item.Overview}</p>
            <div className={styles.actions}>
              {position > 60 && (
                <button onClick={() => play(position)} className={styles.playPrimary}>
                  <Play weight="Filled" />
                  Resume
                </button>
              )}
              <button
                onClick={() => play(0)}
                className={position > 60 ? styles.playSecondary : styles.playPrimary}
              >
                {position <= 60 && <Play weight="Filled" />}
                {position > 60 ? 'Play from start' : 'Play'}
              </button>
              <WatchedButton
                item={item}
                className={styles.iconToggle}
                activeClassName={styles.iconToggleActive}
              />
            </div>
            {(audioStreams.length > 1 || subtitleStreams.length > 0) && (
              <div className={styles.tracks}>
                {audioStreams.length > 1 && (
                  <select
                    className={styles.select}
                    value={audio ?? ''}
                    onChange={(e) =>
                      setAudio(e.target.value === '' ? undefined : Number(e.target.value))
                    }
                    aria-label="Audio track"
                  >
                    <option value="">Audio: Default</option>
                    {audioStreams.map((s) => (
                      <option key={s.Index} value={s.Index}>
                        {s.DisplayTitle ?? `Audio ${s.Index}`}
                      </option>
                    ))}
                  </select>
                )}
                {subtitleStreams.length > 0 && (
                  <select
                    className={styles.select}
                    value={sub ?? ''}
                    onChange={(e) =>
                      setSub(e.target.value === '' ? undefined : Number(e.target.value))
                    }
                    aria-label="Subtitles"
                  >
                    <option value="">Subtitles: Default</option>
                    {subtitleStreams.map((s) => (
                      <option key={s.Index} value={s.Index}>
                        {s.DisplayTitle ?? `Subtitle ${s.Index}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
        {nextEpisode && (
          <div className={styles.epSection}>
            {/* .epHead (not just the bare title) -- it's the one carrying the
                margin-block-end gap before whatever comes next, see
                Details.module.css */}
            <div className={styles.epHead}>
              <h2 className={styles.epHeadTitle}>Next Episode</h2>
            </div>
            <div className={styles.nextEpisodeCard}>
              <Card item={nextEpisode} wide />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
