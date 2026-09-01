import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Clapperboard } from 'reicon-react'
import { useQuery } from '@tanstack/react-query'
import { episodesQuery, itemQuery, seasonsQuery } from '../lib/queries'
import { backdropUrl, imageUrl, mediaBadges, ticksToSeconds } from '../lib/jellyfin'
import { humanDuration } from '../lib/format'
import { pickMediaSource } from '../player/session'
import { Card } from '../components/Card'
import {
  DetailsActions,
  DetailsError,
  DetailsHero,
  DetailsLoading,
  DetailsMeta,
  DetailsTitleRow,
  DetailsTrackPickers
} from './DetailsShell'
import styles from './Details.module.css'

export function EpisodeDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/episode/$itemId' })
  const navigate = useNavigate()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()
  const [thumbLoaded, setThumbLoaded] = useState(false)

  // next episode: same season's next index, or next season's first -- conditional queries (enabled pattern) since item/season unknown until loaded
  const seriesId = item?.SeriesId
  const seasonId = item?.SeasonId
  const seasons = useQuery({ ...seasonsQuery(seriesId ?? ''), enabled: !!seriesId })
  const seasonEpisodes = useQuery({
    ...episodesQuery(seriesId ?? '', seasonId ?? ''),
    enabled: !!seriesId && !!seasonId
  })
  // defensive: array position determines "next season", don't trust server to return them in index order
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

  // episodes rarely have own backdrop -- wide episode thumb works fine as hero image, beats empty scrim
  const hero = backdropUrl(item, 1280) ?? imageUrl(item, 1280)
  const thumb = imageUrl(item, 640)
  const position = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  // same source the player itself would pick (player/session.ts's pickMediaSource) -- keeps badges/track
  // pickers here consistent with whichever version of a multi-version item actually plays
  const streams = pickMediaSource(item.MediaSources ?? [])?.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle')

  const meta = [
    item.ProductionYear,
    item.RunTimeTicks ? humanDuration(ticksToSeconds(item.RunTimeTicks)) : null,
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
              <img
                src={thumb}
                alt=""
                decoding="async"
                className={`${styles.episodePosterImg} ${thumbLoaded ? styles.imageLoaded : ''}`}
                onLoad={() => setThumbLoaded(true)}
              />
            ) : (
              <div className={styles.episodePosterPlaceholder}>
                <Clapperboard className={styles.episodePosterPlaceholderIcon} />
              </div>
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
            <DetailsActions item={item} position={position} onPlay={play} />
            <DetailsTrackPickers
              audioStreams={audioStreams}
              subtitleStreams={subtitleStreams}
              audio={audio}
              sub={sub}
              onAudio={setAudio}
              onSub={setSub}
            />
          </div>
        </div>
        {nextEpisode && (
          <div className={styles.epSection}>
            {/* .epHead carries margin-block-end gap before what's next, see Details.module.css */}
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
